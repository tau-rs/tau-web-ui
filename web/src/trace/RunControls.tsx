import { useStore } from "../store/store";
import { useProjectId } from "../app/project-context";
import { StatusBadge } from "../runs/badges";
import { formatTokens, formatDuration, formatTokenSplit } from "../runs/run-utils";
import { ContextBar } from "../dashboard/ContextBar";

export function RunControls() {
  const trace = useStore((s) => s.currentTrace);
  const cancel = useStore((s) => s.cancelCurrent);
  const pid = useProjectId();
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
          onClick={() => cancel(pid)}
          className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs hover:bg-bg"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
