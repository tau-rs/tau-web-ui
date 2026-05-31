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
