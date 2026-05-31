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
