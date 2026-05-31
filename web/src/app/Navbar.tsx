import { useLocation } from "react-router-dom";
import { useStore } from "../store/store";

function titleFor(pathname: string, agent?: string): string {
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/runs/")) return `Trace · ${agent ?? "…"}`;
  if (pathname.startsWith("/runs")) return "Runs";
  if (pathname.startsWith("/agents")) return "Agents";
  if (pathname.startsWith("/workflows")) return "Workflows";
  if (pathname.startsWith("/tools")) return "Tools & Skills";
  if (pathname.startsWith("/packages")) return "Packages";
  if (pathname.startsWith("/config")) return "Config & Capabilities";
  if (pathname.startsWith("/ship")) return "Ship / Targets";
  if (pathname.startsWith("/health")) return "Health";
  return "tau-web-ui";
}

export function Navbar() {
  const project = useStore((s) => s.project);
  const agent = useStore((s) => s.currentTrace?.run.agent_id);
  const { pathname } = useLocation();

  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
      <strong className="text-sm">{titleFor(pathname, agent)}</strong>
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
