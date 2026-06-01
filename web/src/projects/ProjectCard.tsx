import { useNavigate } from "react-router-dom";
import type { ProjectListItem } from "../types/ProjectListItem";

const fmtTok = (n: bigint | number) => {
  const v = Number(n);
  return v >= 1_000_000
    ? `${(v / 1e6).toFixed(1)}M`
    : v >= 1000
      ? `${(v / 1000).toFixed(1)}k`
      : `${v}`;
};

function dotColor(item: ProjectListItem): string {
  if (!item.summary.engine_ok) return "bg-st-error";
  if (item.summary.running > 0) return "bg-st-running";
  return "bg-st-ok";
}

export function ProjectCard({ item }: { item: ProjectListItem }) {
  const navigate = useNavigate();
  const s = item.summary;
  return (
    <button
      onClick={() => navigate(`/projects/${item.meta.id}/dashboard`)}
      className="rounded-lg border border-border bg-surface p-3 text-left hover:border-accent"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor(item)}`} />
        <strong className="text-sm">{item.meta.name}</strong>
        <span className="ml-auto font-mono text-[10px] text-muted">{item.meta.path}</span>
      </div>
      <div className="flex gap-4 text-xs">
        <span>
          <b>{s.runs}</b> runs
        </span>
        <span className={s.failed_24h > 0 ? "text-st-error" : ""}>
          <b>{s.failed_24h}</b> failed
        </span>
        <span className="text-st-ok">
          <b>{Math.round(s.success_rate * 100)}%</b>
        </span>
        <span>
          <b>{fmtTok(s.tokens)}</b> tok
        </span>
      </div>
      <div className="mt-1.5 text-[10px] text-muted">
        {s.agents} agents · {s.running} running
        {!s.engine_ok && " · engine down"}
      </div>
    </button>
  );
}
