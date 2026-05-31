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
  byKind: { workflow: number; agent: number };
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
  const byKind = { workflow: 0, agent: 0 };
  const tokens = { input: 0, output: 0, total: 0 };
  const durs: number[] = [];
  for (const r of runs) {
    byStatus[r.status] += 1;
    if (r.source === "log") byKind.workflow += 1;
    else byKind.agent += 1;
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

  return {
    total: runs.length,
    byStatus,
    byKind,
    successRate,
    tokens,
    durations,
    overTime,
    byAgent,
    topErrors,
  };
}
