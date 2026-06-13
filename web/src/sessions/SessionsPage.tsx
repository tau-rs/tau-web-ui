import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SessionSummary } from "../types/SessionSummary";
import { listSessions } from "../api/sessions";
import { useProjectId } from "../app/project-context";

const PAGE = 25;

export function SessionsPage() {
  const pid = useProjectId();
  const [all, setAll] = useState<SessionSummary[]>([]);
  const [agent, setAgent] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    listSessions(pid)
      .then(setAll)
      .catch(() => {});
  }, [pid]);

  const filtered = useMemo(
    () => (agent.trim() ? all.filter((s) => s.agent.includes(agent.trim())) : all),
    [all, agent],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const clamped = Math.min(page, pages - 1);
  const slice = filtered.slice(clamped * PAGE, clamped * PAGE + PAGE);

  function onFilter(v: string) {
    setAgent(v);
    setPage(0);
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Sessions</h2>
        <input
          aria-label="filter by agent"
          placeholder="filter by agent…"
          className="ml-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
          value={agent}
          onChange={(e) => onFilter(e.target.value)}
        />
        <span className="ml-auto text-xs text-muted">
          {filtered.length} session{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 pr-2 font-medium">id</th>
            <th className="px-2 py-1 font-medium">agent</th>
            <th className="px-2 py-1 font-medium">created</th>
            <th className="px-2 py-1 text-right font-medium">turns</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {slice.map((s) => (
            <tr key={s.id} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-2">
                <Link to={`/projects/${pid}/sessions/${s.id}`} className="text-accent">
                  {s.prefix}
                </Link>
              </td>
              <td className="px-2 py-1">{s.agent}</td>
              <td className="px-2 py-1 text-muted">{s.created_at}</td>
              <td className="px-2 py-1 text-right">{s.turns}</td>
            </tr>
          ))}
          {slice.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-center text-muted">
                no sessions
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <span className="mr-auto text-muted">
            page {clamped + 1} of {pages}
          </span>
          <button
            className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
            disabled={clamped === 0}
            onClick={() => setPage(clamped - 1)}
          >
            ‹ Prev
          </button>
          <button
            className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
            disabled={clamped >= pages - 1}
            onClick={() => setPage(clamped + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
