import type { Run } from "../types/Run";
import { StatusBadge, SubstrateModeBadge, formatTokens, formatDuration } from "./badges";

export function RunsTable({ runs, onOpen }: { runs: Run[]; onOpen: (id: string) => void }) {
  if (runs.length === 0) {
    return <p style={{ color: "#888" }}>No runs yet. Launch one above.</p>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd", fontSize: 13, color: "#666" }}>
          <th>Agent</th><th>Status</th><th>Substrate/Mode</th><th>Started</th><th>Duration</th><th>Tokens</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} onClick={() => onOpen(r.id)}
            style={{ cursor: "pointer", borderBottom: "1px solid #f0f0f0" }}>
            <td style={{ padding: "6px 4px" }}>{r.agent_id}</td>
            <td><StatusBadge status={r.status} /></td>
            <td><SubstrateModeBadge substrate={r.substrate} mode={r.mode} /></td>
            <td style={{ fontSize: 12, color: "#666" }}>{r.started_at.replace("T", " ").slice(0, 19)}</td>
            <td style={{ fontSize: 12 }}>{formatDuration(r)}</td>
            <td style={{ fontSize: 12 }}>{formatTokens(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
