# Dashboard + Run-Info Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full Dashboard page, a slim overview strip on the Runs page, and cross-app run-info upgrades — all computed client-side from `GET /api/runs` — with context-window utilization surfaced as a clearly-labelled WIP stub.

**Architecture:** A single pure `dashboard/metrics.ts` aggregates `Run[]` into a `Metrics` object; the Dashboard page and Runs overview are thin renderers built from small presentational components (no chart library — inline bars). A `usePollRuns(~5s)` hook keeps the data live. Context is a front-end WIP indicator behind a documented seam (no gateway change).

**Tech Stack:** React 18, Tailwind (Slate Compact tokens), Zustand, react-router-dom, Vitest.

**Source spec:** `docs/superpowers/specs/2026-05-31-dashboard-and-info-upgrades-design.md`. **CI gate:** ESLint + Prettier + tests are enforced — run `pnpm lint && pnpm format:check && pnpm vitest run && pnpm build` before each commit. Work from `web/`. Branch `impl/gateway-v1`. End commit messages with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File structure
```
web/src/dashboard/metrics.ts(+test)   # pure aggregation
web/src/dashboard/StatCard.tsx         # presentational
web/src/dashboard/StatusBars.tsx
web/src/dashboard/RunsSparkline.tsx
web/src/dashboard/ContextBar.tsx(+test)# WIP context indicator (seam)
web/src/dashboard/AgentTable.tsx
web/src/dashboard/TopErrors.tsx
web/src/dashboard/DashboardPage.tsx(+test)  # replaces the stub
web/src/runs/usePollRuns.ts            # live ~5s poll
web/src/runs/RunsOverview.tsx          # slim stat strip
web/src/runs/run-utils.ts              # +relativeTime,+formatTokenSplit (+test)
web/src/runs/RunsTable.tsx             # info-upgrade cells
web/src/runs/RunsView.tsx              # overview + poll
web/src/trace/RunControls.tsx          # token split + stop_reason/error + context bar
web/src/app/Sidebar.tsx(+test)         # running-count badge
docs/seams.md                          # context seam row
```

---

### Task 1: metrics.ts (pure aggregation)

**Files:** Create `web/src/dashboard/metrics.ts`, `web/src/dashboard/metrics.test.ts`

- [ ] **Step 1: Write the failing test**

`web/src/dashboard/metrics.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeMetrics } from "./metrics";
import type { Run } from "../types/Run";

const T = (s: number) => `2026-05-31T00:00:0${s}.000Z`;
function run(p: Partial<Run>): Run {
  return {
    id: "x", agent_id: "greeter", prompt: "p", substrate: "host", mode: "dev",
    status: "completed", started_at: T(0), ended_at: T(1), total_turns: 1,
    token_usage: null, stop_reason: "end_turn", error: null, source: "serve", ...p,
  };
}

describe("computeMetrics", () => {
  const runs: Run[] = [
    run({ id: "a", agent_id: "greeter", status: "completed", started_at: T(0), ended_at: T(1),
      token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }),
    run({ id: "b", agent_id: "researcher", status: "failed", started_at: T(1), ended_at: T(2),
      token_usage: null, error: { kind: "rpc:-32008", detail: "tool" } }),
    run({ id: "c", agent_id: "greeter", status: "running", started_at: T(2), ended_at: null }),
  ];

  it("counts, success rate, tokens, durations", () => {
    const m = computeMetrics(runs, T(2));
    expect(m.total).toBe(3);
    expect(m.byStatus).toEqual({ running: 1, completed: 1, failed: 1, cancelled: 0 });
    expect(m.successRate).toBeCloseTo(0.5, 5); // 1 completed / 2 terminal
    expect(m.tokens).toEqual({ input: 10, output: 5, total: 15 });
    expect(m.durations).toEqual({ p50: 1000, p90: 1000, p99: 1000 });
  });

  it("per-agent rollup sorted by runs desc", () => {
    const m = computeMetrics(runs, T(2));
    expect(m.byAgent[0].agent).toBe("greeter");
    expect(m.byAgent[0].runs).toBe(2);
    expect(m.byAgent[0].successRate).toBe(1); // 1 completed of 1 terminal
    expect(m.byAgent.find((a) => a.agent === "researcher")!.successRate).toBe(0);
  });

  it("top errors group failed runs", () => {
    const m = computeMetrics(runs, T(2));
    expect(m.topErrors).toEqual([{ reason: "rpc:-32008", count: 1 }]);
  });

  it("over-time has `buckets` entries summing to the in-window count", () => {
    const m = computeMetrics(runs, T(2), 6);
    expect(m.overTime).toHaveLength(6);
    expect(m.overTime.reduce((s, b) => s + b.count, 0)).toBe(3);
  });

  it("empty input is safe", () => {
    const m = computeMetrics([], T(2));
    expect(m.total).toBe(0);
    expect(m.successRate).toBeNull();
    expect(m.durations).toBeNull();
  });
});
```
Run: `pnpm vitest run src/dashboard/metrics.test.ts` → FAIL.

- [ ] **Step 2: Implement** `web/src/dashboard/metrics.ts`:
```ts
import type { Run } from "../types/Run";

export interface AgentMetric {
  agent: string;
  runs: number;
  successRate: number | null;
  tokens: number;
  avgDurationMs: number | null;
}
export interface Metrics {
  total: number;
  byStatus: { running: number; completed: number; failed: number; cancelled: number };
  successRate: number | null;
  tokens: { input: number; output: number; total: number };
  durations: { p50: number; p90: number; p99: number } | null;
  overTime: { bucketStart: string; count: number }[];
  byAgent: AgentMetric[];
  topErrors: { reason: string; count: number }[];
}

const HOUR_MS = 3_600_000;

function durationMs(r: Run): number | null {
  return r.ended_at ? Date.parse(r.ended_at) - Date.parse(r.started_at) : null;
}
function totalTokens(r: Run): number {
  const t = r.token_usage;
  return t ? (t.total_tokens ?? t.input_tokens + t.output_tokens) : 0;
}
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}
function isTerminal(s: Run["status"]): boolean {
  return s === "completed" || s === "failed" || s === "cancelled";
}

export function computeMetrics(runs: Run[], now?: string, buckets = 12): Metrics {
  const byStatus = { running: 0, completed: 0, failed: 0, cancelled: 0 };
  const tokens = { input: 0, output: 0, total: 0 };
  const durs: number[] = [];
  for (const r of runs) {
    byStatus[r.status] += 1;
    if (r.token_usage) {
      tokens.input += r.token_usage.input_tokens;
      tokens.output += r.token_usage.output_tokens;
      tokens.total += totalTokens(r);
    }
    const d = durationMs(r);
    if (d !== null) durs.push(d);
  }
  const terminal = byStatus.completed + byStatus.failed + byStatus.cancelled;
  const successRate = terminal > 0 ? byStatus.completed / terminal : null;

  durs.sort((a, b) => a - b);
  const durations = durs.length
    ? { p50: percentile(durs, 50), p90: percentile(durs, 90), p99: percentile(durs, 99) }
    : null;

  const allTs = runs.map((r) => Date.parse(r.started_at)).filter((n) => Number.isFinite(n));
  const nowMs = now ? Date.parse(now) : allTs.length ? Math.max(...allTs) : 0;
  const overTime: { bucketStart: string; count: number }[] = [];
  for (let i = buckets - 1; i >= 0; i--) {
    const start = Math.floor(nowMs / HOUR_MS) * HOUR_MS - i * HOUR_MS;
    const end = start + HOUR_MS;
    overTime.push({
      bucketStart: new Date(start).toISOString(),
      count: allTs.filter((t) => t >= start && t < end).length,
    });
  }

  const agentMap = new Map<string, Run[]>();
  for (const r of runs) {
    const list = agentMap.get(r.agent_id) ?? [];
    list.push(r);
    agentMap.set(r.agent_id, list);
  }
  const byAgent: AgentMetric[] = [...agentMap.entries()]
    .map(([agent, rs]) => {
      let tok = 0;
      let comp = 0;
      let term = 0;
      const ds: number[] = [];
      for (const r of rs) {
        tok += totalTokens(r);
        if (r.status === "completed") comp += 1;
        if (isTerminal(r.status)) term += 1;
        const d = durationMs(r);
        if (d !== null) ds.push(d);
      }
      return {
        agent,
        runs: rs.length,
        successRate: term > 0 ? comp / term : null,
        tokens: tok,
        avgDurationMs: ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null,
      };
    })
    .sort((a, b) => b.runs - a.runs);

  const errMap = new Map<string, number>();
  for (const r of runs) {
    if (r.status !== "failed") continue;
    const reason = r.error?.kind ?? r.stop_reason ?? "unknown";
    errMap.set(reason, (errMap.get(reason) ?? 0) + 1);
  }
  const topErrors = [...errMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { total: runs.length, byStatus, successRate, tokens, durations, overTime, byAgent, topErrors };
}
```
Run: `pnpm vitest run src/dashboard/metrics.test.ts` → PASS.

- [ ] **Step 3: Commit** — `pnpm lint && pnpm format:check && pnpm build` clean, then:
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/dashboard/metrics.ts web/src/dashboard/metrics.test.ts
git commit -m "feat(web): pure metrics aggregation for the dashboard"
```

---

### Task 2: run-utils — relativeTime + formatTokenSplit

**Files:** Modify `web/src/runs/run-utils.ts`; create `web/src/runs/run-utils.test.ts`

- [ ] **Step 1: Failing test** `web/src/runs/run-utils.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { relativeTime, formatTokenSplit } from "./run-utils";
import type { Run } from "../types/Run";

const NOW = "2026-05-31T12:00:00.000Z";

describe("relativeTime", () => {
  it("formats buckets", () => {
    expect(relativeTime("2026-05-31T11:59:58.000Z", NOW)).toBe("just now");
    expect(relativeTime("2026-05-31T11:59:30.000Z", NOW)).toBe("30s ago");
    expect(relativeTime("2026-05-31T11:45:00.000Z", NOW)).toBe("15m ago");
    expect(relativeTime("2026-05-31T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-05-29T12:00:00.000Z", NOW)).toBe("2d ago");
  });
});

describe("formatTokenSplit", () => {
  it("shows in/out or dash", () => {
    const base = { token_usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } } as unknown as Run;
    expect(formatTokenSplit(base)).toBe("12 in · 8 out");
    expect(formatTokenSplit({ token_usage: null } as unknown as Run)).toBe("—");
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement** — append to `web/src/runs/run-utils.ts` (keep existing `formatTokens`/`formatDuration`). Add the `Run` import if not present (`import type { Run } from "../types/Run";`):
```ts
export function relativeTime(iso: string, now?: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const ref = now ? Date.parse(now) : Date.now();
  const s = Math.max(0, Math.floor((ref - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatTokenSplit(run: Run): string {
  const t = run.token_usage;
  return t ? `${t.input_tokens} in · ${t.output_tokens} out` : "—";
}
```
Run → PASS. **Commit:**
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/runs/run-utils.ts web/src/runs/run-utils.test.ts
git commit -m "feat(web): relativeTime + formatTokenSplit helpers"
```

---

### Task 3: Presentational components (StatCard, StatusBars, RunsSparkline, ContextBar)

**Files:** Create `web/src/dashboard/StatCard.tsx`, `StatusBars.tsx`, `RunsSparkline.tsx`, `ContextBar.tsx`, `ContextBar.test.tsx`

- [ ] **Step 1: ContextBar failing test** `web/src/dashboard/ContextBar.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextBar } from "./ContextBar";

describe("ContextBar", () => {
  it("shows WIP when no context data", () => {
    render(<ContextBar />);
    expect(screen.getByText(/wip/i)).toBeInTheDocument();
  });
  it("shows a percentage when context is present", () => {
    render(<ContextBar context={{ pct: 0.62 }} />);
    expect(screen.getByText("62%")).toBeInTheDocument();
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement the four components.**

`web/src/dashboard/StatCard.tsx`:
```tsx
import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${tone ?? ""}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-[10px] text-muted">{sub}</div>}
    </div>
  );
}
```

`web/src/dashboard/StatusBars.tsx`:
```tsx
import type { Metrics } from "./metrics";

const ROWS: { key: keyof Metrics["byStatus"]; color: string }[] = [
  { key: "completed", color: "bg-st-ok" },
  { key: "running", color: "bg-st-running" },
  { key: "failed", color: "bg-st-error" },
  { key: "cancelled", color: "bg-st-cancelled" },
];

export function StatusBars({ byStatus, total }: { byStatus: Metrics["byStatus"]; total: number }) {
  return (
    <div>
      {ROWS.map((r) => {
        const n = byStatus[r.key];
        const pct = total > 0 ? (n / total) * 100 : 0;
        return (
          <div key={r.key} className="mb-1.5 flex items-center gap-2 text-xs">
            <span className="w-20 text-muted">{r.key}</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-bg">
              <span className={`block h-2 rounded ${r.color}`} style={{ width: `${pct}%` }} />
            </span>
            <span className="w-8 text-right text-muted">{n}</span>
          </div>
        );
      })}
    </div>
  );
}
```

`web/src/dashboard/RunsSparkline.tsx`:
```tsx
import type { Metrics } from "./metrics";

export function RunsSparkline({ data }: { data: Metrics["overTime"] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-16 items-end gap-1">
      {data.map((d) => (
        <span
          key={d.bucketStart}
          title={`${new Date(d.bucketStart).toLocaleString()}: ${d.count}`}
          className="flex-1 rounded-t bg-accent/60"
          style={{ height: `${(d.count / max) * 100}%` }}
        />
      ))}
    </div>
  );
}
```

`web/src/dashboard/ContextBar.tsx` (the WIP seam — renders a real bar when `context` is supplied):
```tsx
export function ContextBar({ context }: { context?: { pct: number } | null }) {
  if (context == null) {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        title="Context-window usage — not yet reported by tau"
      >
        <span className="h-1.5 w-11 rounded-sm border border-dashed border-border" />
        <span className="rounded bg-amber-100 px-1 text-[9px] font-bold uppercase text-amber-800">
          WIP
        </span>
      </span>
    );
  }
  const pct = Math.round(context.pct * 100);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${pct}% of context window`}>
      <span className="h-1.5 w-11 overflow-hidden rounded-sm bg-bg">
        <span className="block h-1.5 rounded-sm bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[10px] text-muted">{pct}%</span>
    </span>
  );
}
```
Run `pnpm vitest run src/dashboard/ContextBar.test.tsx` → PASS. (`amber-100`/`amber-800` are default Tailwind palette colors — available; our config only *extended* colors.)

- [ ] **Step 3: Commit** (`pnpm lint && pnpm format:check && pnpm vitest run && pnpm build` clean):
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/dashboard/StatCard.tsx web/src/dashboard/StatusBars.tsx web/src/dashboard/RunsSparkline.tsx web/src/dashboard/ContextBar.tsx web/src/dashboard/ContextBar.test.tsx
git commit -m "feat(web): dashboard presentational components + WIP ContextBar"
```

---

### Task 4: AgentTable + TopErrors

**Files:** Create `web/src/dashboard/AgentTable.tsx`, `web/src/dashboard/TopErrors.tsx`

- [ ] **Step 1: Implement** `web/src/dashboard/AgentTable.tsx`:
```tsx
import type { AgentMetric } from "./metrics";
import { ContextBar } from "./ContextBar";

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const dur = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`);
const toks = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export function AgentTable({ agents }: { agents: AgentMetric[] }) {
  if (agents.length === 0) return <p className="text-xs text-muted">No runs yet.</p>;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th className="py-1 pr-2 font-medium">agent</th>
          <th className="px-2 py-1 font-medium">runs</th>
          <th className="px-2 py-1 font-medium">success</th>
          <th className="px-2 py-1 font-medium">tokens</th>
          <th className="px-2 py-1 font-medium">avg dur</th>
          <th className="px-2 py-1 font-medium">context</th>
        </tr>
      </thead>
      <tbody>
        {agents.map((a) => (
          <tr key={a.agent} className="border-b border-border/60 last:border-0">
            <td className="py-1 pr-2 font-medium">{a.agent}</td>
            <td className="px-2 py-1">{a.runs}</td>
            <td className="px-2 py-1">{pct(a.successRate)}</td>
            <td className="px-2 py-1">{toks(a.tokens)}</td>
            <td className="px-2 py-1">{dur(a.avgDurationMs)}</td>
            <td className="px-2 py-1">
              <ContextBar />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`web/src/dashboard/TopErrors.tsx`:
```tsx
import type { Metrics } from "./metrics";

export function TopErrors({ errors }: { errors: Metrics["topErrors"] }) {
  if (errors.length === 0) return <p className="text-xs text-muted">No failures.</p>;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th className="py-1 font-medium">reason</th>
          <th className="py-1 text-right font-medium">count</th>
        </tr>
      </thead>
      <tbody>
        {errors.map((e) => (
          <tr key={e.reason} className="border-b border-border/60 last:border-0">
            <td className="py-1 font-mono">{e.reason}</td>
            <td className="py-1 text-right">{e.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Commit** (checks clean):
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/dashboard/AgentTable.tsx web/src/dashboard/TopErrors.tsx
git commit -m "feat(web): AgentTable + TopErrors dashboard panels"
```

---

### Task 5: usePollRuns + DashboardPage (replace the stub)

**Files:** Create `web/src/runs/usePollRuns.ts`; replace `web/src/dashboard/DashboardPage.tsx`; create `web/src/dashboard/DashboardPage.test.tsx`

- [ ] **Step 1: usePollRuns** `web/src/runs/usePollRuns.ts`:
```ts
import { useEffect } from "react";
import { useStore } from "../store/store";

/** Refresh the runs list now and every `ms` while mounted (keeps dashboards live). */
export function usePollRuns(ms = 5000) {
  const refreshRuns = useStore((s) => s.refreshRuns);
  useEffect(() => {
    refreshRuns().catch(() => {});
    const t = setInterval(() => refreshRuns().catch(() => {}), ms);
    return () => clearInterval(t);
  }, [refreshRuns, ms]);
}
```

- [ ] **Step 2: DashboardPage failing test** `web/src/dashboard/DashboardPage.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";
import { useStore } from "../store/store";
import type { Run } from "../types/Run";

function run(p: Partial<Run>): Run {
  return {
    id: "x", agent_id: "greeter", prompt: "p", substrate: "host", mode: "dev",
    status: "completed", started_at: "2026-05-31T00:00:00.000Z", ended_at: "2026-05-31T00:00:01.000Z",
    total_turns: 1, token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    stop_reason: "end_turn", error: null, source: "serve", ...p,
  };
}

beforeEach(() => useStore.setState({ runs: [run({ id: "a" }), run({ id: "b", agent_id: "researcher" })] }));

describe("DashboardPage", () => {
  it("renders headline stats, an agent row, and the context WIP marker", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("researcher")).toBeInTheDocument();
    expect(screen.getAllByText(/wip/i).length).toBeGreaterThan(0);
  });
});
```
Run → FAIL.

- [ ] **Step 3: Implement** `web/src/dashboard/DashboardPage.tsx` (replaces the "coming soon" stub):
```tsx
import { useMemo } from "react";
import { useStore } from "../store/store";
import { usePollRuns } from "../runs/usePollRuns";
import { computeMetrics } from "./metrics";
import { StatCard } from "./StatCard";
import { StatusBars } from "./StatusBars";
import { RunsSparkline } from "./RunsSparkline";
import { AgentTable } from "./AgentTable";
import { TopErrors } from "./TopErrors";

const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
const fmtMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 text-xs font-semibold text-muted">{title}</div>
      {children}
    </div>
  );
}

export function DashboardPage() {
  usePollRuns();
  const runs = useStore((s) => s.runs);
  const m = useMemo(() => computeMetrics(runs), [runs]);
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Runs" value={m.total} sub={`${m.byStatus.running} running`} />
        <StatCard
          label="Success rate"
          tone="text-st-ok"
          value={m.successRate == null ? "—" : `${Math.round(m.successRate * 100)}%`}
          sub={`${m.byStatus.completed} ok · ${m.byStatus.failed} failed`}
        />
        <StatCard label="Running now" tone="text-st-running" value={m.byStatus.running} sub="live" />
        <StatCard
          label="Tokens"
          value={fmtTok(m.tokens.total)}
          sub={`${fmtTok(m.tokens.input)} in · ${fmtTok(m.tokens.output)} out`}
        />
        <StatCard
          label="Latency p50"
          value={m.durations ? fmtMs(m.durations.p50) : "—"}
          sub={m.durations ? `p90 ${fmtMs(m.durations.p90)} · p99 ${fmtMs(m.durations.p99)}` : undefined}
        />
        <StatCard
          label="Context"
          value={
            <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">
              WIP
            </span>
          }
          sub="awaiting tau data"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Status distribution">
          <StatusBars byStatus={m.byStatus} total={m.total} />
        </Panel>
        <Panel title="Runs over time">
          <RunsSparkline data={m.overTime} />
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="By agent">
          <AgentTable agents={m.byAgent} />
        </Panel>
        <Panel title="Top failure reasons">
          <TopErrors errors={m.topErrors} />
        </Panel>
      </div>
    </div>
  );
}
```
Run `pnpm vitest run src/dashboard/DashboardPage.test.tsx` → PASS. (The page uses no router hooks, so no MemoryRouter needed; `usePollRuns`'s fetch rejects harmlessly in jsdom and is caught, leaving the seeded `runs` intact.)

- [ ] **Step 4: Commit** (checks clean):
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/runs/usePollRuns.ts web/src/dashboard/DashboardPage.tsx web/src/dashboard/DashboardPage.test.tsx
git commit -m "feat(web): Dashboard page (metrics overview) + usePollRuns"
```

---

### Task 6: RunsOverview + wire into RunsView

**Files:** Create `web/src/runs/RunsOverview.tsx`; modify `web/src/runs/RunsView.tsx`

- [ ] **Step 1: RunsOverview** `web/src/runs/RunsOverview.tsx`:
```tsx
import { useMemo } from "react";
import { useStore } from "../store/store";
import { computeMetrics } from "../dashboard/metrics";
import { StatCard } from "../dashboard/StatCard";

const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

export function RunsOverview() {
  const runs = useStore((s) => s.runs);
  const m = useMemo(() => computeMetrics(runs), [runs]);
  return (
    <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
      <StatCard label="Runs" value={m.total} />
      <StatCard
        label="Success rate"
        tone="text-st-ok"
        value={m.successRate == null ? "—" : `${Math.round(m.successRate * 100)}%`}
      />
      <StatCard label="Running" tone="text-st-running" value={m.byStatus.running} />
      <StatCard label="Tokens" value={fmtTok(m.tokens.total)} />
      <StatCard label="Latency p50" value={m.durations ? `${(m.durations.p50 / 1000).toFixed(1)}s` : "—"} />
    </div>
  );
}
```

- [ ] **Step 2: Wire into RunsView** — replace `web/src/runs/RunsView.tsx` (uses `usePollRuns` instead of the one-shot effect, adds the overview above the table):
```tsx
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { usePollRuns } from "./usePollRuns";
import { Launcher } from "./Launcher";
import { RunsTable } from "./RunsTable";
import { RunsOverview } from "./RunsOverview";

export function RunsView() {
  const runs = useStore((s) => s.runs);
  const navigate = useNavigate();
  usePollRuns();

  return (
    <section className="p-4">
      <h2 className="mb-3 text-base font-semibold">Runs</h2>
      <Launcher />
      <RunsOverview />
      <RunsTable runs={runs} onOpen={(id) => navigate(`/runs/${id}`)} />
    </section>
  );
}
```

- [ ] **Step 3: Verify + commit** — `pnpm vitest run` (routing test still finds the prompt input on /runs), then checks clean:
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/runs/RunsOverview.tsx web/src/runs/RunsView.tsx
git commit -m "feat(web): Runs page overview strip + live poll"
```

---

### Task 7: RunsTable info upgrades

**Files:** Modify `web/src/runs/RunsTable.tsx`; `web/src/runs/RunsTable.test.tsx` must still pass.

- [ ] **Step 1: Replace** `web/src/runs/RunsTable.tsx` (adds relative time + abs-time tooltip, in/out split, a Reason cell, and a Context WIP bar; keeps all currently-asserted strings — `agent_id`, status word, `host · dev`, `… tok`, empty state):
```tsx
import type { Run } from "../types/Run";
import { StatusBadge, SubstrateModeBadge } from "./badges";
import { formatTokens, formatDuration, relativeTime, formatTokenSplit } from "./run-utils";
import { ContextBar } from "../dashboard/ContextBar";

function reasonOf(r: Run): { text: string; cls: string } {
  if (r.status === "failed") return { text: r.error?.kind ?? "failed", cls: "text-st-error" };
  if (r.status === "completed" && r.stop_reason && r.stop_reason !== "end_turn")
    return { text: r.stop_reason, cls: "text-muted" };
  return { text: "—", cls: "text-muted" };
}

export function RunsTable({ runs, onOpen }: { runs: Run[]; onOpen: (id: string) => void }) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted">No runs yet. Launch one above.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Agent</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Substrate/Mode</th>
            <th className="px-3 py-2 font-medium">Started</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">Tokens</th>
            <th className="px-3 py-2 font-medium">Reason</th>
            <th className="px-3 py-2 font-medium">Context</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const reason = reasonOf(r);
            return (
              <tr
                key={r.id}
                onClick={() => onOpen(r.id)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
              >
                <td className="px-3 py-2 font-medium">{r.agent_id}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2">
                  <SubstrateModeBadge substrate={r.substrate} mode={r.mode} />
                </td>
                <td className="px-3 py-2 text-xs text-muted" title={r.started_at}>
                  {relativeTime(r.started_at)}
                </td>
                <td className="px-3 py-2 text-xs">{formatDuration(r)}</td>
                <td className="px-3 py-2 text-xs">
                  {formatTokens(r)}
                  <span className="ml-1 text-muted">{r.token_usage ? `(${formatTokenSplit(r)})` : ""}</span>
                </td>
                <td className={`px-3 py-2 text-xs ${reason.cls}`}>{reason.text}</td>
                <td className="px-3 py-2">
                  <ContextBar />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify the existing table test still passes**

Run: `pnpm vitest run src/runs/RunsTable.test.tsx`
Expected: 2 pass — it asserts `greeter`, `completed`, `host · dev`, and the empty-state text, all preserved. (`formatTokens` still renders `"20 tok"` so the e2e `/tok/` assertion holds.)

- [ ] **Step 3: Commit** (checks clean):
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/runs/RunsTable.tsx
git commit -m "feat(web): runs table — relative time, token split, reason, context (WIP)"
```

---

### Task 8: RunControls upgrade + Sidebar running-count badge + seam doc

**Files:** Modify `web/src/trace/RunControls.tsx`, `web/src/app/Sidebar.tsx`, `web/src/app/Sidebar.test.tsx`, `docs/seams.md`

- [ ] **Step 1: RunControls** — replace `web/src/trace/RunControls.tsx` (adds token split, stop_reason/error, and the WIP ContextBar to the trace metrics row):
```tsx
import { useStore } from "../store/store";
import { StatusBadge } from "../runs/badges";
import { formatTokens, formatDuration, formatTokenSplit } from "../runs/run-utils";
import { ContextBar } from "../dashboard/ContextBar";

export function RunControls() {
  const trace = useStore((s) => s.currentTrace);
  const cancel = useStore((s) => s.cancelCurrent);
  if (!trace) return null;
  const { run } = trace;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
      <StatusBadge status={run.status} />
      <span className="text-xs text-muted">turns: {run.total_turns ?? "—"}</span>
      <span className="text-xs text-muted">
        {formatTokens(run)}
        {run.token_usage ? ` (${formatTokenSplit(run)})` : ""}
      </span>
      <span className="text-xs text-muted">{formatDuration(run)}</span>
      <ContextBar />
      {run.stop_reason && run.status === "completed" && (
        <span className="text-xs text-muted">stop: {run.stop_reason}</span>
      )}
      {run.error && <span className="text-xs text-st-error">error: {run.error.kind}</span>}
      {run.status === "running" && (
        <button
          onClick={() => cancel()}
          className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs hover:bg-bg"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Sidebar badge — failing test** — add to `web/src/app/Sidebar.test.tsx` a case:
```tsx
import { useStore } from "../store/store";
// ...existing imports (describe/it/expect, render/screen, MemoryRouter, Sidebar)...

it("shows a running-count badge when runs are in flight", () => {
  useStore.setState({
    runs: [
      { id: "a", status: "running" } as never,
      { id: "b", status: "completed" } as never,
    ],
  });
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
  expect(screen.getByText("1")).toBeInTheDocument();
});
```
Run → FAIL.

- [ ] **Step 3: Sidebar implementation** — replace `web/src/app/Sidebar.tsx`:
```tsx
import { NavLink } from "react-router-dom";
import { useStore } from "../store/store";

const ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: "▦" },
  { to: "/runs", label: "Runs", icon: "≣" },
  { to: "/health", label: "Health", icon: "♥" },
];

export function Sidebar() {
  const running = useStore((s) => s.runs.filter((r) => r.status === "running").length);
  return (
    <aside className="flex w-[150px] flex-col gap-1 border-r border-border bg-surface px-2 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        <span className="h-4 w-4 rounded bg-accent" />
        <strong className="text-xs">tau-web-ui</strong>
      </div>
      {ITEMS.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
              isActive ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"
            }`
          }
        >
          <span aria-hidden>{it.icon}</span>
          {it.label}
          {it.to === "/runs" && running > 0 && (
            <span className="ml-auto rounded-full bg-st-running-soft px-1.5 text-[10px] font-semibold text-st-running">
              {running}
            </span>
          )}
        </NavLink>
      ))}
    </aside>
  );
}
```
Run `pnpm vitest run src/app/Sidebar.test.tsx` → PASS (both the link test and the badge test). Note: the link test from the shell plan asserts `getByRole("link", { name: /runs/i })` — with the badge, the accessible name becomes "Runs 1" when a run is active, but that test seeds no runs (or reset), so the badge is absent there. If the link test now fails because a prior test left `runs` in the store, add `beforeEach(() => useStore.setState({ runs: [] }))` to `Sidebar.test.tsx`.

- [ ] **Step 4: Document the seam** — append a row to `docs/seams.md` under the table:
```markdown
| Context-window utilization | `web/src/dashboard/ContextBar.tsx` (renders WIP now; pass `context={{pct}}` to activate) | tau emitting context-window size + per-turn peak tokens → add nullable `context` to gateway `Run`, populate in serve-adapter, regen TS types |
```

- [ ] **Step 5: Verify + commit** — `pnpm vitest run && pnpm lint && pnpm format:check && pnpm build` clean:
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/trace/RunControls.tsx web/src/app/Sidebar.tsx web/src/app/Sidebar.test.tsx docs/seams.md
git commit -m "feat(web): run controls info upgrades + sidebar running-count badge; doc context seam"
```

---

### Task 9: End-to-end verification

**Files:** none (verification + evidence)

- [ ] **Step 1: Full local gate**

Run (from `web/`): `pnpm vitest run && pnpm lint && pnpm format:check && pnpm typecheck && pnpm build`
Expected: all green (new metrics/run-utils/ContextBar/DashboardPage/Sidebar tests + existing).

- [ ] **Step 2: e2e**

Run:
```bash
cd /Users/titouanlebocq/code/tau-ui && cargo build --workspace
cd web && pnpm exec playwright install chromium && CI=1 pnpm e2e
```
Expected: both Playwright tests pass. The runs flow is unchanged (Dashboard is a separate route; RunsTable keeps its labels). If a selector breaks, a visible string changed — restore it; don't weaken the test.

- [ ] **Step 3: Manual look (no commit)**

Start the gateway + `pnpm dev`. Launch a couple of runs, then open `/dashboard` — confirm the stat cards, status bars, sparkline, by-agent table, top-errors, and the **WIP** context markers render and update (~5s poll). Check the Runs page overview strip + new table cells + the sidebar running-count badge while a run is in flight.

- [ ] **Step 4: Refresh screenshot + push**

```bash
cd web && CI=1 pnpm e2e   # rewrites docs/verification/trace-complete.png if changed
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "test(web): verify dashboard + info upgrades keep suites green; refresh evidence"
git push
gh run watch "$(gh run list --branch impl/gateway-v1 --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status --interval 20
```
Expected: `rust`, `web`, `e2e` all green. Fix any failure at its source and re-push.

---

## Self-review
1. **Spec coverage:** §2 metrics module → T1. §3 components (StatCard/StatusBars/RunsSparkline/ContextBar/AgentTable/TopErrors/DashboardPage/RunsOverview) → T3,T4,T5,T6. §4 info upgrades (relativeTime/formatTokenSplit → T2; RunsTable cells → T7; RunControls → T8; Sidebar badge → T8; context bar in trace → T8 via RunControls) → covered. §5 usePollRuns → T5/T6. §6 context seam doc → T8. §7 testing → T1,T2,T3,T5,T8 + existing. §8 acceptance → T9. ✓
2. **Placeholder scan:** every component/test is full code; no TBD. ✓
3. **Type consistency:** `Metrics`/`AgentMetric` defined in T1 and imported by StatusBars/RunsSparkline/AgentTable/TopErrors/DashboardPage/RunsOverview; `computeMetrics(runs, now?, buckets?)` signature used consistently; `ContextBar` prop `context?: { pct } | null` consistent across AgentTable/RunsTable/RunControls; `relativeTime`/`formatTokenSplit` signatures match their tests. ✓
4. **Note:** the spec listed a separate `ContextStat.tsx`; this plan folds the dashboard Context card into `DashboardPage` (inline WIP badge) and uses `ContextBar` everywhere else — fewer files, same behavior (YAGNI). The trace-header context bar lives in `RunControls` (the trace metrics row) rather than a separate `TraceView` edit. Both are intentional simplifications.
