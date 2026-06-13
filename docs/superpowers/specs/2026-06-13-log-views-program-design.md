# Log & event views — multi-phase program

**Date:** 2026-06-13
**Status:** Design under review; not yet approved for implementation plans.
**Scope:** Give tau-ui a "Sentry-like" view of logs. Audit found this decomposes into **7 surfaces across 3 phases**, unified by **one reusable rendering component**. This spec defines the program, the load-bearing architecture, and — per the requester — a **multi-session execution model** where each session is self-contained (no dependency on another session's context) and self-guiding (ends by telling the user the next step).

References verified against the gateway + web on branch `denver`.

---

## 1. Background & key finding

The UI throws away almost all the execution signal it already receives.

- The gateway emits **five event kinds** per run — `text_delta`, `tool_started`, `tool_completed`, `run_completed`, `fatal_error` — plus an `unknown:*` forward-compat fallback (`gateway/src/adapters/serve.rs:83-199`).
- **All kinds are persisted** to per-run NDJSON and replayed in file order (`gateway/src/store/mod.rs:85-95`) and **all kinds are streamed** to the browser, live and as a connect-time snapshot (`gateway/src/api/ws.rs`).
- The frontend **renders only `text_delta`** (→ `assistantText`); every other event falls through `applyWs`'s `case "event"` and is dropped (`web/src/store/store.ts:270-273`).

So the highest-value work is **render-only** — the data is already in the client.

The audit also surfaced a **second, distinct "log" need** that must not be conflated with the execution stream: config pages that **fail silently** (`.catch(() => {})`) → blank screens with no signal. These need error surfacing, not a log stream.

**Two needs, kept separate:**
1. **Execution logs** — the per-run event stream (and later, cross-run + build + gateway streams). Rendered by a shared `LogStream`.
2. **Operation/system failures** — silent async failures on config pages. Surfaced via the existing toast path (`web/src/notify/notify.ts`).

---

## 2. The load-bearing decision: one generic `LogStream`

Four of the seven surfaces (#1 per-run, #4 project-wide, #5 build, #7 gateway) are the same UI: *a stream of timestamped, leveled, filterable entries.* Build it **once**, **source-agnostic**, in Phase 1. Later surfaces become "new data source + mount the component," not new UIs.

**Decision: generic-first.** The requester committed to all 7, so the small upfront cost of a source-agnostic component beats a Phase-2 rewrite.

### 2.1 The frozen contract (the independence anchor)

This contract is the artifact later sessions consume **instead of** Phase-1 session context. It is committed early and treated as frozen; downstream sessions code against it without reading the upstream session.

```ts
// web/src/logs/types.ts  — the frozen contract
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;          // stable key (event ts+span_id, or synthetic)
  ts: string;          // ISO timestamp
  level: LogLevel;
  source: string;      // e.g. run id, "build", "gateway"
  kind: string;        // original event kind / category
  label: string;       // one-line human summary
  detail?: unknown;    // expandable structured payload (JSON)
  runId?: string;      // for "jump to trace"
  spanId?: string | null;
}

export interface LogStreamProps {
  entries: LogEntry[];
  // filtering is controlled by the host; LogStream renders filter UI and
  // calls back, but does not own the data source.
  filters?: LogFilterState;
  onFiltersChange?: (f: LogFilterState) => void;
  onEntryClick?: (e: LogEntry) => void;  // host decides navigation
  live?: boolean;      // show "tailing" affordance + autoscroll
}

export interface LogFilterState {
  levels: LogLevel[];      // multi-select
  kinds: string[];         // multi-select
  query: string;           // full-text over label+detail
}
```

`LogStream` is **pure presentation + client-side filtering**. It never fetches. Each surface owns its data source and maps source data → `LogEntry[]`.

### 2.2 The event→entry mapper (also Phase 1, also frozen)

```ts
// web/src/logs/mapEvent.ts
export function eventToLogEntry(e: Event): LogEntry
```

Maps the five gateway kinds to levels/labels:

| kind | level | label example | detail |
|---|---|---|---|
| `text_delta` | debug | (folded/aggregated, or hidden by default) | — |
| `tool_started` | info | `▶ tool: <name>` | args |
| `tool_completed` | info / **error** if `is_error`/`ok=false` | `✔ tool: <name>` / `✖ tool: <name>` | result |
| `run_completed` | info | `run completed` | payload |
| `fatal_error` | **error** | `fatal: <variant>` | message + payload |
| `unknown:*` | warn | `<kind>` | raw payload |

`tool_completed` error detection mirrors the gateway's own span-status logic (`serve.rs:136-139`).

---

## 3. The seven surfaces

| # | Surface | Phase | Data | New backend? |
|---|---|---|---|---|
| 1 | Per-run **Logs tab** in `TraceView` | 1 | client already has events | no |
| 2 | Prominent **run-failure detail** in run header | 1 | `fatal_error` event + `run.error` | no |
| 3 | **Silent-failure toasts** on config pages | 1 | existing errors | no |
| 4 | **Project-wide event feed** (new sidebar route) | 2 | cross-run events | **yes** — aggregation/query endpoint |
| 5 | **Ship / build output logs** | 2 | build stdout/stderr | **yes** — capture build output as events |
| 6 | **Error grouping / "Issues"** | 3 | fingerprinted errors | **yes** — fingerprint + aggregate (builds on #4) |
| 7 | **Gateway system log** | 2 | gateway `tracing` output | **yes** — tracing sink + log endpoint |

### Per-surface notes
- **#1** — new `"logs"` tab alongside `graph`/`timeline` (`web/src/trace/TraceView.tsx:40-47`). Maps `currentTrace` events via `eventToLogEntry`, mounts `LogStream live={run.status==="running"}`. `onEntryClick` selects the entry's span in the existing inspector.
- **#2** — when `run.status==="failed"`, render `run.error` (kind+detail, `web/src/types/RunError`) and the latest `fatal_error` event prominently in `RunControls` (`web/src/trace/RunControls.tsx`), not buried in a span.
- **#3** — wire silent catches at `ShipPage.tsx`, `graph/GraphEditor.tsx`, `packages/PackagesPage.tsx`, `agents/AgentsIndexPage.tsx`, `tools/*` into `surfaceError` (`web/src/notify/notify.ts`). Independent of the LogStream work.
- **#4** — new gateway endpoint returning cross-run events (events exist per-run only today; this is the new query path). New sidebar route mounts `LogStream` with run/agent/kind filters; `onEntryClick` → navigate to trace.
- **#5** — gateway captures build stdout/stderr as run events; render with `LogStream`. Largest backend seam in Phase 2.
- **#6** — error fingerprinting + aggregation over #4's path; an **Issues** view (grouped/dedup list, *not* a `LogStream`). Largest single item; last.
- **#7** — add a `tracing` sink + SSE/WS log endpoint; viewer reuses `LogStream`. Independent of #4/#5.

---

## 4. Phasing & dependency graph

```
Phase 1 (frontend only, no gateway changes)
  CONTRACT  →  freeze web/src/logs/types.ts + mapEvent.ts   ← every later phase depends on THIS file, not on P1 sessions
     ├─ #1 Per-run Logs tab        (builds LogStream + mapper)
     ├─ #2 Run-failure detail      (consumes mapper; folds into #1 at merge)
     └─ #3 Silent-failure toasts   (independent; fully parallel)

Phase 2 (each = one backend seam + reuse LogStream)
     ├─ #4 Project-wide feed       (cross-run query endpoint)
     ├─ #5 Build output logs       (build-output capture)
     └─ #7 Gateway system log      (tracing sink + endpoint)   ← all three parallel

Phase 3
     └─ #6 Error grouping / Issues (builds on #4's query path)
```

Hard ordering: **Contract → everything**; **#4 → #6**. Everything else is parallelizable.

---

## 5. Multi-session execution model

The requester's constraints: **(a)** sessions independent of each other's context even when features are sequential, and **(b)** each session guides the user to the next step.

### 5.1 Independence mechanism
Sessions never share *conversation* context. They share **committed artifacts**:
1. **This spec** (the program map).
2. **The frozen contract** (`web/src/logs/types.ts` + `mapEvent.ts`) — committed at the end of Session 1, before any Phase-2 session starts. Phase-2 sessions read the file, not Session 1.
3. **Per-session handoff prompts** (produced by `writing-plans`) — each is fully self-contained: goal, the exact files to read for context, the contract path, the work, acceptance criteria, gates, and the next-step pointer.

A sequential dependency (e.g. #4 needs #1's component) is satisfied because #1's output is a **committed, documented interface**, so the #4 session needs zero knowledge of how #1 was built.

### 5.2 Session breakdown (one handoff per row)

| Session | Items | Depends on (committed artifacts) | Produces |
|---|---|---|---|
| **S1 — Foundation** | Contract + #1 + #2 | this spec | `logs/` module, Logs tab, failure detail; **freezes the contract** |
| **S2 — Toasts** | #3 | this spec (none on S1) | error surfacing on 5 config pages — *can run concurrently with S1* |
| **S3 — Project feed** | #4 | spec + frozen contract | cross-run endpoint + sidebar route |
| **S4 — Build logs** | #5 | spec + frozen contract | build-output capture + render |
| **S5 — Gateway log** | #7 | spec + frozen contract | tracing sink + endpoint + viewer |
| **S6 — Issues** | #6 | spec + S3's endpoint (committed) | fingerprinting + Issues view |

S1 and S2 run in parallel immediately. S3/S4/S5 run in parallel after S1 merges. S6 runs after S3 merges.

### 5.3 Self-guiding requirement
Every handoff ends with a **"Next step" block** the session surfaces to the user on completion, e.g.:

> ✅ S1 complete: contract frozen at `web/src/logs/types.ts`, Logs tab live.
> **Next:** S3/S4/S5 are now unblocked and independent — open three sessions with handoffs `S3-project-feed.md`, `S4-build-logs.md`, `S5-gateway-log.md`. S2 (toasts) may already be merged. S6 waits for S3.

Each session reports what it finished, what it unblocked, and exactly which handoff(s) to start next — so the user can orchestrate without holding the plan in their head.

---

## 6. Testing & gates

- **TDD per item.** `LogStream` (filtering, level/kind/query, autoscroll-when-live), `eventToLogEntry` (each kind incl. `unknown:*` and error detection), tab integration, toast wiring.
- Each session's gate runs: `vitest run`, `tsc`, `eslint`, **`prettier --write` (format)** — format included per-task to avoid the final-gate re-touch problem.
- Backend items (S3–S6) add Rust tests at the gateway boundary (endpoint shape, fingerprint stability).

---

## 7. Out of scope (this program)
- Compiled-IR / bundle inspector (separate, issue #50).
- Log retention / rotation policy beyond existing NDJSON.
- Alerting / notifications on errors (a possible future on top of #6).
- Dark mode (existing seam, not this work).

---

## 8. Open questions
1. `text_delta` in the Logs tab — fold into a single "assistant output" entry, hide by default behind a filter, or omit (assistant text already has its own stream)? *Leaning: hide by default, toggle on.*
2. Phase-1 toasts (#3) — bundle into S1's release or ship S2 separately? *Leaning: separate session, separate PR, can land first.*
