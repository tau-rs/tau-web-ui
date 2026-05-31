//! Shared application state: the serve client, the in-memory run registry,
//! per-run live broadcast channels, and the persistence store.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::adapters::log::LogAdapter;
use crate::adapters::serve::ServeAdapter;
use crate::adapters::TraceDelta;
use crate::config;
use crate::packages::{name_from_url, CliOps, MockOps, Package, PackageOps, VerifyResult};
use crate::serve_client::{RunItem, ServeClient};
use crate::store::{RunStore, TraceReplay};
use crate::trace::*;
use crate::workflow::{MockRunner, WorkflowItem, WorkflowRunner};

#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

pub struct Inner {
    pub bin: PathBuf,
    pub project: PathBuf,
    pub no_sandbox: bool,
    pub store: RunStore,
    workflow_runner: Box<dyn WorkflowRunner>,
    package_ops: Box<dyn PackageOps>,
    /// Lazily-spawned serve client (respawned after child death).
    client: Mutex<Option<ServeClient>>,
    /// run_id -> live Run snapshot.
    runs: RwLock<HashMap<String, Run>>,
    /// run_id -> serve JSON-RPC id (for cancel).
    serve_ids: RwLock<HashMap<String, i64>>,
    /// run_id -> broadcast of WsMessage for live subscribers.
    channels: RwLock<HashMap<String, broadcast::Sender<WsMessage>>>,
}

impl AppState {
    pub fn new(bin: PathBuf, project: PathBuf, no_sandbox: bool, store: RunStore) -> Self {
        let is_mock = bin
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.contains("fake-tau-serve"))
            .unwrap_or(false);
        let workflow_runner: Box<dyn WorkflowRunner> = if is_mock {
            Box::new(MockRunner)
        } else {
            Box::new(crate::workflow::CliRunner::new(
                bin.clone(),
                project.clone(),
            ))
        };
        let package_ops: Box<dyn PackageOps> = if is_mock {
            Box::new(MockOps::new())
        } else {
            Box::new(CliOps::new(bin.clone(), project.clone()))
        };
        AppState(Arc::new(Inner {
            bin,
            project,
            no_sandbox,
            store,
            workflow_runner,
            package_ops,
            client: Mutex::new(None),
            runs: RwLock::new(HashMap::new()),
            serve_ids: RwLock::new(HashMap::new()),
            channels: RwLock::new(HashMap::new()),
        }))
    }

    /// Rebuild the in-memory run list from disk at startup. In-flight runs from a
    /// previous process are stale -> mark Running ones Failed (crash recovery).
    pub async fn rehydrate(&self) -> Result<()> {
        let mut map = self.0.runs.write().await;
        for mut run in self.0.store.index()? {
            if run.status == RunStatus::Running {
                run.status = RunStatus::Failed;
                run.error = Some(RunError {
                    kind: "gateway_restart".into(),
                    detail: "run was in-flight when the gateway stopped".into(),
                });
                run.ended_at = Some(now());
                let _ = self.0.store.update_run(&run).await;
            }
            map.insert(run.id.clone(), run);
        }
        Ok(())
    }

    /// Get or (re)spawn the serve client. Respawns if the previous child died.
    pub async fn client(&self) -> Result<ServeClient> {
        let mut guard = self.0.client.lock().await;
        if let Some(c) = guard.as_ref() {
            if c.is_alive().await {
                return Ok(c.clone());
            }
        }
        let c = ServeClient::spawn(
            self.0.bin.clone(),
            self.0.project.clone(),
            self.0.no_sandbox,
        )
        .await?;
        *guard = Some(c.clone());
        Ok(c)
    }

    pub async fn handshake(&self) -> Result<crate::serve_client::HandshakeInfo> {
        Ok(self.client().await?.handshake().await)
    }

    pub async fn list_runs(&self) -> Vec<Run> {
        let mut v: Vec<Run> = self.0.runs.read().await.values().cloned().collect();
        v.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        v
    }

    pub async fn get_run(&self, id: &str) -> Option<Run> {
        self.0.runs.read().await.get(id).cloned()
    }

    pub fn load_trace(&self, id: &str) -> Option<TraceReplay> {
        self.0.store.load(id).ok().flatten()
    }

    /// Subscribe to a run's live channel (creating it if absent).
    pub async fn subscribe(&self, run_id: &str) -> broadcast::Receiver<WsMessage> {
        let mut chans = self.0.channels.write().await;
        chans
            .entry(run_id.to_string())
            .or_insert_with(|| broadcast::channel(1024).0)
            .subscribe()
    }

    async fn publish(&self, run_id: &str, msg: WsMessage) {
        if let Some(tx) = self.0.channels.read().await.get(run_id) {
            let _ = tx.send(msg);
        }
    }

    /// Launch a run: create the Run, spawn the serve run, drive its stream
    /// through the adapter into store + broadcast. Returns the run_id immediately.
    pub async fn launch(&self, agent_id: String, prompt: String) -> Result<String> {
        let run_id = ulid::Ulid::new().to_string();
        let run = Run {
            id: run_id.clone(),
            agent_id: agent_id.clone(),
            prompt: prompt.clone(),
            substrate: Substrate::Host,
            mode: Mode::Dev,
            status: RunStatus::Running,
            started_at: now(),
            ended_at: None,
            total_turns: None,
            token_usage: None,
            stop_reason: None,
            error: None,
            source: Source::Serve,
        };
        self.0
            .runs
            .write()
            .await
            .insert(run_id.clone(), run.clone());
        self.0
            .channels
            .write()
            .await
            .entry(run_id.clone())
            .or_insert_with(|| broadcast::channel(1024).0);
        self.0.store.write_header(&run).await?;

        let client = self.client().await?;
        let (serve_id, mut rx) = client.run_streaming(&agent_id, &prompt).await?;
        self.0
            .serve_ids
            .write()
            .await
            .insert(run_id.clone(), serve_id);

        let state = self.clone();
        let run_id_spawn = run_id.clone();
        tokio::spawn(async move {
            let run_id = run_id_spawn;
            let mut adapter = ServeAdapter::new(run_id.clone());
            let mut run = run;
            while let Some(item) = rx.recv().await {
                match item {
                    RunItem::Event { kind, data } => {
                        if kind == "TurnCompleted" {
                            run.total_turns = data["turn"].as_u64().map(|t| t as u32);
                            run.stop_reason = data["stop_reason"].as_str().map(String::from);
                            if let Some(u) = ServeAdapter::parse_usage(&data["usage"]) {
                                run.token_usage = Some(u);
                            }
                        }
                        if kind == "RunCompleted" {
                            if let Some(u) = ServeAdapter::parse_usage(&data["token_usage"]) {
                                run.token_usage = Some(u);
                            }
                        }
                        if kind == "FatalError" {
                            run.error = Some(RunError {
                                kind: data["tool_error_variant"]
                                    .as_str()
                                    .unwrap_or("FatalError")
                                    .into(),
                                detail: data["message"].as_str().unwrap_or("").into(),
                            });
                        }
                        for delta in adapter.on_event(&kind, &data) {
                            state.apply_delta(&run_id, delta).await;
                        }
                    }
                    RunItem::Final {
                        token_usage,
                        stop_reason,
                    } => {
                        if let Some(u) = ServeAdapter::parse_usage(&token_usage) {
                            run.token_usage = Some(u);
                        }
                        if let Some(s) = stop_reason.as_str() {
                            run.stop_reason = Some(s.into());
                        }
                        run.status = RunStatus::Completed;
                        run.ended_at = Some(now());
                        state.finalize(&run_id, &mut run).await;
                        break;
                    }
                    RunItem::Error(e) => {
                        run.status = if e.code == -32001 {
                            RunStatus::Cancelled
                        } else {
                            RunStatus::Failed
                        };
                        if e.code != -32001 {
                            run.error = Some(RunError {
                                kind: format!("rpc:{}", e.code),
                                detail: e.message,
                            });
                        }
                        run.ended_at = Some(now());
                        state.finalize(&run_id, &mut run).await;
                        break;
                    }
                }
            }
        });

        Ok(run_id)
    }

    async fn apply_delta(&self, run_id: &str, delta: TraceDelta) {
        match delta {
            TraceDelta::SpanOpened(s) | TraceDelta::SpanUpdated(s) => {
                let _ = self.0.store.write_span(&s).await;
                self.publish(run_id, WsMessage::SpanUpdate { span: s })
                    .await;
            }
            TraceDelta::Event(e) => {
                let _ = self.0.store.write_event(&e).await;
                self.publish(run_id, WsMessage::Event { event: e }).await;
            }
            TraceDelta::RunUpdated(r) => {
                self.publish(run_id, WsMessage::RunUpdate { run: r }).await;
            }
        }
    }

    async fn finalize(&self, run_id: &str, run: &mut Run) {
        self.0
            .runs
            .write()
            .await
            .insert(run_id.to_string(), run.clone());
        let _ = self.0.store.update_run(run).await;
        self.0.serve_ids.write().await.remove(run_id);
        self.publish(run_id, WsMessage::RunUpdate { run: run.clone() })
            .await;
    }

    /// Workflow definitions in <project>/workflows/*.toml (file stems).
    pub fn list_workflows(&self) -> Vec<String> {
        let dir = self.0.project.join("workflows");
        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("toml"))
            .filter_map(|e| {
                e.path()
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
            })
            .collect();
        names.sort();
        names
    }

    /// Launch a workflow run: create the Run (source=log), drive the runner's
    /// StepRecords through the log-adapter into store + broadcast, then finalize.
    pub async fn launch_workflow(&self, workflow: String, input: String) -> Result<String> {
        let run_id = ulid::Ulid::new().to_string();
        let run = Run {
            id: run_id.clone(),
            agent_id: workflow.clone(),
            prompt: input.clone(),
            substrate: Substrate::Host,
            mode: Mode::Dev,
            status: RunStatus::Running,
            started_at: now(),
            ended_at: None,
            total_turns: None,
            token_usage: None,
            stop_reason: None,
            error: None,
            source: Source::Log,
        };
        self.0
            .runs
            .write()
            .await
            .insert(run_id.clone(), run.clone());
        self.0
            .channels
            .write()
            .await
            .entry(run_id.clone())
            .or_insert_with(|| broadcast::channel(1024).0);
        self.0.store.write_header(&run).await?;

        let mut rx = self.0.workflow_runner.run(workflow, input, run_id.clone());
        let state = self.clone();
        let run_id_spawn = run_id.clone();
        tokio::spawn(async move {
            let run_id = run_id_spawn;
            let adapter = LogAdapter::new(run_id.clone());
            let mut run = run;
            let mut steps = 0u32;
            let mut any_failed = false;
            while let Some(item) = rx.recv().await {
                match item {
                    WorkflowItem::Step(rec) => {
                        steps += 1;
                        if rec.status == "failed" {
                            any_failed = true;
                            run.error = Some(RunError {
                                kind: rec.error.clone().unwrap_or_else(|| "step_failed".into()),
                                detail: rec.detail.clone().unwrap_or_default(),
                            });
                        }
                        for delta in adapter.on_step(&rec) {
                            state.apply_delta(&run_id, delta).await;
                        }
                    }
                    WorkflowItem::Done => {
                        run.total_turns = Some(steps);
                        run.status = if any_failed {
                            RunStatus::Failed
                        } else {
                            RunStatus::Completed
                        };
                        run.ended_at = Some(now());
                        state.finalize(&run_id, &mut run).await;
                        break;
                    }
                    WorkflowItem::Error(e) => {
                        run.status = RunStatus::Failed;
                        run.error = Some(RunError {
                            kind: "workflow_error".into(),
                            detail: e,
                        });
                        run.ended_at = Some(now());
                        state.finalize(&run_id, &mut run).await;
                        break;
                    }
                }
            }
        });

        Ok(run_id)
    }

    pub fn config_read(&self) -> Result<config::ProjectConfig> {
        config::read(&self.0.project)
    }

    pub fn config_write(&self, name: &str, description: Option<&str>) -> Result<()> {
        config::write_project(&self.0.project, name, description)
    }

    pub fn packages(&self) -> Vec<Package> {
        self.0.package_ops.list()
    }

    pub fn package_install(&self, git_url: &str) -> Result<Package> {
        self.0.package_ops.install(git_url)
    }

    pub fn package_uninstall(&self, name: &str) -> Result<()> {
        self.0.package_ops.uninstall(name)
    }

    pub fn package_update(&self, name: &str, to: Option<String>) -> Result<Package> {
        self.0.package_ops.update(name, to)
    }

    pub fn package_resolve(&self) -> Result<Vec<Package>> {
        self.0.package_ops.resolve()
    }

    pub fn package_verify(&self) -> Vec<VerifyResult> {
        self.0.package_ops.verify()
    }

    /// Import a community agent: install its package, then register `[agents.<id>]`.
    pub fn import_agent(&self, git_url: &str, llm_backend: &str) -> Result<String> {
        let id = name_from_url(git_url);
        let pkg = self.0.package_ops.install(git_url)?;
        config::add_agent(
            &self.0.project,
            &id,
            &id,
            &format!("{}@^{}", pkg.name, pkg.version),
            llm_backend,
        )?;
        Ok(id)
    }

    pub async fn cancel(&self, run_id: &str) -> Result<bool> {
        let serve_id = self.0.serve_ids.read().await.get(run_id).copied();
        match serve_id {
            Some(id) => self.client().await?.cancel(id).await,
            None => Ok(false),
        }
    }
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
