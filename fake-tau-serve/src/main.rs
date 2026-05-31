//! Faithful mock of the `tau serve` wire protocol (NDJSON JSON-RPC over stdio).
//! Implements the contract snapshotted in tau-web-ui/docs/tau-contract-v1.md.
//! Flags: --project <path> --ready-on-stderr [--max-concurrent N] [--idle-timeout S]

mod scripts;

use serde_json::{json, Value};
use std::io::Write as _;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let project = flag(&args, "--project").unwrap_or_else(|| ".".into());
    let ready_on_stderr = args.iter().any(|a| a == "--ready-on-stderr");

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let stdout = tokio::io::stdout();

    if ready_on_stderr {
        eprintln!("tau-serve ready");
        std::io::stderr().flush().ok();
    }

    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};
    let cancelled: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let out = Arc::new(tokio::sync::Mutex::new(stdout));
    let mut tasks: tokio::task::JoinSet<()> = tokio::task::JoinSet::new();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                write_line(
                    &mut *out.lock().await,
                    &err_response(&Value::Null, -32700, "Parse error"),
                )
                .await?;
                continue;
            }
        };
        let id = req.get("id").cloned().unwrap_or(Value::Null);
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");

        match method {
            "meta.handshake" => {
                let pv = req["params"]["protocol_version"].as_i64().unwrap_or(1);
                if pv != 1 {
                    let mut e = err_response(&id, -32000, "Handshake mismatch");
                    e["error"]["data"] = json!({"supported_versions": [1]});
                    write_line(&mut *out.lock().await, &e).await?;
                    continue;
                }
                let resp = json!({
                    "jsonrpc": "2.0", "id": id,
                    "result": {
                        "server_name": "tau", "server_version": "0.0.0-mock",
                        "protocol_version": 1, "project_path": project,
                        "agents": ["greeter", "researcher"]
                    }
                });
                write_line(&mut *out.lock().await, &resp).await?;
            }
            "meta.ping" => {
                write_line(
                    &mut *out.lock().await,
                    &json!({"jsonrpc":"2.0","id":id,"result":{"ok":true}}),
                )
                .await?;
            }
            "runtime.run_streaming" => {
                let agent = req["params"]["agent"]
                    .as_str()
                    .unwrap_or("greeter")
                    .to_string();
                let prompt = req["params"]["prompt"].as_str().unwrap_or("").to_string();
                let id_str = id.to_string();
                let out = out.clone();
                let cancelled = cancelled.clone();
                tasks.spawn(async move {
                    let steps = scripts::script_for(&agent, &prompt);
                    let mut final_usage = json!(null);
                    let mut stop_reason = json!("end_turn");
                    for s in steps {
                        tokio::time::sleep(std::time::Duration::from_millis(s.delay_ms)).await;
                        if cancelled.lock().unwrap().contains(&id_str) {
                            let mut o = out.lock().await;
                            let _ = write_line(&mut o, &err_response(&id, -32001, "Cancelled by client")).await;
                            return;
                        }
                        if s.kind == "RunCompleted" {
                            final_usage = s.data["token_usage"].clone();
                        }
                        if s.kind == "TurnCompleted" {
                            stop_reason = s.data["stop_reason"].clone();
                        }
                        let note = json!({"jsonrpc":"2.0","method":"runtime.event",
                            "params":{"id":id,"kind":s.kind,"data":s.data}});
                        let mut o = out.lock().await;
                        if write_line(&mut o, &note).await.is_err() { return; }
                    }
                    let fin = json!({"jsonrpc":"2.0","id":id,
                        "result":{"final":true,"token_usage":final_usage,"stop_reason":stop_reason}});
                    let mut o = out.lock().await;
                    let _ = write_line(&mut o, &fin).await;
                });
            }
            "runtime.cancel" => {
                let target = req["params"]["id"].to_string();
                cancelled.lock().unwrap().insert(target);
                write_line(
                    &mut *out.lock().await,
                    &json!({"jsonrpc":"2.0","id":id,"result":{"cancelled":true}}),
                )
                .await?;
            }
            _ => {
                write_line(
                    &mut *out.lock().await,
                    &err_response(&id, -32601, "Method not found"),
                )
                .await?;
            }
        }
    }
    // Wait for all in-flight streaming runs to complete before exiting.
    while (tasks.join_next().await).is_some() {}
    Ok(())
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn err_response(id: &Value, code: i64, msg: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":msg}})
}

async fn write_line(out: &mut tokio::io::Stdout, v: &Value) -> anyhow::Result<()> {
    let mut s = serde_json::to_string(v)?;
    s.push('\n');
    out.write_all(s.as_bytes()).await?;
    out.flush().await?;
    Ok(())
}
