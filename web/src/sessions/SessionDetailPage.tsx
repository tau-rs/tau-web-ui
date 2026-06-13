import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { SessionDetail } from "../types/SessionDetail";
import { getSession, exportUrl, type ExportFmt } from "../api/sessions";
import { useProjectId } from "../app/project-context";
import { SessionTranscript } from "./SessionTranscript";

export function SessionDetailPage() {
  const pid = useProjectId();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fmt, setFmt] = useState<ExportFmt>("jsonl");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getSession(pid, id)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDetail(null);
          setError(String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pid, id]);

  if (error) return <div className="p-4 text-sm text-st-error">{error}</div>;
  if (!detail) return <div className="p-4 text-sm text-muted">Loading…</div>;

  const h = detail.header;
  const tin = detail.turn_summaries.reduce((s, t) => s + Number(t.input_tokens ?? 0), 0);
  const tout = detail.turn_summaries.reduce((s, t) => s + Number(t.output_tokens ?? 0), 0);
  const tile = "flex-1 rounded-lg border border-border bg-surface px-3 py-2";

  return (
    <div className="space-y-4 p-4">
      <div className="text-[11px] text-muted">
        <span className="text-accent">Sessions</span> / {h.id.slice(0, 8)}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-2.5">
        <strong className="font-mono text-[15px]">{h.id.slice(0, 8)}</strong>
        <span className="text-xs">
          agent <b>{h.agent_id}</b>
        </span>
        <span className="text-[11px] text-muted">
          {h.llm_backend} · {h.package.name}@{h.package.version}
        </span>
        <span className="text-[11px] text-muted">{h.created_at}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px]">
          <span className="text-muted">Export</span>
          <select
            aria-label="export format"
            className="rounded-md border border-border bg-surface px-2 py-1"
            value={fmt}
            onChange={(e) => setFmt(e.target.value as ExportFmt)}
          >
            <option value="jsonl">jsonl</option>
            <option value="md">md</option>
            <option value="json">json</option>
          </select>
          <a
            className="rounded-md bg-accent px-3 py-1 font-semibold text-accent-fg"
            href={exportUrl(pid, h.id, fmt)}
          >
            Download
          </a>
        </span>
      </div>

      <div className="flex gap-2">
        <div className={tile}>
          <div className="text-[9px] uppercase tracking-wide text-muted">turns</div>
          <b className="text-base">{detail.turn_summaries.length}</b>
        </div>
        <div className={tile}>
          <div className="text-[9px] uppercase tracking-wide text-muted">input tokens</div>
          <b className="text-base">{tin.toLocaleString()}</b>
        </div>
        <div className={tile}>
          <div className="text-[9px] uppercase tracking-wide text-muted">output tokens</div>
          <b className="text-base">{tout.toLocaleString()}</b>
        </div>
      </div>

      <SessionTranscript detail={detail} />
    </div>
  );
}
