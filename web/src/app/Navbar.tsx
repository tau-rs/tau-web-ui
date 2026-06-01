import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useStore } from "../store/store";

function subRoute(pathname: string, pid: string): string {
  const prefix = `/projects/${pid}/`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "runs";
}

export function Navbar() {
  const { pid } = useParams();
  const projects = useStore((s) => s.projects);
  const project = useStore((s) => s.project);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const activeName = projects.find((p) => p.meta.id === pid)?.meta.name ?? pid ?? "project";

  function switchTo(nextPid: string) {
    setOpen(false);
    navigate(`/projects/${nextPid}/${subRoute(pathname, pid ?? "")}`);
  }

  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
      <div className="relative">
        <button
          aria-label="project switcher"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-semibold"
        >
          <span aria-hidden>▦</span>
          {activeName}
          <span aria-hidden>▾</span>
        </button>
        {open && (
          <div className="absolute left-0 z-10 mt-1 w-44 rounded-md border border-border bg-surface p-1 shadow-lg">
            {projects.map((p) => (
              <button
                key={p.meta.id}
                onClick={() => switchTo(p.meta.id)}
                className={`block w-full rounded px-2 py-1 text-left text-xs ${
                  p.meta.id === pid
                    ? "bg-accent/10 font-semibold text-accent"
                    : "text-muted hover:text-fg"
                }`}
              >
                {p.meta.name}
              </button>
            ))}
            <Link
              to="/"
              onClick={() => setOpen(false)}
              className="mt-1 block border-t border-border px-2 pt-1.5 text-xs text-muted hover:text-fg"
            >
              Manage projects…
            </Link>
          </div>
        )}
      </div>
      <span className="ml-auto font-mono text-xs text-muted">
        {project?.project_path ?? "connecting…"}
      </span>
      <span
        title={project ? "engine reachable" : "no engine"}
        className={`h-2.5 w-2.5 rounded-full ${project ? "bg-st-ok" : "bg-st-error"}`}
      />
      <span className="text-xs text-muted">tau {project?.tau_version ?? "—"}</span>
    </header>
  );
}
