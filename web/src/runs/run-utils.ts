import type { Run } from "../types/Run";

export function formatTokens(run: Run): string {
  const t = run.token_usage;
  return t ? `${t.total_tokens ?? t.input_tokens + t.output_tokens} tok` : "—";
}

export function formatDuration(run: Run): string {
  if (!run.ended_at) return run.status === "running" ? "…" : "—";
  const ms = Date.parse(run.ended_at) - Date.parse(run.started_at);
  return `${(ms / 1000).toFixed(1)}s`;
}
