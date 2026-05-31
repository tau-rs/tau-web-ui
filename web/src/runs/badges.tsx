import type { Run } from "../types/Run";

const STATUS_COLORS: Record<string, string> = {
  running: "#2563eb", completed: "#16a34a", failed: "#dc2626", cancelled: "#a16207",
};

export function StatusBadge({ status }: { status: Run["status"] }) {
  return (
    <span style={{ background: STATUS_COLORS[status] ?? "#666", color: "white",
      padding: "2px 8px", borderRadius: 6, fontSize: 12 }}>
      {status}
    </span>
  );
}

export function SubstrateModeBadge({ substrate, mode }: { substrate: Run["substrate"]; mode: Run["mode"] }) {
  return (
    <span style={{ border: "1px solid #ccc", padding: "2px 8px", borderRadius: 6,
      fontSize: 12, color: "#555" }}>
      {substrate} · {mode}
    </span>
  );
}

export function formatTokens(run: Run): string {
  const t = run.token_usage;
  return t ? `${t.total_tokens ?? t.input_tokens + t.output_tokens} tok` : "—";
}

export function formatDuration(run: Run): string {
  if (!run.ended_at) return run.status === "running" ? "…" : "—";
  const ms = Date.parse(run.ended_at) - Date.parse(run.started_at);
  return `${(ms / 1000).toFixed(1)}s`;
}
