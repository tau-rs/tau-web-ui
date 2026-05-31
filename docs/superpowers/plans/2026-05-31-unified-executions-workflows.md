# Unified Executions + Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Runs surface a unified, filterable list of workflow + agent runs, add workflow launch+observe (mock-backed via a gateway workflow runner + log-adapter), and render a workflow run as a step-timeline trace with a gated "view agent trace" drill.

**Architecture:** The gateway gains a `log-adapter` (tau `StepRecord` JSONL → the existing Trace/Span model) and a `WorkflowRunner` trait (`MockRunner` for fake-tau-serve, `CliRunner` seam for real tau). `AppState.launch_workflow` mirrors `launch`, driving runner items through the log-adapter into the same store + WS broadcast — so workflow runs are just `Run`s with `source:"log"`. The frontend adds a type chip + filter bar, an Agent|Workflow launcher toggle, and a workflow trace (Timeline default + gated drill).

**Tech Stack:** Rust (tokio, serde, axum), React 18 + Tailwind + Zustand + react-router, Vitest, Playwright.

**Source spec:** `docs/superpowers/specs/2026-05-31-unified-executions-workflows-design.md`. **CI gate:** rust (fmt/clippy/test + ts-rs drift) + web (lint/format/typecheck/vitest/build) + e2e. Run the relevant gate before each commit. Branch `impl/gateway-v1`. End commit messages with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File structure
```
gateway/src/adapters/log.rs        # StepRecord + LogAdapter (StepRecord → TraceDelta)
gateway/src/workflow/mod.rs        # WorkflowItem, WorkflowRunner, MockRunner, CliRunner, scripts
gateway/src/lib.rs                 # + pub mod workflow
gateway/src/state.rs               # + workflow_runner, list_workflows, launch_workflow
gateway/src/api/workflows.rs       # GET /api/workflows, POST /api/workflows/run
gateway/src/api/mod.rs             # + routes
fixtures/demo/workflows/*.toml     # 2 sample workflows
web/src/api/client.ts              # getWorkflows, launchWorkflow
web/src/store/store.ts             # workflows, loadWorkflows, launchWorkflow
web/src/runs/badges.tsx            # TypeBadge
web/src/runs/RunsTable.tsx         # type chip column
web/src/runs/RunsView.tsx          # filter bar (All/Workflows/Agents)
web/src/runs/Launcher.tsx          # Agent | Workflow toggle
web/src/trace/TraceView.tsx        # Timeline default for workflows
web/src/trace/SpanInspector.tsx    # gated agent-drill
web/src/dashboard/metrics.ts       # byKind facet
```

---

### Task 1: Gateway — log-adapter (StepRecord → spans)

**Files:** Modify `gateway/src/adapters/log.rs` (currently a doc-comment stub)

- [ ] **Step 1: Replace `gateway/src/adapters/log.rs`** with the StepRecord type, the LogAdapter, and tests:
```rust
//! log-adapter: maps tau workflow-run JSONL (StepRecord) onto the Trace model.
//! Each StepRecord is an already-completed step → one closed Span. Steps are a
//! flat ordered sequence (rendered as a waterfall). See design §1–2.

use serde::Deserialize;

use crate::adapters::TraceDelta;
use crate::trace::{Span, SpanKind, SpanStatus};

/// One line of `<scope>/.tau/workflow-runs/<name>-<run-id>.jsonl`.
#[derive(Debug, Clone, Deserialize)]
pub struct StepRecord {
    pub ts: String,
    pub run_id: String,
    pub step_id: String,
    pub step_index: u32,
    pub kind: String, // "agent.run" | "tool.call"
    pub input: String,
    pub output: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: u64,
    pub status: String, // "ok" | "failed"
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
}

pub struct LogAdapter {
    run_id: String,
}

impl LogAdapter {
    pub fn new(run_id: String) -> Self {
        LogAdapter { run_id }
    }

    /// Map one completed StepRecord to a closed Span delta.
    pub fn on_step(&self, rec: &StepRecord) -> Vec<TraceDelta> {
        let kind = if rec.kind == "agent.run" {
            SpanKind::Agent
        } else {
            SpanKind::ToolCall
        };
        let status = if rec.status == "failed" {
            SpanStatus::Error
        } else {
            SpanStatus::Ok
        };
        let span = Span {
            id: format!("{}-step-{}", self.run_id, rec.step_index),
            parent_id: None,
            run_id: self.run_id.clone(),
            kind,
            name: rec.step_id.clone(),
            status,
            started_at: rec.started_at.clone(),
            ended_at: Some(rec.ended_at.clone()),
            attributes: serde_json::json!({
                "input": rec.input,
                "output": rec.output,
                "kind": rec.kind,
                "step_index": rec.step_index,
                "error": rec.error,
                "detail": rec.detail,
            }),
        };
        vec![TraceDelta::SpanOpened(span)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(kind: &str, status: &str) -> StepRecord {
        StepRecord {
            ts: "2026-05-31T00:00:00Z".into(),
            run_id: "R1".into(),
            step_id: "gather".into(),
            step_index: 0,
            kind: kind.into(),
            input: "hi".into(),
            output: "done".into(),
            started_at: "2026-05-31T00:00:00Z".into(),
            ended_at: "2026-05-31T00:00:01Z".into(),
            duration_ms: 1000,
            status: status.into(),
            error: None,
            detail: None,
        }
    }

    #[test]
    fn agent_step_maps_to_agent_span_ok() {
        let a = LogAdapter::new("R1".into());
        let d = a.on_step(&rec("agent.run", "ok"));
        let span = match &d[0] {
            TraceDelta::SpanOpened(s) => s.clone(),
            _ => panic!("expected SpanOpened"),
        };
        assert_eq!(span.kind, SpanKind::Agent);
        assert_eq!(span.status, SpanStatus::Ok);
        assert_eq!(span.name, "gather");
        assert_eq!(span.attributes["input"], "hi");
        assert_eq!(span.attributes["output"], "done");
    }

    #[test]
    fn tool_step_failed_maps_to_toolcall_error() {
        let a = LogAdapter::new("R1".into());
        let mut r = rec("tool.call", "failed");
        r.error = Some("tool_error".into());
        let d = a.on_step(&r);
        let span = match &d[0] {
            TraceDelta::SpanOpened(s) => s.clone(),
            _ => panic!("expected SpanOpened"),
        };
        assert_eq!(span.kind, SpanKind::ToolCall);
        assert_eq!(span.status, SpanStatus::Error);
        assert_eq!(span.attributes["error"], "tool_error");
    }
}
```
(`SpanKind`/`SpanStatus` derive `PartialEq` already — confirmed by the serve-adapter tests.)

- [ ] **Step 2: Run** `cargo test -p tau-gateway adapters::log` → 2 pass. `cargo fmt --all` + `cargo clippy --all-targets -- -D warnings` clean.

- [ ] **Step 3: Commit**
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/adapters/log.rs
git commit -m "feat(gateway): log-adapter — StepRecord JSONL -> Trace spans"
```

---

### Task 2: Gateway — workflow runner + fixtures

**Files:** Create `gateway/src/workflow/mod.rs`; modify `gateway/src/lib.rs`; create `fixtures/demo/workflows/nightly-research.toml`, `fixtures/demo/workflows/build-report.toml`

- [ ] **Step 1: Workflow fixtures**

Run: `mkdir -p /Users/titouanlebocq/code/tau-ui/fixtures/demo/workflows`

Create `fixtures/demo/workflows/nightly-research.toml`:
```toml
[workflow]
description = "Gather, summarise, and save a nightly research note."
default-agent = "researcher"

[[steps]]
id = "gather"
kind = "agent.run"
agent = "researcher"
input = "${input}"

[[steps]]
id = "summarise"
kind = "agent.run"
agent = "greeter"
input = "${steps.gather.output}"

[[steps]]
id = "save-results"
kind = "tool.call"
tool = "fs-write"
args = { path = "/tmp/nightly.md", content = "${steps.summarise.output}" }
```

Create `fixtures/demo/workflows/build-report.toml`:
```toml
[workflow]
description = "Collect data then render a report (render step fails in the mock)."
default-agent = "researcher"

[[steps]]
id = "collect"
kind = "agent.run"
agent = "researcher"
input = "${input}"

[[steps]]
id = "render"
kind = "tool.call"
tool = "fs-write"
args = { path = "/tmp/report.html" }
```

- [ ] **Step 2: Register the module** — in `gateway/src/lib.rs`, add `pub mod workflow;` alongside the other `pub mod` lines.

- [ ] **Step 3: Implement** `gateway/src/workflow/mod.rs`:
```rust
//! Workflow runner: produces a stream of StepRecords for a workflow run.
//! `MockRunner` fabricates canned step sequences (used with fake-tau-serve);
//! `CliRunner` is the seam for real `tau workflow run` + JSONL tail.

use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::mpsc;

use crate::adapters::log::StepRecord;

#[derive(Debug, Clone)]
pub enum WorkflowItem {
    Step(StepRecord),
    Done,
    Error(String),
}

pub trait WorkflowRunner: Send + Sync {
    /// Start the workflow; returns a receiver of items (the impl spawns its own task).
    fn run(
        &self,
        workflow: String,
        input: String,
        run_id: String,
    ) -> mpsc::UnboundedReceiver<WorkflowItem>;
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// (step_id, kind, output, status, delay_before_ms)
type Scripted = (&'static str, &'static str, &'static str, &'static str, u64);

fn script(workflow: &str) -> Vec<Scripted> {
    match workflow {
        "build-report" => vec![
            ("collect", "agent.run", "collected 12 rows", "ok", 60),
            ("render", "tool.call", "", "failed", 50),
        ],
        // default: nightly-research
        _ => vec![
            ("gather", "agent.run", "found 4 drivers", "ok", 50),
            ("summarise", "agent.run", "summary: pricing & onboarding", "ok", 70),
            ("save-results", "tool.call", "wrote /tmp/nightly.md", "ok", 30),
        ],
    }
}

pub struct MockRunner;

impl WorkflowRunner for MockRunner {
    fn run(
        &self,
        workflow: String,
        input: String,
        run_id: String,
    ) -> mpsc::UnboundedReceiver<WorkflowItem> {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            for (i, (step_id, kind, output, status, delay)) in script(&workflow).into_iter().enumerate() {
                tokio::time::sleep(Duration::from_millis(delay)).await;
                let started = now();
                let ended = now();
                let rec = StepRecord {
                    ts: now(),
                    run_id: run_id.clone(),
                    step_id: step_id.to_string(),
                    step_index: i as u32,
                    kind: kind.to_string(),
                    input: if i == 0 { input.clone() } else { String::new() },
                    output: output.to_string(),
                    started_at: started,
                    ended_at: ended,
                    duration_ms: delay,
                    status: status.to_string(),
                    error: (status == "failed").then(|| "tool_error".to_string()),
                    detail: (status == "failed").then(|| "mock render failure".to_string()),
                };
                if tx.send(WorkflowItem::Step(rec)).is_err() {
                    return;
                }
            }
            let _ = tx.send(WorkflowItem::Done);
        });
        rx
    }
}

/// Seam: run real `tau workflow run` and tail the JSONL log. Not wired in v1
/// (the mock path covers fake-tau-serve). When real tau is the target, implement:
/// spawn `tau workflow run <workflow> --input <input>`, read `run_id:` from stderr,
/// tail `<project>/.tau/workflow-runs/<workflow>-<id>.jsonl` emitting `Step` per new
/// line, then `Done` on process exit.
pub struct CliRunner {
    #[allow(dead_code)]
    bin: PathBuf,
    #[allow(dead_code)]
    project: PathBuf,
}

impl CliRunner {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        CliRunner { bin, project }
    }
}

impl WorkflowRunner for CliRunner {
    fn run(
        &self,
        workflow: String,
        _input: String,
        _run_id: String,
    ) -> mpsc::UnboundedReceiver<WorkflowItem> {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            let _ = tx.send(WorkflowItem::Error(format!(
                "real-tau workflow run not wired yet (run `{workflow}` via the tau CLI); \
                 the gateway observes workflows only with fake-tau-serve in v1"
            )));
        });
        rx
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_runner_emits_steps_then_done() {
        let mut rx = MockRunner.run("nightly-research".into(), "topic".into(), "R1".into());
        let mut kinds = vec![];
        let mut done = false;
        while let Some(item) = rx.recv().await {
            match item {
                WorkflowItem::Step(s) => kinds.push(s.kind),
                WorkflowItem::Done => {
                    done = true;
                    break;
                }
                WorkflowItem::Error(e) => panic!("unexpected error {e}"),
            }
        }
        assert!(done);
        assert_eq!(kinds, vec!["agent.run", "agent.run", "tool.call"]);
    }

    #[tokio::test]
    async fn build_report_has_a_failed_step() {
        let mut rx = MockRunner.run("build-report".into(), "x".into(), "R2".into());
        let mut statuses = vec![];
        while let Some(item) = rx.recv().await {
            match item {
                WorkflowItem::Step(s) => statuses.push(s.status),
                _ => break,
            }
        }
        assert!(statuses.contains(&"failed".to_string()));
    }
}
```

- [ ] **Step 4: Verify + commit** — `cargo test -p tau-gateway workflow` → 2 pass; `cargo fmt --all && cargo clippy --all-targets -- -D warnings` clean.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/workflow/mod.rs gateway/src/lib.rs fixtures/demo/workflows
git commit -m "feat(gateway): workflow runner (MockRunner + CliRunner seam) + fixtures"
```

---

### Task 3: Gateway — AppState workflow launch

**Files:** Modify `gateway/src/state.rs`; Test: `gateway/tests/workflow_run.rs`

- [ ] **Step 1: Wire the runner + methods into AppState** — in `gateway/src/state.rs`:

a) Add imports near the top:
```rust
use crate::adapters::log::LogAdapter;
use crate::workflow::{MockRunner, WorkflowItem, WorkflowRunner};
```

b) Add a field to `Inner` (next to `store`):
```rust
    workflow_runner: Box<dyn WorkflowRunner>,
```

c) In `AppState::new`, build the runner from the bin name and pass it into `Inner`. Replace the `AppState::new` body's `Inner { … }` construction so it includes:
```rust
    pub fn new(bin: PathBuf, project: PathBuf, no_sandbox: bool, store: RunStore) -> Self {
        let is_mock = bin
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.contains("fake-tau-serve"))
            .unwrap_or(false);
        let workflow_runner: Box<dyn WorkflowRunner> = if is_mock {
            Box::new(MockRunner)
        } else {
            Box::new(crate::workflow::CliRunner::new(bin.clone(), project.clone()))
        };
        AppState(Arc::new(Inner {
            bin,
            project,
            no_sandbox,
            store,
            workflow_runner,
            client: Mutex::new(None),
            runs: RwLock::new(HashMap::new()),
            serve_ids: RwLock::new(HashMap::new()),
            channels: RwLock::new(HashMap::new()),
        }))
    }
```
(Keep the existing field names/order; only add `workflow_runner`.)

d) Add these methods to `impl AppState` (next to `launch`):
```rust
    /// Workflow definitions in <project>/workflows/*.toml (file stems).
    pub fn list_workflows(&self) -> Vec<String> {
        let dir = self.0.project.join("workflows");
        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("toml"))
            .filter_map(|e| e.path().file_stem().map(|s| s.to_string_lossy().to_string()))
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
        self.0.runs.write().await.insert(run_id.clone(), run.clone());
        self.0
            .channels
            .write()
            .await
            .entry(run_id.clone())
            .or_insert_with(|| broadcast::channel(1024).0);
        self.0.store.write_header(&run).await?;

        let mut rx = self.0.workflow_runner.run(workflow, input, run_id.clone());
        let state = self.clone();
        tokio::spawn(async move {
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
                        run.error = Some(RunError { kind: "workflow_error".into(), detail: e });
                        run.ended_at = Some(now());
                        state.finalize(&run_id, &mut run).await;
                        break;
                    }
                }
            }
        });

        Ok(run_id)
    }
```
(`apply_delta`, `finalize`, `now()`, `RunError`, `Source`, `RunStatus`, `Substrate`, `Mode`, `broadcast`, `Result` are already in scope in `state.rs`.)

- [ ] **Step 2: Integration test** — create `gateway/tests/workflow_run.rs`:
```rust
use std::path::PathBuf;
use std::time::Duration;
use tau_gateway::{state::AppState, store::RunStore, trace::RunStatus, trace::Source};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}
fn project() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

#[tokio::test]
async fn lists_workflow_fixtures() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let wfs = state.list_workflows();
    assert!(wfs.contains(&"nightly-research".to_string()));
    assert!(wfs.contains(&"build-report".to_string()));
}

#[tokio::test]
async fn launch_workflow_persists_step_spans() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let id = state.launch_workflow("nightly-research".into(), "topic".into()).await.unwrap();
    let mut status = RunStatus::Running;
    for _ in 0..200 {
        if let Some(r) = state.get_run(&id).await {
            if r.status != RunStatus::Running {
                status = r.status;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(status, RunStatus::Completed);
    let (run, spans) = state.load_trace(&id).unwrap();
    assert!(matches!(run.source, Source::Log));
    assert_eq!(run.agent_id, "nightly-research");
    assert!(spans.iter().any(|s| s.name == "gather"));
    assert!(spans.iter().any(|s| s.name == "save-results"));
}

#[tokio::test]
async fn failed_step_marks_run_failed() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let id = state.launch_workflow("build-report".into(), "x".into()).await.unwrap();
    for _ in 0..200 {
        if let Some(r) = state.get_run(&id).await {
            if r.status != RunStatus::Running {
                assert_eq!(r.status, RunStatus::Failed);
                return;
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("run never terminal");
}
```

- [ ] **Step 3: Build + verify** — `cargo build && cargo test -p tau-gateway --test workflow_run` → 3 pass. `cargo test -p tau-gateway` (no regressions). `cargo fmt --all && cargo clippy --all-targets -- -D warnings` clean.

- [ ] **Step 4: Commit**
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/state.rs gateway/tests/workflow_run.rs
git commit -m "feat(gateway): AppState.launch_workflow + list_workflows (source=log)"
```

---

### Task 4: Gateway — workflow API

**Files:** Create `gateway/src/api/workflows.rs`; modify `gateway/src/api/mod.rs`

- [ ] **Step 1: Implement** `gateway/src/api/workflows.rs`:
```rust
use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn list(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "workflows": state.list_workflows() }))
}

#[derive(Deserialize)]
pub struct RunBody {
    pub workflow: String,
    pub input: String,
}

pub async fn run(State(state): State<AppState>, Json(body): Json<RunBody>)
    -> Result<Json<Value>, (StatusCode, String)>
{
    let run_id = state
        .launch_workflow(body.workflow, body.input)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    Ok(Json(json!({ "run_id": run_id })))
}
```

- [ ] **Step 2: Routes** — in `gateway/src/api/mod.rs`, add `pub mod workflows;` and two routes inside `router`:
```rust
        .route("/api/workflows", get(workflows::list))
        .route("/api/workflows/run", post(workflows::run))
```
(Place alongside the existing `/api/runs` routes; `get`/`post` are already imported.)

- [ ] **Step 3: Smoke + commit**
```bash
cargo build
./target/debug/tau-gateway --project ./fixtures/demo --tau-bin ./target/debug/fake-tau-serve --no-sandbox --port 4321 &
GW=$!; sleep 1
echo "--- workflows ---"; curl -s localhost:4321/api/workflows
echo; echo "--- run ---"; curl -s -X POST localhost:4321/api/workflows/run -H 'content-type: application/json' -d '{"workflow":"nightly-research","input":"q3"}'
echo; sleep 1
echo "--- runs (should include a source:log row) ---"; curl -s localhost:4321/api/runs | python3 -c "import sys,json; print([(r['agent_id'],r['source'],r['status']) for r in json.load(sys.stdin)])"
kill $GW
```
Expected: `{"workflows":["build-report","nightly-research"]}`; run returns a `run_id`; the runs list includes a `("nightly-research","log","completed")` row.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/api/workflows.rs gateway/src/api/mod.rs
git commit -m "feat(gateway): GET /api/workflows + POST /api/workflows/run"
```

---

### Task 5: Frontend — API client + store

**Files:** Modify `web/src/api/client.ts`, `web/src/store/store.ts`; Test: extend `web/src/store/store.test.ts`

- [ ] **Step 1: API client** — add to `web/src/api/client.ts`:
```ts
export const getWorkflows = () =>
  fetch("/api/workflows").then(json<{ workflows: string[] }>).then((r) => r.workflows);

export function launchWorkflow(workflow: string, input: string): Promise<string> {
  return fetch("/api/workflows/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow, input }),
  })
    .then(json<{ run_id: string }>)
    .then((r) => r.run_id);
}
```

- [ ] **Step 2: Store** — in `web/src/store/store.ts`:
- import `getWorkflows, launchWorkflow` from the client.
- add to the `AppStore` interface: `workflows: string[];`, `loadWorkflows: () => Promise<void>;`, `launchWorkflow: (workflow: string, input: string) => Promise<string>;`.
- initial state: `workflows: [],`.
- actions (next to `launch`/`refreshRuns`):
```ts
  loadWorkflows: async () => {
    try {
      set({ workflows: await getWorkflows() });
    } catch {
      /* ignore */
    }
  },
  launchWorkflow: async (workflow, input) => {
    const id = await launchWorkflow(workflow, input);
    await get().refreshRuns();
    return id;
  },
```

- [ ] **Step 3: Store test** — append to `web/src/store/store.test.ts`:
```ts
describe("store.loadWorkflows", () => {
  it("stores workflow names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workflows: ["wf-a", "wf-b"] }) }),
    );
    await useStore.getState().loadWorkflows();
    expect(useStore.getState().workflows).toEqual(["wf-a", "wf-b"]);
    vi.restoreAllMocks();
  });
});
```
Run `pnpm vitest run src/store/store.test.ts` → pass. `pnpm lint && pnpm format:check && pnpm build` clean. Commit:
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/api/client.ts web/src/store/store.ts web/src/store/store.test.ts
git commit -m "feat(web): workflow API client + store (getWorkflows, launchWorkflow)"
```

---

### Task 6: Frontend — type chip + filter bar

**Files:** Modify `web/src/runs/badges.tsx`, `web/src/runs/RunsTable.tsx`, `web/src/runs/RunsView.tsx`; Test: `web/src/runs/RunsTable.test.tsx` (must stay green) + a new filter case

- [ ] **Step 1: TypeBadge** — add to `web/src/runs/badges.tsx`:
```tsx
export function TypeBadge({ source }: { source: Run["source"] }) {
  const isWf = source === "log";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
        isWf ? "bg-accent/15 text-accent" : "bg-st-running-soft text-st-running"
      }`}
    >
      {isWf ? "WF" : "AG"}
    </span>
  );
}
```

- [ ] **Step 2: RunsTable type chip** — in `web/src/runs/RunsTable.tsx`, import `TypeBadge` from `./badges`, add a header `<th className="px-3 py-2 font-medium">Type</th>` as the FIRST column, and a cell `<td className="px-3 py-2"><TypeBadge source={r.source} /></td>` as the first cell of each row. (Keep all existing columns/text — `greeter`, `completed`, `host · dev`, `… tok`, empty state — so the existing test passes.)

- [ ] **Step 3: Filter bar in RunsView** — replace `web/src/runs/RunsView.tsx`:
```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { usePollRuns } from "./usePollRuns";
import { Launcher } from "./Launcher";
import { RunsTable } from "./RunsTable";
import { RunsOverview } from "./RunsOverview";

type Filter = "all" | "workflow" | "agent";

export function RunsView() {
  const runs = useStore((s) => s.runs);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  usePollRuns();

  const shown = runs.filter((r) =>
    filter === "all" ? true : filter === "workflow" ? r.source === "log" : r.source !== "log",
  );

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "workflow", label: "Workflows" },
    { id: "agent", label: "Agents" },
  ];

  return (
    <section className="p-4">
      <h2 className="mb-3 text-base font-semibold">Runs</h2>
      <Launcher />
      <RunsOverview />
      <div className="mb-2 inline-flex rounded-md border border-border bg-surface p-0.5 text-xs">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`rounded px-2.5 py-1 font-medium ${
              filter === t.id ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <RunsTable runs={shown} onOpen={(id) => navigate(`/runs/${id}`)} />
    </section>
  );
}
```

- [ ] **Step 4: New filter test** — create `web/src/runs/RunsView.filter.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunsView } from "./RunsView";
import { useStore } from "../store/store";
import type { Run } from "../types/Run";

function run(id: string, source: Run["source"], agent: string): Run {
  return {
    id, agent_id: agent, prompt: "p", substrate: "host", mode: "dev", status: "completed",
    started_at: "2026-05-31T00:00:00Z", ended_at: "2026-05-31T00:00:01Z", total_turns: 1,
    token_usage: null, stop_reason: "end_turn", error: null, source,
  };
}

describe("RunsView filter", () => {
  it("filters to workflows / agents", () => {
    useStore.setState({ runs: [run("a", "serve", "greeter"), run("b", "log", "nightly-research")] });
    render(<MemoryRouter><RunsView /></MemoryRouter>);
    expect(screen.getByText("greeter")).toBeInTheDocument();
    expect(screen.getByText("nightly-research")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Workflows" }));
    expect(screen.queryByText("greeter")).toBeNull();
    expect(screen.getByText("nightly-research")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Verify + commit** — `pnpm vitest run` (RunsTable test + new filter test + all green); `pnpm lint && pnpm format:check && pnpm build`.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/runs/badges.tsx web/src/runs/RunsTable.tsx web/src/runs/RunsView.tsx web/src/runs/RunsView.filter.test.tsx
git commit -m "feat(web): runs list — WF/AG type chip + workflow/agent filter bar"
```

---

### Task 7: Frontend — Launcher Agent|Workflow toggle

**Files:** Modify `web/src/runs/Launcher.tsx`; Test: `web/src/runs/Launcher.test.tsx`

- [ ] **Step 1: Failing test** — create `web/src/runs/Launcher.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Launcher } from "./Launcher";
import { useStore } from "../store/store";

beforeEach(() => {
  useStore.setState({
    project: { project_path: "/p", agents: ["greeter"], tau_version: "x" },
    workflows: ["nightly-research"],
  });
});

describe("Launcher", () => {
  it("switches to Workflow mode and calls launchWorkflow", async () => {
    const launchWorkflow = vi.fn().mockResolvedValue("R1");
    useStore.setState({ launchWorkflow });
    render(<MemoryRouter><Launcher /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Workflow" }));
    expect(screen.getByRole("option", { name: "nightly-research" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("prompt"), { target: { value: "q3" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(launchWorkflow).toHaveBeenCalledWith("nightly-research", "q3");
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement** — replace `web/src/runs/Launcher.tsx`:
```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";

type Mode = "agent" | "workflow";

export function Launcher() {
  const project = useStore((s) => s.project);
  const workflows = useStore((s) => s.workflows);
  const launch = useStore((s) => s.launch);
  const launchWorkflow = useStore((s) => s.launchWorkflow);
  const loadWorkflows = useStore((s) => s.loadWorkflows);
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("agent");
  const [agent, setAgent] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadWorkflows().catch(() => {});
  }, [loadWorkflows]);

  const agents = project?.agents ?? [];
  const selAgent = agent || agents[0] || "";
  const selWorkflow = workflow || workflows[0] || "";
  const target = mode === "agent" ? selAgent : selWorkflow;

  async function onRun() {
    if (!target || !prompt.trim()) return;
    setBusy(true);
    try {
      const id = mode === "agent" ? await launch(selAgent, prompt) : await launchWorkflow(selWorkflow, prompt);
      setPrompt("");
      navigate(`/runs/${id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-xs">
        {(["agent", "workflow"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-2.5 py-1 font-medium capitalize ${
              mode === m ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      {mode === "agent" ? (
        <select
          value={selAgent}
          onChange={(e) => setAgent(e.target.value)}
          aria-label="agent"
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
        >
          {agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={selWorkflow}
          onChange={(e) => setWorkflow(e.target.value)}
          aria-label="workflow"
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
        >
          {workflows.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      )}
      <input
        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
        placeholder={mode === "agent" ? "Prompt…" : "Workflow input…"}
        value={prompt}
        aria-label="prompt"
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onRun()}
      />
      <button
        onClick={onRun}
        disabled={busy || !target}
        className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
      >
        {busy ? "Running…" : "Run"}
      </button>
    </div>
  );
}
```
Run `pnpm vitest run src/runs/Launcher.test.tsx` → PASS. (The agent `aria-label="agent"`, the `Run` button, and `aria-label="prompt"` are preserved, so the Playwright agent-run e2e still works.)

- [ ] **Step 3: Verify + commit** — `pnpm vitest run && pnpm lint && pnpm format:check && pnpm build` clean.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/runs/Launcher.tsx web/src/runs/Launcher.test.tsx
git commit -m "feat(web): Launcher Agent|Workflow toggle"
```

---

### Task 8: Frontend — workflow trace (Timeline default + gated drill)

**Files:** Modify `web/src/trace/TraceView.tsx`, `web/src/trace/SpanInspector.tsx`; Test: `web/src/trace/SpanInspector.test.tsx` (extend)

- [ ] **Step 1: SpanInspector gated drill** — replace `web/src/trace/SpanInspector.tsx`:
```tsx
import type { Span } from "../types/Span";

function Section({ title, value }: { title: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="mb-2.5">
      <div className="text-[11px] uppercase text-muted">{title}</div>
      <pre className="m-0 overflow-auto rounded-md bg-bg p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export function SpanInspector({ span, workflow }: { span: Span | null; workflow?: boolean }) {
  if (!span) return <p className="p-3 text-sm text-muted">Select a node to inspect.</p>;
  const attrs = (span.attributes ?? {}) as Record<string, unknown>;
  const showDrill = workflow && span.kind === "agent";
  return (
    <div className="overflow-auto p-3">
      <h3 className="mb-1 mt-0 text-sm font-semibold">{span.name}</h3>
      <div className="mb-2 text-xs text-muted">
        {span.kind} · {span.status}
      </div>
      <Section title="Input" value={attrs.input} />
      <Section title="Output" value={attrs.output} />
      <Section title="Args" value={attrs.args} />
      <Section title="Result" value={attrs.result} />
      <Section title="Tokens / usage" value={attrs.usage ?? attrs.token_usage} />
      <Section title="Error" value={attrs.error} />
      {showDrill && (
        <button
          disabled
          title="tau doesn't link a workflow step to the agent's run yet"
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted"
        >
          ↗ view agent trace
          <span className="rounded bg-amber-100 px-1 text-[9px] font-bold uppercase text-amber-800">
            gated
          </span>
        </button>
      )}
    </div>
  );
}
```
(Adds `Input`/`Output` sections — workflow steps store those — without removing the existing Args/Result/etc. The SpanInspector test's `fs-read` span has `args`/`result`, still rendered.)

- [ ] **Step 2: Extend SpanInspector test** — append to `web/src/trace/SpanInspector.test.tsx`:
```tsx
it("shows the gated agent-drill for a workflow agent step", () => {
  const span = {
    id: "s", parent_id: null, run_id: "R", kind: "agent", name: "gather",
    status: "ok", started_at: "t", ended_at: "t2",
    attributes: { input: "hi", output: "done" },
  } as unknown as import("../types/Span").Span;
  render(<SpanInspector span={span} workflow />);
  expect(screen.getByText(/view agent trace/i)).toBeInTheDocument();
  expect(screen.getByText(/gated/i)).toBeInTheDocument();
});

it("no drill for a normal agent-run trace", () => {
  const span = {
    id: "s", parent_id: null, run_id: "R", kind: "agent", name: "x",
    status: "ok", started_at: "t", ended_at: "t2", attributes: {},
  } as unknown as import("../types/Span").Span;
  render(<SpanInspector span={span} />);
  expect(screen.queryByText(/view agent trace/i)).toBeNull();
});
```
(Ensure `screen`/`render` are imported in the test file — they already are.)

- [ ] **Step 3: TraceView — Timeline default + pass workflow flag** — in `web/src/trace/TraceView.tsx`:
- compute `const isWorkflow = trace.run.source === "log";`
- initialize the tab from it: change `const [tab, setTab] = useState<TraceTab>("graph");` to:
```tsx
  const [tab, setTab] = useState<TraceTab>(trace.run.source === "log" ? "timeline" : "graph");
```
Wait — `trace` is computed after the early `if (!trace) return …`. Move the `useState` so it doesn't read `trace` before the guard: keep `useState<TraceTab>("graph")` at the top (hooks must be unconditional), and add an effect after the guard:
```tsx
  // (top, with other hooks)
  const [tab, setTab] = useState<TraceTab>("graph");
  const isWorkflow = trace?.run.source === "log";
  useEffect(() => {
    setTab(isWorkflow ? "timeline" : "graph");
  }, [isWorkflow]);
```
Add `import { useEffect } from "react";` (merge with the existing `useState` import). Then pass the flag to the inspector: `<SpanInspector span={selected} workflow={isWorkflow} />`. (Hooks stay above the `if (!trace)` guard; `trace?.` is safe.)

- [ ] **Step 4: Verify + commit** — `pnpm vitest run && pnpm lint && pnpm format:check && pnpm build` clean.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/trace/TraceView.tsx web/src/trace/SpanInspector.tsx web/src/trace/SpanInspector.test.tsx
git commit -m "feat(web): workflow trace — Timeline default + gated agent-drill + step I/O"
```

---

### Task 9: Frontend — Dashboard type facet

**Files:** Modify `web/src/dashboard/metrics.ts`, `web/src/dashboard/metrics.test.ts`, `web/src/dashboard/DashboardPage.tsx`

- [ ] **Step 1: metrics byKind** — in `web/src/dashboard/metrics.ts`, add `byKind: { workflow: number; agent: number };` to the `Metrics` interface, and compute it in `computeMetrics` (count `source === "log"` as workflow else agent):
```ts
  // inside computeMetrics, after the byStatus loop or alongside it:
  const byKind = { workflow: 0, agent: 0 };
  for (const r of runs) {
    if (r.source === "log") byKind.workflow += 1;
    else byKind.agent += 1;
  }
```
and include `byKind` in the returned object.

- [ ] **Step 2: metrics test** — append to `web/src/dashboard/metrics.test.ts` (inside the existing describe, reusing its `run` helper / `runs` fixture — the 3-run fixture has all `source:"serve"`; add an assertion):
```ts
  it("counts by kind (workflow vs agent)", () => {
    const m = computeMetrics(runs, T(2));
    expect(m.byKind).toEqual({ workflow: 0, agent: 3 });
  });
```

- [ ] **Step 3: Dashboard sub-line** — in `web/src/dashboard/DashboardPage.tsx`, change the **Runs** StatCard's `sub` to include the kind split:
```tsx
        <StatCard
          label="Runs"
          value={m.total}
          sub={`${m.byKind.workflow} wf · ${m.byKind.agent} agent`}
        />
```
(Leave the other cards unchanged.)

- [ ] **Step 4: Verify + commit** — `pnpm vitest run && pnpm lint && pnpm format:check && pnpm build` clean.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/dashboard/metrics.ts web/src/dashboard/metrics.test.ts web/src/dashboard/DashboardPage.tsx
git commit -m "feat(web): dashboard workflow/agent kind facet"
```

---

### Task 10: End-to-end verification

**Files:** Modify `web/e2e/run.spec.ts` (add a workflow case)

- [ ] **Step 1: Add a Playwright workflow case** — append to `web/e2e/run.spec.ts`:
```ts
test("launch a workflow and watch the step trace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Workflow" }).click();
  await page.getByLabel("workflow").selectOption("nightly-research");
  await page.getByLabel("prompt").fill("q3 churn");
  await page.getByRole("button", { name: "Run" }).click();

  // step trace builds (Timeline default for workflows)
  await expect(page.getByText("gather")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("save-results")).toBeVisible({ timeout: 5000 });

  // a workflow agent step shows the gated drill
  await page.getByText("gather").click();
  await expect(page.getByText(/view agent trace/i)).toBeVisible();
  await expect(page.getByText("completed")).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Full gate + e2e**
```bash
cd /Users/titouanlebocq/code/tau-ui && cargo build --workspace && cargo test -p tau-gateway 2>&1 | grep "test result"
cd web && pnpm vitest run && pnpm lint && pnpm format:check && pnpm typecheck && pnpm build
pnpm exec playwright install chromium && CI=1 pnpm e2e
```
Expected: all green; the new workflow e2e passes alongside the existing two. If "gather" never appears, check the launcher `aria-label="workflow"` select and that `POST /api/workflows/run` returns a run_id (the gateway must be built with the workflow routes).

- [ ] **Step 3: Manual look (no commit)** — gateway + `pnpm dev`; flip the Launcher to **Workflow**, run `nightly-research`, watch the step waterfall; click `gather` → gated drill; check the Runs filter (All/Workflows/Agents) + the WF/AG chips + the Dashboard `wf · agent` sub-line.

- [ ] **Step 4: Update seams doc + push** — in `docs/seams.md`, change the log-adapter row to note it's implemented for workflows (drill gated):
```markdown
| log-adapter (workflows) | `gateway/src/adapters/log.rs` — IMPLEMENTED (StepRecord→spans); step→agent drill gated | tau step→agent-run linkage (future) |
```
Then:
```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "test(e2e): workflow launch + step trace; mark log-adapter implemented"
git push
gh run watch "$(gh run list --branch impl/gateway-v1 --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status --interval 20
```
Expected: `rust`, `web`, `e2e` all green.

---

## Self-review
1. **Spec coverage:** §2.1 log-adapter → T1; §2.2 runner (Mock+Cli) + scripts → T2; §2.3 list_workflows/launch_workflow → T3; §2.4 API → T4; §3 fixtures → T2; §4 client/store → T5, list+filter → T6, launcher toggle → T7, workflow trace (Timeline default + gated drill + step I/O) → T8, dashboard facet → T9; §5 testing → tests in T1–T9 + e2e in T10; §6 non-goals respected (no authoring/cancel/resume/real-linkage); seams doc → T10. ✓
2. **Placeholder scan:** every step has full code; the `CliRunner` "seam" is a complete graceful-error stub (not a TODO). ✓
3. **Type consistency:** `StepRecord` fields (T1) consumed by `MockRunner` (T2) and `launch_workflow` (T3); `WorkflowItem`/`WorkflowRunner` (T2) used by AppState (T3); `Source::Log` drives the frontend `source === "log"` checks (T6/T8/T9); `launchWorkflow(workflow, input)` signature matches across client/store/Launcher; `TypeBadge` prop `source` consistent; `SpanInspector` gains optional `workflow?` (T8) — existing callers (agent trace) pass nothing → no drill. ✓
4. **Hooks note (T8):** the `useState`/`useEffect` for the tab stay above the `if (!trace)` guard (unconditional hooks); `trace?.run.source` is null-safe. Existing TraceView behavior for agent runs is unchanged (defaults to graph). ✓
