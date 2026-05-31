# Dashboard + run-info upgrades — design

**Date:** 2026-05-31
**Status:** Approved (brainstorm), pending spec review → writing-plans
**Scope:** A full **Dashboard** page (overview metrics), a slim **overview strip** on the Runs page, and cross-app **info upgrades** on run displays — all computed client-side from `GET /api/runs`. Context-window utilization is surfaced as a **work-in-progress stub** (tau doesn't emit the data yet) behind a documented seam.

## 0. Decisions (locked in brainstorm)
- **Category scope (research-backed):** Volume · Success/Error rate · Latency (p50/p90/p99) · Token usage (tokens, not $) · Recent/Live runs + drill-down · Per-agent breakdown · + Top failure reasons. (Deferred, need backend: $cost, per-model, eval scores, alerts/SLOs, per-step latency.)
- **Context utilization:** per-run and per-agent **WIP stub** (front-end only, no gateway change) with a seam to light up when tau emits context-window data.
- **Info upgrades (all four):** relative timestamps · input/output token split · stop-reason/error surfaced · active-runs sidebar badge + per-run context bar (WIP).
- **Both surfaces:** Runs page gets a slim stat strip above the table; Dashboard is its own full page. **Landing stays `/runs`.**
- **No chart library** — simple inline SVG/div bars (YAGNI). Recharts is a future option.
- **Live data:** a light poll (~5s) of `GET /api/runs` while a Runs/Dashboard view is mounted.

## 1. Architecture
A single pure module **`web/src/dashboard/metrics.ts`** aggregates a `Run[]` into a `Metrics` object; the Dashboard page and the Runs overview strip are thin renderers of that object + small presentational components. No new backend, no new store fields beyond what already exists (`runs`, `refreshRuns`). Live-ness comes from a `usePollRuns(ms)` hook that calls `refreshRuns` on an interval while mounted.

## 2. The metrics module (pure, testable)
`web/src/dashboard/metrics.ts`:

```ts
export interface AgentMetric {
  agent: string;
  runs: number;
  successRate: number | null; // completed / terminal, null if none terminal
  tokens: number;             // sum token_usage.total (or in+out)
  avgDurationMs: number | null;
}
export interface Metrics {
  total: number;
  byStatus: { running: number; completed: number; failed: number; cancelled: number };
  successRate: number | null;               // completed / (completed+failed+cancelled)
  tokens: { input: number; output: number; total: number };
  durations: { p50: number; p90: number; p99: number } | null; // ms, over runs with ended_at; null if none
  overTime: { bucketStart: string; count: number }[];          // N hourly buckets ending at `now`
  byAgent: AgentMetric[];                    // sorted by runs desc
  topErrors: { reason: string; count: number }[]; // failed runs grouped; top 5
}
export function computeMetrics(runs: Run[], now?: string, buckets = 12): Metrics;
```

Rules: durations from `Date.parse(ended_at) - Date.parse(started_at)` for runs with `ended_at`; percentiles via nearest-rank on the sorted array. `overTime` buckets runs by the hour of `started_at` across the last `buckets` hours ending at `now` (defaults to the latest run timestamp when `now` omitted, for deterministic tests). `topErrors.reason = run.error?.kind ?? run.stop_reason ?? "unknown"` over `status === "failed"` runs, counted and sorted desc, top 5. Empty-list input returns zeros/nulls without throwing.

## 3. Components
Under `web/src/dashboard/` (Tailwind, Slate Compact tokens; bars are inline `style={{ width }}` — the allowed dynamic-inline exception):
- **`StatCard.tsx`** — `{ label, value, sub? }` card. Reused by Dashboard + Runs overview.
- **`StatusBars.tsx`** — horizontal bars per status (completed/running/failed/cancelled) with counts.
- **`RunsSparkline.tsx`** — vertical bars from `metrics.overTime`.
- **`AgentTable.tsx`** — per-agent rows (agent, runs, success%, tokens, avg dur, **ContextBar** WIP).
- **`TopErrors.tsx`** — reason + count table; empty state "no failures".
- **`ContextStat.tsx`** / **`ContextBar.tsx`** — the WIP indicators (greyed dashed bar + "WIP" badge). Props accept an optional `context` that is always `undefined` in v1; they render WIP when absent and a real bar when present (the seam).
- **`DashboardPage.tsx`** — composes: stat-card row (Runs, Success rate, Running now, Tokens (in/out), Latency p50 (p90/p99 sub), Context WIP) → StatusBars + RunsSparkline → AgentTable + TopErrors. Calls `usePollRuns()`; reads `useStore(s => s.runs)`; `useMemo(() => computeMetrics(runs), [runs])`.
- **`web/src/runs/RunsOverview.tsx`** — a slim strip of 4–5 StatCards (Runs, Success rate, Running, Tokens, Latency p50) above the table on the Runs page.

## 4. Info upgrades (cross-app)
- **`web/src/runs/run-utils.ts`** — add `relativeTime(iso, now?): string` ("2m ago", "just now", "3h ago") and `formatTokenSplit(run): string` ("12 in · 8 out"). Pure, unit-tested.
- **`RunsTable.tsx`** — Started cell → `relativeTime` with `title={absolute}`; Tokens cell → total + a muted `formatTokenSplit`; add a compact **Reason** cell: for `failed` show `error.kind` (red), for `completed` show `stop_reason` when not `end_turn` (muted), else "—"; add a **Context** cell rendering `<ContextBar />` (WIP). Keep all currently-asserted text (agent, status word, `host · dev`, tokens "… tok").
- **`RunControls.tsx`** — add `formatTokenSplit` next to the total, and show `stop_reason`/`error.detail` when present.
- **`app/Sidebar.tsx`** — on the Runs `NavLink`, render a small count badge when `useStore(s => s.runs.filter(r => r.status==='running').length) > 0`.
- **`trace/TraceView.tsx`** — add a small `<ContextBar />` (WIP) in the trace header next to the metrics.

## 5. Live data — `usePollRuns`
`web/src/runs/usePollRuns.ts`: a hook that calls `refreshRuns().catch(()=>{})` immediately and every `ms` (default 5000) via `setInterval`, clearing on unmount. Used by `RunsView` (replaces its one-shot effect) and `DashboardPage`. The Sidebar badge + Dashboard reflect `store.runs`, kept fresh while those views are open. (On the trace route the badge may lag by up to one poll interval — acceptable.)

## 6. Context WIP seam (documented)
Context-window utilization per run = peak prompt tokens ÷ model context window. tau emits neither the window size nor per-turn peak today, so v1 renders WIP. **Seam:** when tau exposes it (via run events), add a nullable `context: { used_tokens, window_tokens, pct } | null` to the gateway `Run` model, have the serve-adapter track peak `input_tokens` across `TurnCompleted` and divide by the window, regenerate TS types, and pass `run.context` into `ContextBar`/`ContextStat` — which already render a real bar when the prop is present. No UI restructuring needed to activate it. Record this in `docs/seams.md`.

## 7. Testing
- `metrics.test.ts` — counts/byStatus; successRate (incl. null on no-terminal); token sums + split; percentiles (known array → exact p50/p90/p99); overTime bucketing with a fixed `now`; byAgent rollup + per-agent successRate; topErrors grouping/ordering; empty-list safety.
- `run-utils` tests — `relativeTime` (just now / Nm / Nh / Nd with a fixed `now`); `formatTokenSplit`.
- Render smoke — `DashboardPage` (seed `useStore.setState({ runs: [...] })`, MemoryRouter, assert a stat value + an agent row + a "WIP" appears); `RunsOverview` (renders stat cards); `Sidebar` badge appears when a running run is in the store.
- Existing unit + Playwright e2e must stay green (RunsTable keeps its asserted strings; the e2e flows are unchanged — Dashboard is a separate route).

## 8. Acceptance criteria
1. `/dashboard` shows the stat-card row, status bars, runs-over-time, by-agent table, and top-errors — all reflecting the current runs, updating live (~5s poll) while open.
2. The Runs page shows a slim stat strip above the table; the table shows relative time (with absolute tooltip), in/out token split, a stop-reason/error reason cell, and a WIP context bar.
3. Context appears as a clearly-labelled **WIP** indicator per run and per agent (never a fake number).
4. The sidebar **Runs** item shows a live running-count badge when runs are in flight.
5. `metrics.ts` and `relativeTime` are unit-tested with exact expected values; all pre-existing unit + e2e tests still pass.

## 9. Non-goals (YAGNI)
- No dollar cost, per-model breakdown, eval/quality scores, or alerts/SLOs (need backend).
- No real context numbers until tau emits the data (WIP stub only).
- No chart library; no change to the default landing route; no gateway/Rust changes.

## 10. File-change summary
- **New:** `web/src/dashboard/{metrics.ts, metrics.test.ts, StatCard.tsx, StatusBars.tsx, RunsSparkline.tsx, AgentTable.tsx, TopErrors.tsx, ContextStat.tsx, ContextBar.tsx, DashboardPage.tsx, DashboardPage.test.tsx}`; `web/src/runs/{RunsOverview.tsx, usePollRuns.ts}`; tests for `run-utils` and the Sidebar badge.
- **Modified:** `web/src/dashboard/DashboardPage.tsx` replaces the stub; `web/src/runs/run-utils.ts` (+`relativeTime`,`formatTokenSplit`); `web/src/runs/RunsTable.tsx` (new cells); `web/src/runs/RunsView.tsx` (RunsOverview + `usePollRuns`); `web/src/trace/RunControls.tsx` (token split + stop_reason/error); `web/src/app/Sidebar.tsx` (badge); `web/src/trace/TraceView.tsx` (context bar); `docs/seams.md` (context seam).
