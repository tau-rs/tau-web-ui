import { useStore } from "../store/store";
import { StatusBadge } from "../runs/badges";
import { formatTokens, formatDuration } from "../runs/run-utils";

export function RunControls() {
  const trace = useStore((s) => s.currentTrace);
  const cancel = useStore((s) => s.cancelCurrent);
  if (!trace) return null;
  const { run } = trace;
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        padding: 12,
        borderBottom: "1px solid #eee",
      }}
    >
      <StatusBadge status={run.status} />
      <span style={{ fontSize: 12, color: "#555" }}>turns: {run.total_turns ?? "—"}</span>
      <span style={{ fontSize: 12, color: "#555" }}>{formatTokens(run)}</span>
      <span style={{ fontSize: 12, color: "#555" }}>{formatDuration(run)}</span>
      {run.status === "running" && (
        <button onClick={() => cancel()} style={{ marginLeft: "auto" }}>
          Cancel
        </button>
      )}
    </div>
  );
}
