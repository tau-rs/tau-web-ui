import type { Run } from "../types/Run";
import { StatusBadge, SubstrateModeBadge, TypeBadge } from "./badges";
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
            <th className="px-3 py-2 font-medium">Type</th>
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
                <td className="px-3 py-2">
                  <TypeBadge source={r.source} />
                </td>
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
                  <span className="ml-1 text-muted">
                    {r.token_usage ? `(${formatTokenSplit(r)})` : ""}
                  </span>
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
