# Deliverables & Goals — tau-ui surface (mock-first)

**Date:** 2026-06-16
**Status:** Design — pending user review.
**Scope:** Surface tau's `goal` / `deliverable` postcondition checks in tau-ui across
three places (Workflows canvas, Runs trace, Dashboard glance), built **mock-first**
against fabricated-but-faithful data, so the UI is ready when the backend exposes a
protocol surface.

## Why mock-first

The feature is **implemented in tau** but not reachable from tau-ui:

- Built and committed as **tau PR #340** ("deliverables & goals — build-time-checked
  postcondition steps") on branch `feat/beta-7-5-wasm-aot`. Engine support is complete:
  IR `Check` nodes (`crates/tau-ir/src/check.rs`), build-time validation, runtime
  evaluation + rewind-to-gate retry (`crates/tau-runtime-core/src/interpreter/{check,pipeline}.rs`),
  passing conformance fixtures.
- **Not on tau `main`**, **no ts-rs bindings**, **no JSON-RPC / serve-protocol method**.
  The tau-ui gateway therefore cannot fetch any of it today.

Consequence: we invent the gateway→UI contract as TS types that mirror the PR #340
Rust shapes, drive the UI from fixtures, and isolate the eventual swap to one api module.
This is a UI/UX deliverable, not a backend integration — when tau exposes the surface,
the data source changes; the components do not.

## The two primitives (recap; authoritative spec lives in tau)

Source of truth: `tau/docs/superpowers/specs/2026-06-13-deliverables-and-goals-design.md`.

- **`goal`** — a deterministic predicate, no LLM. Predicate menu: `exists`, `non_empty`,
  `equals`, `matches` (regex), `min_count`, `schema_valid`, or a native Rust fn. Answers
  "did we hit the number?" Terminal, usually single-attempt, no producer binding.
- **`deliverable`** — an artifact that must be *produced* (build proves a producer is
  wired and capability-permitted) **and** *good* (an LLM judge evaluates its content
  against `must_satisfy`, returning `{ met, rationale }`). Answers "is this any good?"
- **On failure:** `abort` (default) or rewind-to-gate **`retry`** — re-runs from
  `retry_from` (≤ the producer) through the producer back to the check, injecting the
  verdict `rationale` as feedback, bounded by `max_attempts` + `AgentBudget`.

## Surfaces (placement = hybrid)

Three embedded surfaces, no dedicated top-level nav item (a "Checks" aggregate view was
rejected — it would fabricate an aggregation the backend does not expose):

1. **Workflows canvas** (`web/src/graph/`) — the *static contract*: deliverables as nodes,
   goals as badges, the retry loop as a rewind edge, plus build-time verdicts.
2. **Runs trace** (`web/src/runs/`, `SpanInspector`) — the *execution*: each check
   evaluation as a span, the `{met, rationale}` verdict, and the retry timeline.
3. **Dashboard glance** (`web/src/dashboard/`) — a small summary card for the last run
   ("2 goals met · 1 deliverable met · 1 retry").

Division of labor: **canvas = the contract and its wiring; Runs = what happened.** The
canvas never tries to animate the temporal retry story — that lives in the Runs stepper.

## Canvas grammar (the "n8n view")

The canvas is React Flow (`@xyflow/react` v12) with a node-type registry
(`nodeTypes = { step: StepNode }`) and edge-type registry
(`edgeTypes = { step: StepEdge }`) in `web/src/graph/GraphCanvas.tsx`. Today only
`agent.run` / `tool.call` nodes and plain `source→target` edges exist; `IrEdge` already
carries an unused `kind` field.

**Grammar = "deliverables as nodes, goals as badges"** (the audit's node-vs-badge rule:
first-class node only when it has its own connections/flow semantics — a goal is a terminal
predicate, a deliverable carries a producer binding + retry loop):

- **Deliverable** → a new `CheckNode` (kind `check.deliverable`), wired after its producer.
- **Goal** → a badge on the node whose output/file it evaluates (no node, no edge).
- **Retry loop** → a new `RewindEdge` (edge kind `rewind`) drawn from the deliverable back
  to its gate.

### Audit-driven rules (UI/UX community guidance)

Each rule traces to the research audit (2026-06-16, sources in the brainstorm transcript):

- **R1 — Rewind edge is a distinct visual class.** Amber, dashed spline, explicit
  `↻ retry ×N` label, drawn in its *true* (backward) direction. (Sugiyama feedback-arc
  treatment; NN/g cognitive-load: meaningful distinct encoding for edges that violate L→R.)
- **R2 — Pair-highlight, not static clutter.** Hovering/selecting a deliverable highlights
  its `deliverable ↔ gate` pair and dims the rest, via React Flow `onEdgeMouseEnter` /
  `updateEdge`. Keeps N loops from becoming spaghetti.
- **R3 — Two encoding channels, never shared.** **Design-time** validity = node **border**
  (solid = wired; **dashed red** = build error) + a static glyph (`◇ validated`).
  **Runtime** status = a **badge in a fixed corner**. **Green is reserved for runtime
  only**; design-time validity is blue/outline so the two greens never collide.
  (NN/g indicators-vs-system-status; Carbon color/shape/position layering.)
- **R4 — Redundant encoding (WCAG 1.4.1).** Every node type and every status state is
  color **+ icon + text**, never color alone. Node kinds differ by icon (`◆` agent,
  `⬇` deliverable) and label, not hue alone. (Section 508, WebAIM, Carbon.)
- **R5 — Retries summarized on the node, detailed off-canvas.** Node shows a count badge
  (`×N`) + terminal status (`met`/`failed`); per-attempt rationale lives in the Runs
  inspector (GH-Actions "latest / attempt N" pattern; LogRocket async-UI patterns).
- **R6 — Checks are inspect-only on the canvas, even in edit mode.** They are authored in
  `tau.toml`→IR; the UI must not let a user hand-wire a rewind edge (which could place the
  gate after the producer — a build error). Enforce with React Flow `isValidConnection`
  returning `false` for check handles, `connectable: false` on `CheckNode`, non-reconnectable
  rewind edges, and `connectOnClick` guarded; dim the handles to signal it. (React Flow API.)
- **R7 — Suppress inapplicable affordances.** `CheckNode` has no "+ add next step" button;
  `RewindEdge` has no mid-edge "+ insert" handle.

### Build-error navigability (R8)

`tau check` errors surface inline (dashed-red node, R3) **and** in an error-summary list.
Each summary item is an anchor that **reveals the cause on the canvas** — selecting/centering
the offending deliverable + its producer (e.g. "report: gate runs after its producer").
Wording is the verbatim, constructive `tau check` message. (GOV.UK error-summary; NN/g
error-message guidelines.)

### Empty / neutral state (R9)

When checks exist and pass build but no run is selected: an affirmative neutral state —
`✓ All checks validated — no run required` — not a blank panel. (NN/g empty states.)

## Runs surface

Two coordinated parts (the "both" decision):

- **Trace tree** — check evaluations appear as spans, sourced from the `check.evaluated` /
  `check.retry` events. Each attempt is a nested span (`attempt N · judge`), faithful to the
  event stream. No new view; `RunsPage` renders them like any span.
- **Verdict stepper (inspector body)** — when a check span is selected, `SpanInspector`
  renders a purpose-built `CheckVerdictPanel` instead of the generic key/value list:
  a vertical attempt stepper showing, per attempt, the `{met, rationale}` verdict, and
  between failed attempts the "↻ rewind to `<gate>` · rationale injected" feedback marker.
  A single-attempt goal collapses to a one-line verdict (no stepper).

`SpanInspector` gets one branch: `if (span.kind === "check") render <CheckVerdictPanel>`.

## Dashboard glance

A `ChecksGlanceCard` in `DashboardPage` summarizing the most recent run's checks:
counts of goals/deliverables met vs failed and total retries, with the run's status color.
Links to that run. Uses `Skeleton` while loading, like the other dashboard cards.

## Data model (TS types — mirror PR #340, provisional)

These mirror the Rust shapes in `tau-ir/src/check.rs` and `tau-runtime-core` so the
eventual ts-rs swap is type-stable. Placed in `web/src/types/` (the `Check` name is free;
only `CheckReport`, used by Health, is taken — do **not** name anything `CheckReport`).
Tagged-union encoding follows ts-rs conventions. **`min_count` is `u64` → `bigint`** in
ts-rs (per project memory `ts-rs-u64-maps-to-bigint`); `Number(x)` before display/arithmetic.

```ts
// --- declaration / IR (drives the canvas + IR panel) ---
export type Locus =
  | { kind: "path"; path: string }
  | { kind: "output"; step: string };          // steps.<id>.output

export type GoalPredicate =
  | { kind: "exists" } | { kind: "non_empty" }
  | { kind: "equals"; value: string }
  | { kind: "matches"; pattern: string }
  | { kind: "min_count"; min: bigint }          // u64 → bigint
  | { kind: "schema_valid"; schema: unknown }
  | { kind: "native_fn"; fn: string };

export type JudgeRef =
  | { kind: "builtin"; model: string | null }
  | { kind: "agent"; agent: string };

export type OnFail = "abort" | "retry";
export interface RetryPolicy { on_fail: OnFail; max_attempts: number; gate: string }

export type CheckVerify =
  | { kind: "goal"; evaluates: Locus; predicate: GoalPredicate }
  | { kind: "deliverable"; locus: Locus; must_satisfy: string; judge: JudgeRef };

export interface Check { id: string; verify: CheckVerify; retry: RetryPolicy }

// build-time verdict per check (from `tau check`; mocked)
export type BuildVerdict =
  | { status: "ok" }
  | { status: "error"; message: string; producer?: string };  // producer = node to reveal

// --- runtime (drives Runs stepper + dashboard) ---
export interface CheckVerdict { met: boolean; rationale: string }   // tau-runtime-core
export interface CheckAttempt { attempt: number; verdict: CheckVerdict }
export interface RunCheckResult {                 // UI-folded from check.evaluated/check.retry
  id: string;
  kind: "goal" | "deliverable";
  attempts: CheckAttempt[];
  final: "met" | "failed" | "aborted";
  rewound_to?: string;                            // gate, when retried
}
```

The flat `check.evaluated` / `check.retry` trace events (`{id, kind, verdict, attempt}` /
`{id, rewind_to, next_attempt}`) are **folded into `RunCheckResult`** by the gateway in the
real world; in the mock, the fixture provides `RunCheckResult` directly *and* the raw events
(so the trace tree can render spans).

## Mock-data wiring

Pure-frontend fixtures behind a typed api module (chosen over gateway mock endpoints —
no Rust changes, the gateway is shared — and over MSW — no new dependency).

- `web/src/api/postconditions.ts` — exports (named to avoid the Health `checks.ts` clash):
  - `getWorkflowChecks(pid, workflowId): Promise<{ checks: Check[]; build: Record<string, BuildVerdict> }>`
  - `getRunChecks(pid, runId): Promise<{ results: RunCheckResult[] }>`
  - Each function: `if (MOCK) return fixture; return request<…>(scopedPath(pid, …))`.
    `MOCK = import.meta.env.VITE_MOCK_POSTCONDITIONS !== "false"` — defaults **on** until
    the backend ships, flipped off by env when the real surface lands.
- `web/src/api/fixtures/postconditions.ts` — the fabricated data, seeded from the PR #340
  conformance fixture (`research` pipeline: `gather → writer`, goal `has_sources`,
  deliverable `report` with `on_fail = "retry"`, retry→met scenario). Include at least:
  one all-pass run, one retry→met run, one abort run, and one build-error workflow.
- Canvas: extend `irToFlow` (`web/src/graph/layout.ts`) to project `Check`s into
  `CheckNode`s + `RewindEdge`s and goals into node badges. The IR `kind` string passes
  through untouched, so when tau emits check nodes the layout already handles them.

## Components & integration points

| New / changed | File | Note |
|---|---|---|
| `CheckNode` | `web/src/graph/CheckNode.tsx` (new) | deliverable node; register in `GraphCanvas.tsx` nodeTypes; `connectable:false` |
| `RewindEdge` | `web/src/graph/RewindEdge.tsx` (new) | amber dashed spline + label; register in edgeTypes; no "+" handle |
| goal badge + build-state border | `StepNode.tsx` / `CheckNode.tsx` | R3/R4 dual-channel encoding |
| pair-highlight | `GraphEditor.tsx` | `onEdgeMouseEnter`/select → dim others |
| build-error summary + reveal | `GraphEditor.tsx` (inspector/panel) | R8 anchor → select+center node |
| `CheckVerdictPanel` | `web/src/runs/CheckVerdictPanel.tsx` (new) | attempt stepper; rendered by `SpanInspector` when `span.kind==="check"` |
| check spans in trace | `RunsPage` / trace render | from folded events |
| `ChecksGlanceCard` | `web/src/dashboard/ChecksGlanceCard.tsx` (new) | dashboard summary |
| types | `web/src/types/*.ts` (new) | the model above |
| api + fixtures | `web/src/api/postconditions.ts`, `web/src/api/fixtures/postconditions.ts` (new) | mock wiring |

## Testing

- Vitest, stubbing global `fetch` per the existing api-test pattern (`*.test.ts`), or calling
  the fixture path directly. Run with `./node_modules/.bin/vitest` in a fresh conductor
  worktree after `pnpm install` (per memory `conductor-worktree-web-test-invocation`).
- Cover: `irToFlow` emits a `CheckNode` + `RewindEdge` for a retry deliverable and a badge
  (no node) for a goal; `CheckVerdictPanel` renders multi-attempt stepper vs single-line goal;
  build-error state renders dashed-red + summary link; `bigint` `min_count` formats via
  `Number(...)`; dashboard glance counts met/failed/retries.
- Each frontend task ends with `prettier`/`eslint`/`tsc` (per memory `per-task-gate-skips-format-check`).

## Out of scope (v1 mock)

- Any Rust/gateway change; any real protocol/ts-rs wiring (that's the swap, later).
- Editing checks from the UI (authoring stays in `tau.toml`; canvas is inspect-only).
- Loci beyond filesystem path / named output; score-with-threshold verdicts; multi-gate replay
  (all out of scope in PR #340 too).
- A dedicated top-level "Checks" view.

## Resolved decisions (were open questions; settled 2026-06-16)

1. **Provisional contract — accepted.** The TS types are a best-guess at tau's future wire
   shape; if the eventual protocol differs, the swap is confined to `postconditions.ts` + the
   type files. We proceed on that basis.
2. **Goal badge anchor — on the evaluated node.** The badge attaches to the node that
   produces/holds whatever the goal's `evaluates` locus points at (the producing step for a
   `steps.<id>.output` locus; the producer of the file for a path locus). If no single node
   owns the locus, fall back to a badge on the deliverable/check region nearest the artifact.
3. **Gated Workflows view — respect existing gating.** The canvas check surfaces render only
   when the Workflows view itself renders (same gating badge). The `VITE_MOCK_POSTCONDITIONS`
   flag controls the *data source*, not visibility.
```
