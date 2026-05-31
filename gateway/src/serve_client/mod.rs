//! Serve client: tau serve child management + NDJSON JSON-RPC.
pub mod jsonrpc;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

use jsonrpc::{Inbound, Request, RequestId, RpcError};

/// A demuxed item belonging to one streaming run (correlated by JSON-RPC id).
#[derive(Debug, Clone)]
pub enum RunItem {
    /// A runtime.event notification's params: {id, kind, data} -> (kind, data).
    Event { kind: String, data: Value },
    /// Final success: {final, token_usage, stop_reason}.
    Final {
        token_usage: Value,
        stop_reason: Value,
    },
    /// Terminal error on the run's id.
    Error(RpcError),
}

#[derive(Debug, Clone)]
pub struct HandshakeInfo {
    pub server_version: String,
    pub project_path: String,
    pub agents: Vec<String>,
}

/// One long-lived tau serve child per project. Cheaply cloneable handle.
#[derive(Clone)]
pub struct ServeClient {
    inner: Arc<Inner>,
}

struct Inner {
    stdin: Mutex<ChildStdin>,
    next_id: AtomicI64,
    runs: Mutex<HashMap<i64, mpsc::UnboundedSender<RunItem>>>,
    unary: Mutex<HashMap<i64, oneshot::Sender<std::result::Result<Value, RpcError>>>>,
    child: Mutex<Child>,
    handshake: Mutex<Option<HandshakeInfo>>,
}

fn json_id(v: &Value) -> Option<i64> {
    v.as_i64()
}
fn req_id(id: &RequestId) -> i64 {
    match id {
        RequestId::Int(i) => *i,
        RequestId::Str(s) => s.parse().unwrap_or(-1),
    }
}

impl ServeClient {
    /// Spawn `tau serve`, wait for the ready line on stderr, handshake.
    pub async fn spawn(bin: PathBuf, project: PathBuf, no_sandbox: bool) -> Result<ServeClient> {
        let mut cmd = Command::new(&bin);
        cmd.arg("--project").arg(&project).arg("--ready-on-stderr");
        if no_sandbox {
            cmd.arg("--no-sandbox");
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd.kill_on_drop(true);
        let mut child = cmd.spawn().with_context(|| format!("spawn {bin:?}"))?;

        // Wait for "tau-serve ready" on stderr.
        let stderr = child.stderr.take().context("child stderr")?;
        let mut err_lines = BufReader::new(stderr).lines();
        tokio::time::timeout(std::time::Duration::from_secs(15), async {
            while let Some(line) = err_lines.next_line().await? {
                if line.contains("tau-serve ready") {
                    return Ok::<(), anyhow::Error>(());
                }
            }
            Err(anyhow!("child exited before ready"))
        })
        .await
        .context("timed out waiting for tau-serve ready")??;
        // Drain remaining stderr to a tracing sink so the pipe never blocks.
        tokio::spawn(async move {
            while let Ok(Some(line)) = err_lines.next_line().await {
                tracing::debug!(target: "tau-serve", "{line}");
            }
        });

        let stdin = child.stdin.take().context("child stdin")?;
        let stdout = child.stdout.take().context("child stdout")?;

        let inner = Arc::new(Inner {
            stdin: Mutex::new(stdin),
            next_id: AtomicI64::new(1),
            runs: Mutex::new(HashMap::new()),
            unary: Mutex::new(HashMap::new()),
            child: Mutex::new(child),
            handshake: Mutex::new(None),
        });

        // Reader pump: route every stdout line to the right run / unary waiter.
        let pump_inner = inner.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Inbound>(&line) {
                    Ok(Inbound::Notification { method, params }) if method == "runtime.event" => {
                        if let Some(id) = params.get("id").and_then(json_id) {
                            let kind = params["kind"].as_str().unwrap_or("Unknown").to_string();
                            let data = params["data"].clone();
                            if let Some(tx) = pump_inner.runs.lock().await.get(&id) {
                                let _ = tx.send(RunItem::Event { kind, data });
                            }
                        }
                    }
                    Ok(Inbound::Result { id, result }) => {
                        let id = req_id(&id);
                        if result
                            .get("final")
                            .and_then(|f| f.as_bool())
                            .unwrap_or(false)
                        {
                            if let Some(tx) = pump_inner.runs.lock().await.remove(&id) {
                                let _ = tx.send(RunItem::Final {
                                    token_usage: result["token_usage"].clone(),
                                    stop_reason: result["stop_reason"].clone(),
                                });
                            }
                        } else if let Some(tx) = pump_inner.unary.lock().await.remove(&id) {
                            let _ = tx.send(Ok(result));
                        }
                    }
                    Ok(Inbound::Error { id, error }) => {
                        let id = req_id(&id);
                        if let Some(tx) = pump_inner.runs.lock().await.remove(&id) {
                            let _ = tx.send(RunItem::Error(error));
                        } else if let Some(tx) = pump_inner.unary.lock().await.remove(&id) {
                            let _ = tx.send(Err(error));
                        }
                    }
                    Ok(Inbound::Notification { .. }) => { /* unknown notification: ignore */ }
                    Err(e) => tracing::warn!("unparseable serve line: {e}: {line}"),
                }
            }
            // stdout closed -> child gone. Fail all in-flight runs AND unary waiters.
            for (_, tx) in pump_inner.runs.lock().await.drain() {
                let _ = tx.send(RunItem::Error(RpcError {
                    code: -32603,
                    message: "tau serve child exited".into(),
                    data: None,
                }));
            }
            for (_, tx) in pump_inner.unary.lock().await.drain() {
                let _ = tx.send(Err(RpcError {
                    code: -32603,
                    message: "tau serve child exited".into(),
                    data: None,
                }));
            }
        });

        // Handshake (unary), then fill handshake in place.
        let client = ServeClient { inner };
        let res = client
            .unary_call(
                "meta.handshake",
                json!({
                    "client_name": "tau-gateway", "client_version": "0.1.0", "protocol_version": 1
                }),
            )
            .await?;
        let hs = HandshakeInfo {
            server_version: res["server_version"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            project_path: res["project_path"].as_str().unwrap_or_default().to_string(),
            agents: res["agents"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
        };
        *client.inner.handshake.lock().await = Some(hs);
        Ok(client)
    }

    fn alloc_id(&self) -> i64 {
        self.inner.next_id.fetch_add(1, Ordering::SeqCst)
    }

    async fn write_request(&self, req: &Request) -> Result<()> {
        let mut line = serde_json::to_string(req)?;
        line.push('\n');
        let mut stdin = self.inner.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }

    async fn unary_call(&self, method: &'static str, params: Value) -> Result<Value> {
        let id = self.alloc_id();
        let (tx, rx) = oneshot::channel();
        self.inner.unary.lock().await.insert(id, tx);
        if let Err(e) = self.write_request(&Request::new(id, method, params)).await {
            self.inner.unary.lock().await.remove(&id);
            return Err(e);
        }
        match rx.await {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(anyhow!("rpc error {}: {}", e.code, e.message)),
            Err(_) => Err(anyhow!("serve client dropped before response")),
        }
    }

    pub async fn handshake(&self) -> HandshakeInfo {
        self.inner
            .handshake
            .lock()
            .await
            .clone()
            .expect("handshake completed")
    }

    pub async fn ping(&self) -> Result<bool> {
        Ok(self.unary_call("meta.ping", json!({})).await?["ok"]
            .as_bool()
            .unwrap_or(false))
    }

    /// Start a streaming run. Returns (serve_request_id, receiver of RunItems).
    pub async fn run_streaming(
        &self,
        agent: &str,
        prompt: &str,
    ) -> Result<(i64, mpsc::UnboundedReceiver<RunItem>)> {
        let id = self.alloc_id();
        let (tx, rx) = mpsc::unbounded_channel();
        self.inner.runs.lock().await.insert(id, tx);
        if let Err(e) = self
            .write_request(&Request::new(
                id,
                "runtime.run_streaming",
                json!({"agent": agent, "prompt": prompt}),
            ))
            .await
        {
            self.inner.runs.lock().await.remove(&id);
            return Err(e);
        }
        Ok((id, rx))
    }

    pub async fn cancel(&self, target_id: i64) -> Result<bool> {
        let res = self
            .unary_call("runtime.cancel", json!({"id": target_id}))
            .await?;
        Ok(res["cancelled"].as_bool().unwrap_or(false))
    }

    /// True if the child is still running.
    pub async fn is_alive(&self) -> bool {
        self.inner
            .child
            .lock()
            .await
            .try_wait()
            .ok()
            .flatten()
            .is_none()
    }
}
