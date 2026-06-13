# D4 — Real workflow runs (`workflow_runner`) + workflow graph viewer (`graph_source`)

**Date:** 2026-06-13
**Status:** Design approved; ready for implementation plan.
**Scope:** Replace the two remaining mock seams from the real-tau integration roadmap (D4) with real `tau`-backed implementations: `CliRunner` (real `tau workflow run` + live JSONL tail) and `CliGraph` (real workflow graph from `workflows/*.toml`).

References verified against `tau` at `/Users/titouanlebocq/code/tau @ 49d4712` and the gateway on branch `workflow-runner-graph-source-design-brief`.

---

## 1. Background & key finding

The roadmap framed D4's graph half as a "read-only IR inspector over compiled `ir_payload`." Scouting tau's source showed this conflates **three distinct models**:

- **`tau_workflow::Workflow`** (`crates/tau-workflow/src/model.rs:47`) — the ordered `[[steps]]` pipeline (`agent.run` / `tool.call`, `${steps.X.output}` templating). This is what `workflows/*.toml`, `tau workflow run`, and today's `MockGraph` all use.
- **`tau_ir::IrModule`** (`crates/tau-ir/src/module.rs:38`) — an agent/tool/capability **registry** + agent-spawn edges, compiled by `tau build` and shipped hex-encoded as `ir_payload` in the bundle manifest (`crates/tau-pkg/src/bundle/manifest.rs:25`). `tau_ir::lower::parse` reads `config.{agents,tools,steps}` into *maps*; the only edges it emits are `SubflowKind::Spawn` (`crates/tau-ir/src/lower/parse.rs:61`). **It does not encode step order or dataflow** and only exists after a successful `tau build`.
- The project's agent/provider config.

**Consequence:** a viewer over `ir_payload` cannot render a workflow step pipeline. The two are different artifacts answering different questions ("what does this workflow do" vs "what did this build compile / what was it granted / is it reproducible").

**Decision:** D4's graph viewer is the **workflow pipeline viewer** ("Picture 1"), backed by the workflow TOML. The compiled-IR / bundle inspector ("Picture 2") is a **separate, deferred feature** tracked in **issue #50**, to be built on the existing `ShipSource` (`.tau` scanning from D3) — not on the graph viewer. The two share no code, so building the viewer first incurs no rework.

---

## 2. The reused streaming seam (correcting the roadmap)

The roadmap said workflow runs "stream like agent runs → ride on D1." Precise framing: **`tau serve` exposes no workflow RPC** (`meta.handshake/ping`, `runtime.run/run_streaming/cancel` only). `tau workflow run` is a separate CLI subcommand that writes a JSONL log file; it has no streaming socket.

What the workflow path actually reuses is the **gateway-side** pipeline, which already converges with the agent path at `apply_delta`:

```
agent run:    serve run_streaming → RunItem      → ServeAdapter::on_event → TraceDelta ┐
workflow run: WorkflowRunner::run → WorkflowItem  → LogAdapter::on_step   → TraceDelta ┤
                                                                                        ├→ apply_delta (state.rs:339)
                                                                                        │    ├ store.write_span/event
                                                                                        │    └ publish → broadcast → WS
                                                                                        └→ finalize (state.rs:356)
```

`launch_workflow` (`gateway/src/state.rs:388`) already drives this loop for the mock. **It is runner-agnostic** — the only D4 work on this half is implementing `CliRunner::run`; `LogAdapter`, store, broadcast, and WS are unchanged. The JSONL the runner tails has keys identical to the gateway's `StepRecord` (`gateway/src/adapters/log.rs:12` ↔ `crates/tau-observe/src/layers/workflow_run_log.rs:197`), so no field translation is needed.

---

## 3. Half A — `graph_source` (workflow graph viewer)

### 3.1 Backing
`CliGraph::graph` (`gateway/src/graph/mod.rs:127`) parses `workflows/<name>.toml` into the existing `WorkflowGraph` shape. Parsing uses a **local serde model** mirroring `tau_workflow::Workflow` / `Step` / `StepKind` (`crates/tau-workflow/src/model.rs:47-115`) — **not** a dependency on tau crates. This matches the existing seam pattern (`StepRecord` is re-defined locally; the gateway integrates with tau via the binary + wire protocol, with no tau crate deps).

### 3.2 Edges = execution order (Q2)
`tau_workflow::Workflow.steps` is an **ordered `Vec`** that "runs sequentially" (`model.rs:59`); there are no explicit edges/dependencies, and `${steps.X.output}` references are runtime string interpolation (`crates/tau-workflow/src/template.rs`), **not** a declared DAG.

The viewer draws **execution-order edges** (`step[i] → step[i+1]`):
- Execution is always sequential, so an order edge is never wrong.
- Data-reference edges (today's `MockGraph` behavior) can skip steps (a step may reference a non-adjacent prior step's output), implying an ordering tau does not use, and produce disconnected nodes (e.g. `build-report`, whose `render` step does not consume `collect`'s output).
- The data dependency (`input: ${steps.gather.output}`) is surfaced as **text in the node detail panel**, not as an edge.

`WorkflowEdge` keeps its current `{source, target}` shape — no new fields.

### 3.3 Trait & handler shape (Q4)
`WorkflowGraphSource::graph` becomes fallible, staying **synchronous** (file read + TOML parse is fast; `list_workflows` and config reads are already sync in this codebase):

```
fn graph(&self, name: &str) -> Result<WorkflowGraph, GraphError>;
```

`api/graph.rs::graph` returns `Result<Json<WorkflowGraph>, (StatusCode, String)>` (mirroring `api/workflows.rs::run`), mapping **not-found → 404** and **parse error → 422**. A malformed workflow file now surfaces a real error instead of looking empty.

### 3.4 Enrichment (Q5)
`state.rs::workflow_graph` (`gateway/src/state.rs:571`) keeps its current enrichment unchanged: each `agent.run` node gets `provider` (agent `llm_backend` else recommended backend) + `tools` (`requires_tools`) from agent config. `CliGraph` supplies only the structural graph; enrichment stays in `workflow_graph`.

### 3.5 Mock parity
`MockGraph` (`gateway/src/graph/mod.rs:68`) switches to **execution-order edges** so mock and real agree. This updates the `mock_build_report_has_no_edges` unit test — `build-report` becomes `collect → render`.

---

## 4. Half B — `workflow_runner` (`CliRunner`)

### 4.1 Constraints (verified)
- `tau workflow run` takes only `name` + `--input` — **no `--run-id` flag** (`crates/tau-cli/src/cli.rs:632`). tau mints the run id internally (`crates/tau-cli/src/lib.rs:124`).
- The run id is printed to stderr **only after the run finishes** (`crates/tau-cli/src/cmd/workflow/run.rs:55`), so it cannot be read up front.
- The log path is **flat**: `<scope>/.tau/workflow-runs/<name>-<run_id>.jsonl` (`crates/tau-workflow/src/persistence.rs:148`), where `<scope>` is resolved from the working directory (`tau_pkg::Scope::resolve`). Written incrementally, fsync per step.

### 4.2 Mechanism — live tail (Q6)
`CliRunner::run` (`gateway/src/workflow/mod.rs:122`):
1. **Snapshot** existing `<scope>/.tau/workflow-runs/<name>-*.jsonl`.
2. **Spawn** `tau workflow run <name> --input <input>` with `current_dir(project)` (tau resolves scope from cwd).
3. **Detect the new file** (the one not in the snapshot; created when step 0 starts). If no file appears before the child exits → startup failure (§4.3).
4. **Live-tail** the file: each new line → `serde_json::from_str::<StepRecord>` → `WorkflowItem::Step`. Poll-based tailing (~50–100ms) matches the mock's cadence and run durations.
5. **On child exit:** drain remaining lines, then finalize per §4.3.

Concurrent runs of the *same* workflow in the same instant could both produce new files; pick the newest and log the limitation (rare in a single-user dev gateway).

### 4.3 Failure mapping (Q7)
tau aborts on the **first failed step**, writing that failed `StepRecord` (with `error` + `detail`) to the log *before* returning `success:false` (`crates/tau-workflow/src/runner.rs:230`); pre-execution errors (unknown workflow, undeclared agent, bad template, `tool.call` without `default-agent`) propagate *before* any record is written.

| Situation | Log on disk | `CliRunner` emits | Run status |
|---|---|---|---|
| All steps ok | all `ok` lines | `Done` | Completed |
| A step failed | last line `status:failed` + error/detail | `Done` (failed Step already streamed) | Failed — exact step + reason |
| Couldn't start | no file, or no failed line for the bad step | `Error(stderr)` | Failed — `kind=workflow_error`, tau's message |
| Crashed / killed (no recorded failure) | partial, all-ok-so-far | `Error("exited: code N")` | Failed |

**Rule:** on exit, if the log contains a `failed` step → emit `Done` (the precise per-step error is already in the stream; `launch_workflow`'s `any_failed` logic at `state.rs:431-462` flips the run to Failed with that error/detail — no new code there); otherwise on any non-zero exit → emit `Error` with tau's stderr tail.

### 4.4 Cancel (in scope)
Agent runs cancel via the serve socket (`state.rs:632` → `serve_ids`); workflow runs do not use that socket. Real workflow cancel = **kill the tau child** and remember the kill was a user cancel (so it shows as Cancelled, not Failed).

Design:
- `WorkflowRunner::run` gains a `tokio_util::sync::CancellationToken` parameter (already a workspace dep, `gateway/Cargo.toml:24`). `MockRunner` accepts it (honors it for a cancel test); `CliRunner` selects on it alongside child wait/tail.
- The gateway keeps a `run_id → CancellationToken` registry (parallel to `serve_ids`). `launch_workflow` creates the token, stores it, passes it in.
- `cancel(run_id)` (`state.rs:632`) is extended: if the id is a workflow run, fire its token; else fall back to the serve path.
- On token fire, `CliRunner` kills the child and emits a **new `WorkflowItem::Cancelled`** variant.
- `launch_workflow` maps `WorkflowItem::Cancelled` → `RunStatus::Cancelled` (no `RunError`), mirroring the agent path's `-32001` handling.

---

## 5. Interface changes (summary)
1. `WorkflowGraphSource::graph` → `Result<WorkflowGraph, GraphError>` (new `GraphError`).
2. `api/graph.rs::graph` → `Result<Json<_>, (StatusCode, String)>`; 404 not-found / 422 parse-error.
3. `WorkflowRunner::run` → gains a `CancellationToken` parameter.
4. `WorkflowItem` → add `Cancelled` variant.
5. `state.rs::cancel` → handle workflow runs; add a `run_id → CancellationToken` registry; `launch_workflow` populates it and cleans it up in `finalize`.

All other touchpoints (`LogAdapter`, `RunStore`, broadcast channels, WS, the `launch_workflow` stream loop) are unchanged.

---

## 6. Test strategy
- **`graph_source`:** unit-test the local-model parse over both fixtures (`nightly-research`, `build-report`) — execution-order edges, `build-report` now connected; malformed TOML → `GraphError`. Keep `gateway/tests/graph_api.rs` enrichment assertions. Update the `mock_build_report_has_no_edges` unit test for the new edge semantics.
- **`workflow_runner`:** a gated live test against real tau (HOME/scope-isolated tempdir, following the `real_tau_*.rs` pattern) — ok run → `Step…Done` + persisted spans; a fail fixture → Failed with the step's error; **cancel → kill → Cancelled**. Unit: feed a hand-authored JSONL file (real-format lines) to the tail-parser, asserting `StepRecord` round-trip and `Done` on EOF. `fake-tau-serve` / `MockRunner` remain the deterministic test double.
- **Gotcha (from D3):** evolving any `#[ts(export)]` type breaks `gateway/tests/*_api.rs` that the per-task `--lib` gate misses — run the **full** `cargo test -p tau-gateway` on any type-evolution task, and re-run the ts-rs export + frontend typecheck. Per the per-task gate, add `format` to each frontend task.

---

## 7. Deferred / out of scope
- **Bundle / IR inspector** (compiled `ir_payload` viewer: agent capability grants, model pins, target triple, sha256, reproducibility) — **issue #50**. Built later on `ShipSource`, as a separate tab. This also subsumes the former "bundle discovery" open question.
- Any branch/loop/parallel workflow visualization — tau's workflow model is strictly linear; no such nodes exist.

---

## 8. Resolved open questions
- **Q1 backing** → workflow TOML (pipeline), not `ir_payload`. IR inspector deferred (#50).
- **Q2 edges** → execution order; data refs in node detail.
- **Q3 bundle discovery** → N/A (no bundle backing); folded into #50.
- **Q4 trait shape** → sync `Result<_, GraphError>`; handler 404/422.
- **Q5 enrichment** → keep `state.rs:571` unchanged.
- **Q6 runner contract** → snapshot + spawn (`cwd=project`) + detect new flat-named file + live tail; drain on exit.
- **Q7 failure + cancel** → mapping table in §4.3; cancel included via `CancellationToken` + child kill + `WorkflowItem::Cancelled`.
