import { useMemo } from "react";
import type { ReactNode } from "react";
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

function Panel({ title, children }: { title: string; children: ReactNode }) {
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
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Runs"
          value={m.total}
          sub={`${m.byKind.workflow} wf · ${m.byKind.agent} agent`}
        />
        <StatCard
          label="Success rate"
          tone="text-st-ok"
          value={m.successRate == null ? "—" : `${Math.round(m.successRate * 100)}%`}
          sub={`${m.byStatus.completed} ok · ${m.byStatus.failed} failed`}
        />
        <StatCard
          label="Running now"
          tone="text-st-running"
          value={m.byStatus.running}
          sub="live"
        />
        <StatCard
          label="Tokens"
          value={fmtTok(m.tokens.total)}
          sub={`${fmtTok(m.tokens.input)} in · ${fmtTok(m.tokens.output)} out`}
        />
        <StatCard
          label="Latency p50"
          value={m.durations ? fmtMs(m.durations.p50) : "—"}
          sub={
            m.durations
              ? `p90 ${fmtMs(m.durations.p90)} · p99 ${fmtMs(m.durations.p99)}`
              : undefined
          }
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
