# Unified executions + Workflows — design

**Date:** 2026-05-31
**Status:** Approved (brainstorm), pending spec review → writing-plans
**Scope:** Sub-project 2 of the product IA (`docs/superpowers/specs/2026-05-31-product-information-architecture.md`). Make the Runs surface a unified, filterable list of **workflow runs** + **agent runs**, add workflow **launch + observe** (mock-backed), and render a workflow run's **step-timeline trace** with a gated "view agent trace" drill.

## 0. Decisions (locked in brainstorm)
- **Unified Runs list** (IA model A): workflow + agent runs in one list, WF/AG type chip + filters (type · status), one shared Trace detail.
- **Launch + observe** workflows from the UI (not observe-only).
- **Step-timeline trace**: a workflow trace is its steps (tau records step input/output/timing/status only). `agent.run` steps carry a **gated** "view agent trace ↗" affordance (tau can't link step→agent run yet).
- **Mock-first**: works end-to-end against `fake-tau-serve` via a gateway mock workflow runner; the real `tau workflow run` path is a seam.

## 1. tau contract (confirmed from the tau repo)
Workflow run log: `<scope>/.tau/workflow-runs/<workflow-name>-<run-id>.jsonl` (run-id = ULID), one **StepRecord** per line:
```jsonc
{"ts":"<rfc3339>","run_id":"<ULID>","step_id":"gather","step_index":0,
 "kind":"agent.run"|"tool.call","input":"…","output":"…",
 "started_at":"<rfc3339>","ended_at":"<rfc3339>","duration_ms":42,
 "status":"ok"|"failed","error":"<class>"?,"detail":"<msg>"?}
```
`status` is lowercase `ok`/`failed` (reconciles a drift from the old handoff spec's `Ok`/`Err`). No header file: run name = filename prefix, overall status = any-step-failed→failed else ok. Definitions live in `workflows/<name>.toml` (`[workflow]` + `[[steps]]`). `tau workflow run <name> --input <s>` blocks, prints `run_id: <ULID>` to stderr, writes the JSONL; **no step→agent-run linkage** is recorded.

## 2. Gateway (Rust)
### 2.1 StepRecord + log-adapter
- New `gateway/src/adapters/log.rs` (replaces the stub): a `StepRecord` serde struct mirroring §1 (lowercase status), and a pure `LogAdapter` mapping each StepRecord → `TraceDelta`:
  - `kind: "agent.run"` → `SpanKind::Agent`; `"tool.call"` → `SpanKind::ToolCall`.
  - `status: "ok"` → `SpanStatus::Ok`; `"failed"` → `SpanStatus::Error`.
  - `Span{ id: "<run_id>-step-<step_index>", parent_id: None, run_id, kind, name: step_id, status, started_at, ended_at: Some(ended_at), attributes: {input, output, kind, step_index, error, detail} }`, emitted as `TraceDelta::SpanOpened` (it arrives already-complete). Flat & ordered by `step_index` (steps are a sequence, rendered as a waterfall).
- Unit-tested like `serve.rs`.

### 2.2 Workflow runner (trait + two impls)
`gateway/src/workflow/mod.rs`:
- `enum WorkflowItem { Step(StepRecord), Done, Error(String) }`.
- `trait WorkflowRunner { async fn run(&self, workflow: String, input: String, run_id: String) -> mpsc::UnboundedReceiver<WorkflowItem>; }`
- `MockRunner` — emits a canned `StepRecord` sequence (per-workflow scripts, with delays so steps stream in), then `Done`. Covers the demo workflows.
- `CliRunner` (seam, implemented-but-thin) — shells `tau workflow run <name> --input <s>`, parses `run_id:` from stderr, tails the JSONL log file emitting `Step` per new line, `Done` on process exit. Documented; not exercised by the mock.
- Selection: `MockRunner` when `--tau-bin` basename is `fake-tau-serve`, else `CliRunner`.

### 2.3 AppState wiring
- `list_workflows() -> Vec<String>` — read `<project>/workflows/*.toml` stems (empty if dir absent).
- `launch_workflow(workflow, input) -> run_id` — mirror `launch`: create `Run{ source: Source::Log, agent_id: <workflow name>, prompt: input, status: Running, … }`, persist header, spawn a task that drives the runner's `WorkflowItem`s through `LogAdapter` into store + broadcast, then finalize (status = failed if any step failed else completed; `total_turns = step count`; `token_usage = None`).
- Reuses `RunStore`, the broadcast channels, and the WS path unchanged (workflow spans are just spans).

### 2.4 API
- `GET /api/workflows` → `{ workflows: [name] }`.
- `POST /api/workflows/run` body `{ workflow, input }` → `{ run_id }`.
- Existing `POST /api/runs` (agent), `GET /api/runs` (now includes workflow runs with `source:"log"`), `GET /api/runs/:id`, WS, cancel — unchanged.

## 3. Mock fixtures
- `fixtures/demo/workflows/nightly-research.toml` and `…/build-report.toml` (valid `[workflow]` + `[[steps]]`, mixing `agent.run` + `tool.call`).
- `MockRunner` canned scripts keyed by workflow name produce a realistic StepRecord sequence (e.g. nightly-research: `gather` (agent.run, ok) → `summarise` (agent.run, ok) → `save-results` (tool.call, ok)), with one script exercising a `failed` step.

## 4. Frontend
- **Types**: `Run.source` already distinguishes (`log` = workflow). No model change. Regenerate not needed.
- **API client**: `getWorkflows(): Promise<string[]>`, `launchWorkflow(workflow, input): Promise<string>`.
- **Runs list (`RunsTable` + a small filter bar)**: add a **Type** chip per row (`source==="log"` → `WF` violet, else `AG` blue); add a filter bar (All · Workflows · Agents, plus the existing implicit status) above the table — client-side filter on `source`. The "Agent" column header becomes "Agent / Workflow"; `agent_id` already holds the workflow name for WF runs.
- **Launcher**: an **Agent | Workflow** segmented toggle. Agent mode = today. Workflow mode: a `<select>` of `getWorkflows()` + an input + Run → `launchWorkflow` → `navigate('/runs/'+id)`. Store: add `workflows: string[]` + `loadWorkflows()`; `launchWorkflow(workflow, input)` action (parallels `launch`).
- **Workflow trace (TraceView/SpanInspector)**: when `currentTrace.run.source==="log"`, default the tab to **Timeline**; pass `workflow` to `SpanInspector`, which on an `Agent`-kind span renders a **gated** `↗ view agent trace` button (no-op + `gated` badge + tooltip "tau doesn't link steps to agent runs yet"). Step inspector shows `input`/`output` from `attributes`.
- **Dashboard**: a small **type facet** — `computeMetrics` gains `byKind { workflow, agent }` (count by `source`); the Dashboard shows "N workflows · M agents" as a `Runs` card sub-line. Existing aggregates already span both.

## 5. Testing
- **Gateway**: `log.rs` LogAdapter StepRecord→Span unit tests (agent.run→Agent, tool.call→ToolCall, ok/failed→status, attributes carry input/output); `MockRunner` emits a valid step sequence ending in `Done`; an integration test: `launch_workflow` → poll terminal → run persisted with `source:Log`, spans named by step_id, status reflects a failed step; `GET /api/workflows` returns the two fixture names.
- **Frontend**: type chip (WF for `source:"log"`); filter bar narrows the list; Launcher workflow mode calls `getWorkflows` + `launchWorkflow`; `SpanInspector` renders the gated drill for a workflow Agent span and not for agent-run traces; TraceView defaults Timeline when `source:"log"`.
- **e2e (Playwright)**: a new case — switch the Launcher to Workflow, pick `nightly-research`, Run, see the step timeline build (`gather` → `summarise` → `save-results`) and the gated drill on an agent step. Existing agent-run e2e unchanged.
- All existing unit + e2e suites stay green; CI (rust+web+e2e + ts-rs drift gate) green.

## 6. Non-goals (YAGNI)
- No workflow **authoring/editing** (separate sub-project ⑤); we only list + launch existing `workflows/*.toml`.
- No workflow **cancel/resume** (tau resume is its own machinery).
- No real step→agent-run linkage — the drill is a gated stub until tau emits the link.
- No change to the agent-run path, the Trace model, or the shell/nav.

## 7. File-change summary
- **Gateway:** `gateway/src/adapters/log.rs` (StepRecord + LogAdapter + tests), `gateway/src/workflow/mod.rs` (runner trait, MockRunner, CliRunner seam), `gateway/src/state.rs` (`list_workflows`, `launch_workflow`), `gateway/src/api/{runs.rs|workflows.rs}` (+ `GET /api/workflows`, `POST /api/workflows/run`), `gateway/src/api/mod.rs` (routes). Fixtures: `fixtures/demo/workflows/*.toml`.
- **Frontend:** `web/src/api/client.ts` (+getWorkflows/launchWorkflow), `web/src/store/store.ts` (+workflows/loadWorkflows/launchWorkflow), `web/src/runs/{RunsTable,RunsView,Launcher}.tsx` (type chip, filter bar, agent|workflow toggle), `web/src/runs/badges.tsx` (a `TypeBadge`), `web/src/trace/{TraceView,SpanInspector}.tsx` (timeline default + gated drill), `web/src/dashboard/metrics.ts` (+byKind) + a Dashboard sub-line. Tests alongside each.
- **Docs:** flip the log-adapter row in `docs/seams.md` from stub to "implemented (workflows)"; note the step→agent drill gate.
