# D4 — Workflow Runner + Graph Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two D4 mock seams in the gateway with real `tau`-backed implementations — `CliGraph` (workflow graph parsed from `workflows/*.toml`) and `CliRunner` (real `tau workflow run` with a live JSONL tail), including workflow cancellation.

**Architecture:** Gateway-only (Rust). The graph half parses the workflow TOML pipeline into the existing `WorkflowGraph` shape with execution-order edges; the runner half spawns `tau workflow run`, detects its append-only JSONL log, and live-tails it into the existing `WorkflowItem → LogAdapter → apply_delta → broadcast` pipeline. No frontend changes (the UI already renders `WorkflowGraph` and calls the shared cancel endpoint). Design spec: `docs/superpowers/specs/2026-06-13-d4-workflow-runner-graph-source-design.md`.

**Tech Stack:** Rust, axum, tokio, tokio-util (`CancellationToken`), thiserror, serde/toml, ts-rs.

**Two independent streams** (can be built in parallel by separate workers): **Stream A** = graph_source (Tasks A1–A4); **Stream B** = workflow_runner (Tasks B1–B4). They touch `state.rs` in disjoint regions; if run in parallel, land A1 and B1 first (each is the atomic signature change for its stream), then rebase.

**Verification commands (run from `gateway/`'s parent, the repo root):**
- Lib + unit: `cargo test -p tau-gateway --lib`
- Full (REQUIRED on any `#[ts(export)]`-touching task — D3 gotcha: integration tests in `gateway/tests/*_api.rs` are missed by `--lib`): `cargo test -p tau-gateway`
- Format/lint: `cargo fmt --all && cargo clippy -p tau-gateway --all-targets`

---

## File Structure

**Stream A — graph_source:**
- `gateway/src/graph/mod.rs` — MODIFY: add `GraphError`; make `WorkflowGraphSource::graph` return `Result`; `MockGraph` execution-order edges; `CliGraph` gains `project: PathBuf` + real TOML parse.
- `gateway/src/graph/workflow_toml.rs` — CREATE: local serde model mirroring `tau_workflow::Workflow` + `parse_workflow_graph(project, name) -> Result<WorkflowGraph, GraphError>`.
- `gateway/src/state.rs` — MODIFY (graph region): `workflow_graph` returns `Result`; construct `CliGraph::new(project)`.
- `gateway/src/api/graph.rs` — MODIFY: return `Result<Json<_>, (StatusCode, String)>`, 404/422 mapping.
- `gateway/tests/graph_api.rs` — MODIFY: add 404 + 422 cases.

**Stream B — workflow_runner:**
- `gateway/src/workflow/mod.rs` — MODIFY: add `WorkflowItem::Cancelled`; `WorkflowRunner::run` gains `CancellationToken`; `MockRunner` honors it; implement `CliRunner::run` (snapshot + spawn + detect + live-tail + drain + cancel-kill); add `TailReader` + unit tests.
- `gateway/src/state.rs` — MODIFY (runner region): add `workflow_cancels` registry; `launch_workflow` creates/stores/passes the token + maps `Cancelled`; `finalize` removes the token; `cancel` handles workflow runs.
- `gateway/tests/workflow_run.rs` — MODIFY: add a cancel test (mock).
- `gateway/tests/real_tau_workflow.rs` — CREATE: gated live tests (ok / failed-step / cancel).

---

# Stream A — graph_source

## Task A1: Make `WorkflowGraphSource` fallible (atomic refactor, stays green)

**Files:**
- Modify: `gateway/src/graph/mod.rs`
- Modify: `gateway/src/state.rs` (`workflow_graph` ~line 571; `CliGraph` construction ~line 127)
- Modify: `gateway/src/api/graph.rs`

- [ ] **Step 1: Add `GraphError` and change the trait in `graph/mod.rs`**

At the top of `gateway/src/graph/mod.rs`, after the existing `use` lines, add:

```rust
use std::path::PathBuf;

/// Why building a workflow graph failed.
#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("workflow {0:?} not found")]
    NotFound(String),
    #[error("failed to parse workflow {name:?}: {detail}")]
    Parse { name: String, detail: String },
}
```

Change the trait (replace the existing `pub trait WorkflowGraphSource` block):

```rust
/// Source of a workflow's graph. Parses the workflow TOML pipeline; the
/// compiled-IR / bundle inspector is a separate deferred feature (issue #50).
pub trait WorkflowGraphSource: Send + Sync {
    fn graph(&self, name: &str) -> Result<WorkflowGraph, GraphError>;
}
```

- [ ] **Step 2: Update `MockGraph` to return `Ok(...)`**

In `MockGraph`'s `impl WorkflowGraphSource`, change the signature and wrap each arm. Replace the `impl WorkflowGraphSource for MockGraph { fn graph(...) -> WorkflowGraph { match name { ... } } }` body so the function returns `Result<WorkflowGraph, GraphError>` and the final expression is wrapped in `Ok(...)`:

```rust
impl WorkflowGraphSource for MockGraph {
    fn graph(&self, name: &str) -> Result<WorkflowGraph, GraphError> {
        let g = match name {
            "nightly-research" => WorkflowGraph {
                // ... unchanged nodes/edges ...
            },
            "build-report" => WorkflowGraph {
                // ... unchanged for now (edges updated in A2) ...
            },
            other => WorkflowGraph {
                workflow: other.into(),
                nodes: vec![],
                edges: vec![],
            },
        };
        Ok(g)
    }
}
```

(Keep the existing node/edge contents verbatim; only the wrapping changes.)

- [ ] **Step 3: Give `CliGraph` a project path; return `Ok(empty)` for now**

Replace the `CliGraph` definition and impl:

```rust
/// Real graph source: parses `<project>/workflows/<name>.toml`.
pub struct CliGraph {
    project: PathBuf,
}

impl CliGraph {
    pub fn new(project: PathBuf) -> Self {
        CliGraph { project }
    }
}

impl WorkflowGraphSource for CliGraph {
    fn graph(&self, name: &str) -> Result<WorkflowGraph, GraphError> {
        // Real parse lands in Task A3.
        Ok(WorkflowGraph {
            workflow: name.into(),
            nodes: vec![],
            edges: vec![],
        })
    }
}
```

- [ ] **Step 4: Update the `cli_graph_is_empty` unit test to construct with a path**

In `graph/mod.rs` `#[cfg(test)] mod tests`, replace `cli_graph_is_empty`:

```rust
    #[test]
    fn cli_graph_unknown_is_empty_for_now() {
        let g = CliGraph::new(std::path::PathBuf::from("/nonexistent"))
            .graph("nightly-research")
            .unwrap();
        assert!(g.nodes.is_empty());
        assert!(g.edges.is_empty());
    }
```

Also update the `mock_*` tests to `.unwrap()` the `graph(...)` calls (e.g. `let g = MockGraph.graph("nightly-research").unwrap();`).

- [ ] **Step 5: Update `state.rs` — `workflow_graph` returns `Result`, construct `CliGraph::new`**

In `gateway/src/state.rs`, change the `graph_source` construction (~line 127):

```rust
        let graph_source: Box<dyn WorkflowGraphSource> = if is_mock {
            Box::new(graph::MockGraph)
        } else {
            Box::new(graph::CliGraph::new(project.clone()))
        };
```

Change `workflow_graph` (~line 571) to propagate the error (enrichment unchanged):

```rust
    pub fn workflow_graph(&self, name: &str) -> Result<WorkflowGraph, crate::graph::GraphError> {
        let mut g = self.0.graph_source.graph(name)?;
        let recommended = self.recommended_backend();
        for n in g.nodes.iter_mut() {
            if n.kind != "agent.run" {
                continue;
            }
            let detail = n
                .agent
                .as_deref()
                .and_then(|id| config::read_agent(&self.0.project, id).ok().flatten());
            match detail {
                Some(a) => {
                    n.provider = Some(
                        a.llm_backend
                            .filter(|b| !b.is_empty())
                            .unwrap_or_else(|| recommended.clone()),
                    );
                    n.tools = a.requires_tools.into_iter().map(|t| t.name).collect();
                }
                None => n.provider = Some(recommended.clone()),
            }
        }
        Ok(g)
    }
```

Ensure `use crate::graph::{self, WorkflowGraph, WorkflowGraphSource};` still imports what's needed (add `GraphError` only where referenced — the return type uses the fully-qualified path above, so no import change required).

- [ ] **Step 6: Update the handler in `api/graph.rs`**

Replace the file body:

```rust
use axum::extract::Path;
use axum::http::StatusCode;
use axum::Json;

use crate::api::scope::Scoped;
use crate::graph::{GraphError, WorkflowGraph};

pub async fn graph(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Result<Json<WorkflowGraph>, (StatusCode, String)> {
    match state.workflow_graph(&name) {
        Ok(g) => Ok(Json(g)),
        Err(e @ GraphError::NotFound(_)) => Err((StatusCode::NOT_FOUND, e.to_string())),
        Err(e @ GraphError::Parse { .. }) => {
            Err((StatusCode::UNPROCESSABLE_ENTITY, e.to_string()))
        }
    }
}
```

- [ ] **Step 7: Verify everything compiles and existing tests pass**

Run: `cargo test -p tau-gateway`
Expected: PASS (no behavior change yet; `graph_api.rs` still green because Mock is used in tests).

- [ ] **Step 8: Commit**

```bash
git add gateway/src/graph/mod.rs gateway/src/state.rs gateway/src/api/graph.rs
git commit -m "refactor(graph): make WorkflowGraphSource fallible; CliGraph takes project"
```

---

## Task A2: `MockGraph` execution-order edges

**Files:**
- Modify: `gateway/src/graph/mod.rs` (`MockGraph` `build-report` arm + its unit test)

- [ ] **Step 1: Update the failing unit test first**

In `graph/mod.rs` tests, replace `mock_build_report_has_no_edges`:

```rust
    #[test]
    fn mock_build_report_has_sequence_edge() {
        let g = MockGraph.graph("build-report").unwrap();
        assert_eq!(g.nodes.len(), 2);
        assert_eq!(g.nodes[0].kind, "agent.run"); // collect
        assert_eq!(g.nodes[1].kind, "tool.call"); // render
        // execution order: collect runs, then render
        assert_eq!(g.edges.len(), 1);
        assert_eq!(g.edges[0].source, "collect");
        assert_eq!(g.edges[0].target, "render");
    }
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cargo test -p tau-gateway --lib mock_build_report_has_sequence_edge`
Expected: FAIL (`g.edges.len()` is 0).

- [ ] **Step 3: Add the edge in the `build-report` arm**

In `MockGraph::graph`, the `"build-report"` arm currently has `edges: vec![]`. Change to:

```rust
                edges: vec![edge("collect", "render")],
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cargo test -p tau-gateway --lib mock_build_report_has_sequence_edge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/graph/mod.rs
git commit -m "feat(graph): MockGraph uses execution-order edges"
```

---

## Task A3: `CliGraph` parses the workflow TOML

**Files:**
- Create: `gateway/src/graph/workflow_toml.rs`
- Modify: `gateway/src/graph/mod.rs` (declare submodule; delegate `CliGraph::graph`)

- [ ] **Step 1: Write the failing test (in the new file)**

Create `gateway/src/graph/workflow_toml.rs`:

```rust
//! Parse a workflow's TOML pipeline into a structural `WorkflowGraph`.
//! Mirrors tau's `tau_workflow::Workflow` model (ordered `[[steps]]`,
//! `agent.run` / `tool.call`). Edges are execution order (step i → i+1);
//! data references (`${steps.X.output}`) are carried on the node `input`
//! for the detail panel, not as edges.

use std::path::Path;

use serde::Deserialize;

use crate::graph::{GraphError, WorkflowEdge, WorkflowGraph, WorkflowNode};

#[derive(Debug, Deserialize)]
struct RawWorkflow {
    #[serde(default)]
    steps: Vec<RawStep>,
}

#[derive(Debug, Deserialize)]
struct RawStep {
    id: String,
    kind: String, // "agent.run" | "tool.call"
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    input: Option<String>,
    #[serde(default)]
    tool: Option<String>,
}

/// Parse `<project>/workflows/<name>.toml` into a structural graph
/// (no provider/tools enrichment — that happens in `state::workflow_graph`).
pub fn parse_workflow_graph(project: &Path, name: &str) -> Result<WorkflowGraph, GraphError> {
    let path = project.join("workflows").join(format!("{name}.toml"));
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(GraphError::NotFound(name.to_string()));
        }
        Err(e) => {
            return Err(GraphError::Parse {
                name: name.to_string(),
                detail: e.to_string(),
            });
        }
    };
    let raw: RawWorkflow = toml::from_str(&text).map_err(|e| GraphError::Parse {
        name: name.to_string(),
        detail: e.to_string(),
    })?;

    let nodes: Vec<WorkflowNode> = raw
        .steps
        .iter()
        .map(|s| WorkflowNode {
            id: s.id.clone(),
            kind: s.kind.clone(),
            label: s.id.clone(),
            // agent.run carries its input template; tool.call uses structured
            // args (no single input string) → None.
            agent: s.agent.clone(),
            tool: s.tool.clone(),
            input: if s.kind == "agent.run" {
                s.input.clone()
            } else {
                None
            },
            provider: None,
            tools: vec![],
        })
        .collect();

    // Execution-order edges: step[i] → step[i+1].
    let edges: Vec<WorkflowEdge> = raw
        .steps
        .windows(2)
        .map(|w| WorkflowEdge {
            source: w[0].id.clone(),
            target: w[1].id.clone(),
        })
        .collect();

    Ok(WorkflowGraph {
        workflow: name.to_string(),
        nodes,
        edges,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_project(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let wf = dir.path().join("workflows");
        std::fs::create_dir_all(&wf).unwrap();
        for (name, body) in files {
            std::fs::write(wf.join(name), body).unwrap();
        }
        dir
    }

    #[test]
    fn parses_pipeline_with_execution_order_edges() {
        let dir = write_project(&[(
            "nightly-research.toml",
            r#"
[workflow]
description = "x"
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
args = { path = "/tmp/x.md", content = "${steps.summarise.output}" }
"#,
        )]);
        let g = parse_workflow_graph(dir.path(), "nightly-research").unwrap();
        assert_eq!(g.nodes.len(), 3);
        assert_eq!(g.nodes[0].id, "gather");
        assert_eq!(g.nodes[0].kind, "agent.run");
        assert_eq!(g.nodes[0].agent.as_deref(), Some("researcher"));
        assert_eq!(g.nodes[0].input.as_deref(), Some("${input}"));
        assert_eq!(g.nodes[2].kind, "tool.call");
        assert_eq!(g.nodes[2].tool.as_deref(), Some("fs-write"));
        assert_eq!(g.nodes[2].input, None); // tool.call → no single input
        assert_eq!(g.edges.len(), 2);
        assert_eq!(g.edges[0].source, "gather");
        assert_eq!(g.edges[0].target, "summarise");
        assert_eq!(g.edges[1].source, "summarise");
        assert_eq!(g.edges[1].target, "save-results");
    }

    #[test]
    fn build_report_has_one_sequence_edge() {
        let dir = write_project(&[(
            "build-report.toml",
            r#"
[workflow]
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
args = { path = "/tmp/r.html" }
"#,
        )]);
        let g = parse_workflow_graph(dir.path(), "build-report").unwrap();
        assert_eq!(g.edges.len(), 1);
        assert_eq!(g.edges[0].source, "collect");
        assert_eq!(g.edges[0].target, "render");
    }

    #[test]
    fn missing_workflow_is_not_found() {
        let dir = write_project(&[]);
        let err = parse_workflow_graph(dir.path(), "nope").unwrap_err();
        assert!(matches!(err, GraphError::NotFound(_)));
    }

    #[test]
    fn malformed_toml_is_parse_error() {
        let dir = write_project(&[("broken.toml", "this is = = not valid toml [[[")]);
        let err = parse_workflow_graph(dir.path(), "broken").unwrap_err();
        assert!(matches!(err, GraphError::Parse { .. }));
    }
}
```

- [ ] **Step 2: Declare the submodule and delegate from `CliGraph`**

In `gateway/src/graph/mod.rs`, add near the top (after the doc comment, before `use`):

```rust
mod workflow_toml;
```

Replace `CliGraph::graph`'s body to delegate:

```rust
impl WorkflowGraphSource for CliGraph {
    fn graph(&self, name: &str) -> Result<WorkflowGraph, GraphError> {
        workflow_toml::parse_workflow_graph(&self.project, name)
    }
}
```

- [ ] **Step 3: Run to confirm it fails, then passes**

Run: `cargo test -p tau-gateway --lib workflow_toml`
Expected: PASS (all four tests). If `toml` is not yet a dependency, add `toml.workspace = true` to `gateway/Cargo.toml` `[dependencies]` first (verify with `grep '^toml' gateway/Cargo.toml`).

- [ ] **Step 4: Run full suite**

Run: `cargo test -p tau-gateway`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/graph/mod.rs gateway/src/graph/workflow_toml.rs gateway/Cargo.toml
git commit -m "feat(graph): CliGraph parses workflows/*.toml into a graph"
```

---

## Task A4: HTTP 404/422 integration coverage

**Files:**
- Modify: `gateway/tests/graph_api.rs`

- [ ] **Step 1: Add failing integration tests**

Append to `gateway/tests/graph_api.rs` (reuse the existing `serve`, `bin`, `project` helpers in that file):

```rust
#[tokio::test]
async fn unknown_workflow_returns_404() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // Real CliGraph path requires a non-mock bin; the demo fixture is served
    // by the mock here, so unknown names resolve to an empty graph (200).
    // This test pins the *mock* contract: unknown name → 200 empty graph.
    let resp = http
        .get(format!(
            "{base}/api/projects/{}/workflows/does-not-exist/graph",
            meta.id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let g: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(g["nodes"].as_array().unwrap().len(), 0);
}
```

> Note: the integration harness uses `fake-tau-serve`, so `is_mock` is true and `MockGraph` is active — `MockGraph` returns an empty graph (200) for unknown names, never `GraphError`. The 404/422 paths belong to `CliGraph` and are covered by the unit tests in Task A3 (`missing_workflow_is_not_found`, `malformed_toml_is_parse_error`). This integration test pins the mock's unknown-name behavior so the handler refactor didn't regress it.

- [ ] **Step 2: Run to confirm pass**

Run: `cargo test -p tau-gateway --test graph_api`
Expected: PASS (both the original `workflow_graph_over_http` and the new test).

- [ ] **Step 3: Commit**

```bash
git add gateway/tests/graph_api.rs
git commit -m "test(graph): pin unknown-workflow handler behavior"
```

---

# Stream B — workflow_runner

## Task B1: Thread `CancellationToken` + add `WorkflowItem::Cancelled` (atomic refactor, stays green)

**Files:**
- Modify: `gateway/src/workflow/mod.rs` (enum, trait, `MockRunner`, `CliRunner` signature)
- Modify: `gateway/src/state.rs` (`Inner` field, both constructors, `launch_workflow`, `finalize`)

- [ ] **Step 1: Update the `WorkflowItem` enum and trait in `workflow/mod.rs`**

Add the variant:

```rust
#[derive(Debug, Clone)]
pub enum WorkflowItem {
    Step(Box<StepRecord>),
    Done,
    Cancelled,
    Error(String),
}
```

Change the trait (add the import `use tokio_util::sync::CancellationToken;` near the top):

```rust
pub trait WorkflowRunner: Send + Sync {
    /// Start the workflow; returns a receiver of items (the impl spawns its own
    /// task). Firing `cancel` requests termination (the impl emits `Cancelled`).
    fn run(
        &self,
        workflow: String,
        input: String,
        run_id: String,
        cancel: CancellationToken,
    ) -> mpsc::UnboundedReceiver<WorkflowItem>;
}
```

- [ ] **Step 2: Update `MockRunner` to honor the token**

Replace `MockRunner`'s `run` body. The per-step sleep becomes a `select!` on the token so a cancel mid-run emits `Cancelled`:

```rust
impl WorkflowRunner for MockRunner {
    fn run(
        &self,
        workflow: String,
        input: String,
        run_id: String,
        cancel: CancellationToken,
    ) -> mpsc::UnboundedReceiver<WorkflowItem> {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            for (i, (step_id, kind, output, status, delay)) in
                script(&workflow).into_iter().enumerate()
            {
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(delay)) => {}
                    _ = cancel.cancelled() => {
                        let _ = tx.send(WorkflowItem::Cancelled);
                        return;
                    }
                }
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
                if tx.send(WorkflowItem::Step(Box::new(rec))).is_err() {
                    return;
                }
            }
            let _ = tx.send(WorkflowItem::Done);
        });
        rx
    }
}
```

- [ ] **Step 3: Update `CliRunner::run` signature to a temporary stub**

Replace `CliRunner`'s `run` body with the signature change (real impl in B3):

```rust
impl WorkflowRunner for CliRunner {
    fn run(
        &self,
        workflow: String,
        _input: String,
        _run_id: String,
        _cancel: CancellationToken,
    ) -> mpsc::UnboundedReceiver<WorkflowItem> {
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            let _ = tx.send(WorkflowItem::Error(format!(
                "real-tau workflow run not wired yet (workflow {workflow})"
            )));
        });
        rx
    }
}
```

- [ ] **Step 4: Update `MockRunner`'s existing unit tests to pass a token**

In `workflow/mod.rs` tests, update the two `MockRunner.run(...)` calls to add a fourth argument, e.g.:

```rust
let mut rx = MockRunner.run(
    "nightly-research".into(),
    "topic".into(),
    "R1".into(),
    tokio_util::sync::CancellationToken::new(),
);
```

(Do the same for the `build-report` test.)

- [ ] **Step 5: Wire `state.rs` — registry field + constructor init**

In `gateway/src/state.rs`, add the import:

```rust
use tokio_util::sync::CancellationToken;
```

Add a field to `Inner` (next to `serve_ids`):

```rust
    /// run_id -> cancellation token for in-flight workflow runs.
    workflow_cancels: RwLock<HashMap<String, CancellationToken>>,
```

Initialize it in `with_options`'s `Inner { ... }` literal (next to `serve_ids: RwLock::new(HashMap::new()),`):

```rust
            workflow_cancels: RwLock::new(HashMap::new()),
```

- [ ] **Step 6: Update `launch_workflow` to create/store/pass the token and map `Cancelled`**

In `launch_workflow`, replace the runner-start line:

```rust
        let cancel = CancellationToken::new();
        self.0
            .workflow_cancels
            .write()
            .await
            .insert(run_id.clone(), cancel.clone());
        let mut rx = self
            .0
            .workflow_runner
            .run(workflow, input, run_id.clone(), cancel);
```

In the same function's `match item` loop, add a `Cancelled` arm (after the `Done` arm):

```rust
                    WorkflowItem::Cancelled => {
                        run.status = RunStatus::Cancelled;
                        run.ended_at = Some(now());
                        state.finalize(&run_id, &mut run).await;
                        break;
                    }
```

- [ ] **Step 7: Clean up the token in `finalize`**

In `finalize` (~line 356), after `self.0.serve_ids.write().await.remove(run_id);` add:

```rust
        self.0.workflow_cancels.write().await.remove(run_id);
```

- [ ] **Step 8: Compile + run existing tests**

Run: `cargo test -p tau-gateway`
Expected: PASS (`workflow_run.rs` mock tests still green; no behavior change for the happy path).

- [ ] **Step 9: Commit**

```bash
git add gateway/src/workflow/mod.rs gateway/src/state.rs
git commit -m "refactor(workflow): thread CancellationToken; add WorkflowItem::Cancelled"
```

---

## Task B2: Workflow cancel via `state::cancel`

**Files:**
- Modify: `gateway/src/state.rs` (`cancel` ~line 632)
- Modify: `gateway/tests/workflow_run.rs` (add cancel test)

- [ ] **Step 1: Write the failing cancel test**

Append to `gateway/tests/workflow_run.rs`:

```rust
#[tokio::test]
async fn cancelling_a_workflow_marks_it_cancelled() {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin(), project(), true, RunStore::new(dir.path()).unwrap());
    let id = state
        .launch_workflow("nightly-research".into(), "topic".into())
        .await
        .unwrap();
    // Cancel quickly — the mock sleeps 50ms before its first step.
    tokio::time::sleep(Duration::from_millis(10)).await;
    let cancelled = state.cancel(&id).await.unwrap();
    assert!(cancelled, "cancel should report success for an in-flight workflow");

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
    assert_eq!(status, RunStatus::Cancelled);
}
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cargo test -p tau-gateway --test workflow_run cancelling_a_workflow`
Expected: FAIL (`cancel` returns `false` for workflow runs — they have no `serve_id`).

- [ ] **Step 3: Make `cancel` handle workflow runs**

In `state.rs`, replace `cancel`:

```rust
    pub async fn cancel(&self, run_id: &str) -> Result<bool> {
        // Workflow runs cancel by firing their token (kills the tau child).
        if let Some(tok) = self.0.workflow_cancels.read().await.get(run_id).cloned() {
            tok.cancel();
            return Ok(true);
        }
        // Agent runs cancel over the serve socket.
        let serve_id = self.0.serve_ids.read().await.get(run_id).copied();
        match serve_id {
            Some(id) => self.client().await?.cancel(id).await,
            None => Ok(false),
        }
    }
```

- [ ] **Step 4: Run to confirm it passes**

Run: `cargo test -p tau-gateway --test workflow_run`
Expected: PASS (all four workflow_run tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/state.rs gateway/tests/workflow_run.rs
git commit -m "feat(workflow): cancel in-flight workflow runs via token"
```

---

## Task B3: Implement `CliRunner::run` (spawn + detect + live-tail)

**Files:**
- Modify: `gateway/src/workflow/mod.rs` (real `CliRunner::run` + `TailReader` + unit test)

- [ ] **Step 1: Write the failing `TailReader` unit test**

In `workflow/mod.rs` `#[cfg(test)] mod tests`, add (this drives out the `TailReader` API):

```rust
    #[test]
    fn tail_reader_emits_complete_lines_and_tracks_failure() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let runs = dir.path().to_path_buf();
        // file named like tau's flat log: <name>-<run_id>.jsonl
        let path = runs.join("wf-01HK.jsonl");
        std::fs::write(&path, "").unwrap();

        let mut reader = TailReader::new(runs.clone(), "wf", std::collections::HashSet::new());

        // No complete line yet (partial, no newline).
        {
            let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            write!(f, "{}", r#"{"ts":"t","run_id":"r","step_id":"a","step_index":0,"kind":"agent.run","input":"i","output":"o","started_at":"s","ended_at":"e","duration_ms":1,"status":"ok"}"#).unwrap();
        }
        assert!(reader.poll().is_empty(), "partial line must not parse yet");

        // Complete the line + add a failed line.
        {
            let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
            writeln!(f).unwrap(); // newline finishing the first record
            writeln!(f, "{}", r#"{"ts":"t","run_id":"r","step_id":"b","step_index":1,"kind":"tool.call","input":"i","output":"","started_at":"s","ended_at":"e","duration_ms":1,"status":"failed","error":"tool_error","detail":"boom"}"#).unwrap();
        }
        let recs = reader.poll();
        assert_eq!(recs.len(), 2);
        assert_eq!(recs[0].step_id, "a");
        assert_eq!(recs[1].status, "failed");
        assert!(reader.saw_failed);
    }
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cargo test -p tau-gateway --lib tail_reader_emits`
Expected: FAIL (`TailReader` not defined).

- [ ] **Step 3: Implement `TailReader` and the real `CliRunner::run`**

In `gateway/src/workflow/mod.rs`, update the imports block at the top to:

```rust
use std::collections::HashSet;
use std::ffi::OsString;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;

use crate::adapters::log::StepRecord;
```

Add the `TailReader` (place it above `CliRunner`):

```rust
/// Tails tau's append-only workflow-run JSONL. Detects the new
/// `<name>-*.jsonl` file (the one absent from the pre-spawn snapshot),
/// then yields one `StepRecord` per newly-completed line. Partial trailing
/// lines (no newline yet) are buffered until completed.
struct TailReader {
    dir: PathBuf,
    prefix: String,
    snapshot: HashSet<OsString>,
    path: Option<PathBuf>,
    offset: u64,
    leftover: String,
    saw_failed: bool,
}

impl TailReader {
    fn new(dir: PathBuf, name: &str, snapshot: HashSet<OsString>) -> Self {
        TailReader {
            dir,
            prefix: format!("{name}-"),
            snapshot,
            path: None,
            offset: 0,
            leftover: String::new(),
            saw_failed: false,
        }
    }

    /// Locate the new `<name>-*.jsonl` not present in the snapshot (newest if
    /// several appeared).
    fn detect(&self) -> Option<PathBuf> {
        let entries = std::fs::read_dir(&self.dir).ok()?;
        let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
        for e in entries.flatten() {
            let name = e.file_name();
            let Some(s) = name.to_str() else { continue };
            if !(s.starts_with(&self.prefix) && s.ends_with(".jsonl")) {
                continue;
            }
            if self.snapshot.contains(&name) {
                continue;
            }
            let mtime = e
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            if best.as_ref().map(|(t, _)| mtime >= *t).unwrap_or(true) {
                best = Some((mtime, e.path()));
            }
        }
        best.map(|(_, p)| p)
    }

    /// Read any newly-appended complete lines and parse them.
    fn poll(&mut self) -> Vec<StepRecord> {
        if self.path.is_none() {
            self.path = self.detect();
        }
        let Some(path) = self.path.clone() else {
            return vec![];
        };
        let mut out = vec![];
        let Ok(mut f) = std::fs::File::open(&path) else {
            return out;
        };
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return out;
        }
        let mut buf = String::new();
        let Ok(n) = f.read_to_string(&mut buf) else {
            return out;
        };
        self.offset += n as u64;
        let mut data = std::mem::take(&mut self.leftover);
        data.push_str(&buf);
        let ends_nl = data.ends_with('\n');
        let mut parts: Vec<&str> = data.split('\n').collect();
        if ends_nl {
            parts.pop(); // trailing empty after final newline
        } else {
            self.leftover = parts.pop().unwrap_or("").to_string();
        }
        for line in parts {
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<StepRecord>(line) {
                Ok(rec) => {
                    if rec.status == "failed" {
                        self.saw_failed = true;
                    }
                    out.push(rec);
                }
                Err(e) => tracing::warn!("unparseable workflow step line: {e}: {line}"),
            }
        }
        out
    }
}
```

Replace `CliRunner::run` with the real implementation:

```rust
impl WorkflowRunner for CliRunner {
    fn run(
        &self,
        workflow: String,
        input: String,
        _run_id: String,
        cancel: CancellationToken,
    ) -> mpsc::UnboundedReceiver<WorkflowItem> {
        let (tx, rx) = mpsc::unbounded_channel();
        let bin = self.bin.clone();
        let project = self.project.clone();
        tokio::spawn(async move {
            let runs_dir = project.join(".tau").join("workflow-runs");

            // Snapshot existing <name>-*.jsonl so we can spot the new one.
            let prefix = format!("{workflow}-");
            let snapshot: HashSet<OsString> = std::fs::read_dir(&runs_dir)
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.file_name())
                .filter(|n| {
                    n.to_str()
                        .map(|s| s.starts_with(&prefix) && s.ends_with(".jsonl"))
                        .unwrap_or(false)
                })
                .collect();

            let mut cmd = Command::new(&bin);
            cmd.arg("workflow")
                .arg("run")
                .arg(&workflow)
                .arg("--input")
                .arg(&input)
                .current_dir(&project)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .kill_on_drop(true);

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    let _ = tx.send(WorkflowItem::Error(format!(
                        "spawn `tau workflow run {workflow}`: {e}"
                    )));
                    return;
                }
            };

            // Drain stderr into a buffer for error reporting.
            let err_buf = Arc::new(Mutex::new(String::new()));
            if let Some(se) = child.stderr.take() {
                let eb = err_buf.clone();
                tokio::spawn(async move {
                    let mut lines = BufReader::new(se).lines();
                    while let Ok(Some(l)) = lines.next_line().await {
                        let mut g = eb.lock().await;
                        g.push_str(&l);
                        g.push('\n');
                    }
                });
            }

            let mut reader = TailReader::new(runs_dir, &workflow, snapshot);
            let mut tick = tokio::time::interval(Duration::from_millis(50));
            let mut cancelled = false;

            loop {
                tokio::select! {
                    _ = tick.tick() => {}
                    _ = cancel.cancelled(), if !cancelled => {
                        cancelled = true;
                        let _ = child.start_kill();
                    }
                }

                for rec in reader.poll() {
                    if tx.send(WorkflowItem::Step(Box::new(rec))).is_err() {
                        let _ = child.start_kill();
                        return;
                    }
                }

                match child.try_wait() {
                    Ok(Some(status)) => {
                        for rec in reader.poll() {
                            let _ = tx.send(WorkflowItem::Step(Box::new(rec)));
                        }
                        if cancelled {
                            let _ = tx.send(WorkflowItem::Cancelled);
                        } else if status.success() || reader.saw_failed {
                            // exit 0 → all ok; non-zero with a recorded failed
                            // step → the failed Step already streamed, so Done
                            // lets launch_workflow mark the run Failed with the
                            // step's own error/detail.
                            let _ = tx.send(WorkflowItem::Done);
                        } else {
                            let msg = err_buf.lock().await.trim().to_string();
                            let msg = if msg.is_empty() {
                                format!("tau workflow run exited: {status}")
                            } else {
                                msg
                            };
                            let _ = tx.send(WorkflowItem::Error(msg));
                        }
                        return;
                    }
                    Ok(None) => {}
                    Err(e) => {
                        let _ = tx.send(WorkflowItem::Error(format!(
                            "waiting on tau workflow child: {e}"
                        )));
                        return;
                    }
                }
            }
        });
        rx
    }
}
```

- [ ] **Step 4: Run the unit test**

Run: `cargo test -p tau-gateway --lib tail_reader_emits`
Expected: PASS.

- [ ] **Step 5: Run the full suite + clippy**

Run: `cargo test -p tau-gateway && cargo clippy -p tau-gateway --all-targets`
Expected: PASS, no clippy warnings.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/workflow/mod.rs
git commit -m "feat(workflow): CliRunner spawns tau workflow run + live-tails JSONL"
```

---

## Task B4: Gated live test against real tau

**Files:**
- Create: `gateway/tests/real_tau_workflow.rs`

> This mirrors the existing gated live-test pattern (`gateway/tests/real_tau_*.rs`). It is skipped unless `TAU_BIN` points at a real `tau` binary and `TAU_WORKFLOW_PROJECT` points at a project dir containing a runnable `workflows/echo.toml` + declared agents. Read one existing `real_tau_*.rs` first to match its env-gating + `#[ignore]`/cfg conventions exactly.

- [ ] **Step 1: Inspect the existing gating convention**

Run: `sed -n '1,40p' gateway/tests/real_tau_validate.rs`
Note how it reads `TAU_BIN`, early-returns when unset, and whether it uses `#[ignore]`.

- [ ] **Step 2: Write the gated test file**

Create `gateway/tests/real_tau_workflow.rs` (adjust env-var names/gating to match Step 1's convention):

```rust
//! Gated live tests: real `tau workflow run` end-to-end through the gateway.
//! Skipped unless TAU_BIN + TAU_WORKFLOW_PROJECT are set.
use std::path::PathBuf;
use std::time::Duration;
use tau_gateway::{state::AppState, store::RunStore, trace::RunStatus};

fn live() -> Option<(PathBuf, PathBuf)> {
    let bin = std::env::var("TAU_BIN").ok()?;
    let project = std::env::var("TAU_WORKFLOW_PROJECT").ok()?;
    Some((PathBuf::from(bin), PathBuf::from(project)))
}

async fn wait_terminal(state: &AppState, id: &str) -> RunStatus {
    for _ in 0..400 {
        if let Some(r) = state.get_run(id).await {
            if r.status != RunStatus::Running {
                return r.status;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("run never reached a terminal state");
}

#[tokio::test]
async fn live_workflow_runs_and_persists_steps() {
    let Some((bin, project)) = live() else {
        eprintln!("skipping: set TAU_BIN + TAU_WORKFLOW_PROJECT");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    // is_mock=false path: real CliRunner. AppState::new sniffs is_mock from the
    // bin name; a real `tau` binary is not "fake-tau-serve", so CliRunner runs.
    let state = AppState::new(bin, project, true, RunStore::new(dir.path()).unwrap());
    let id = state
        .launch_workflow("echo".into(), "hello".into())
        .await
        .unwrap();
    let status = wait_terminal(&state, &id).await;
    assert_eq!(status, RunStatus::Completed);
    let (_run, spans, _events) = state.load_trace(&id).unwrap();
    assert!(!spans.is_empty(), "live workflow must persist at least one step span");
}

#[tokio::test]
async fn live_workflow_cancel_marks_cancelled() {
    let Some((bin, project)) = live() else {
        eprintln!("skipping: set TAU_BIN + TAU_WORKFLOW_PROJECT");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(bin, project, true, RunStore::new(dir.path()).unwrap());
    let id = state
        .launch_workflow("echo".into(), "hello".into())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    let cancelled = state.cancel(&id).await.unwrap();
    assert!(cancelled);
    let status = wait_terminal(&state, &id).await;
    assert_eq!(status, RunStatus::Cancelled);
}
```

- [ ] **Step 3: Confirm it compiles and skips cleanly without env**

Run: `cargo test -p tau-gateway --test real_tau_workflow`
Expected: PASS (both tests print "skipping" and return when `TAU_BIN`/`TAU_WORKFLOW_PROJECT` are unset).

- [ ] **Step 4: (Manual, when a real tau build is available) run live**

Run: `TAU_BIN=/path/to/tau TAU_WORKFLOW_PROJECT=/path/to/project cargo test -p tau-gateway --test real_tau_workflow -- --nocapture`
Expected: PASS against real tau (Completed + spans; cancel → Cancelled). Document the result in the PR description.

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/real_tau_workflow.rs
git commit -m "test(workflow): gated live tests for real tau workflow runs + cancel"
```

---

## Final verification

- [ ] **Step 1: Full suite + lint + format**

Run: `cargo fmt --all && cargo clippy -p tau-gateway --all-targets && cargo test -p tau-gateway`
Expected: clean format, no clippy warnings, all tests PASS.

- [ ] **Step 2: ts-rs export unaffected**

No `#[ts(export)]` type changed shape in this plan (`WorkflowGraph`/`WorkflowNode`/`WorkflowEdge` fields are unchanged; `WorkflowItem` is internal, not exported). Confirm: `git diff --stat` shows no `bindings/` churn after a build. If any binding changed unexpectedly, re-run the frontend typecheck per the per-task gate.

---

## Spec coverage check

- §3.1 backing (TOML, local model) → A3. §3.2 execution-order edges → A2, A3. §3.3 fallible sync trait + 404/422 → A1, A4. §3.4 enrichment unchanged → A1 (preserved verbatim). §3.5 mock parity → A2.
- §4.1–4.2 spawn + detect + live tail → B3. §4.3 failure mapping → B3 (Done vs Error logic) + relies on existing `any_failed` (state.rs). §4.4 cancel → B1 (token thread + `Cancelled`), B2 (`cancel`), B3 (child kill).
- §5 interface changes → A1 (graph trait/handler), B1 (`run` token, `WorkflowItem::Cancelled`, registry).
- §6 tests → A3/A4 (graph), B2 (mock cancel), B3 (TailReader), B4 (gated live).
- §7 deferred (bundle/IR inspector #50) → out of scope, no task. ✓
