import { NavLink } from "react-router-dom";
import { useStore } from "../store/store";

interface Item {
  to: string;
  label: string;
  icon: string;
  gated?: boolean;
}
const GROUPS: { title: string | null; items: Item[] }[] = [
  { title: null, items: [{ to: "dashboard", label: "Dashboard", icon: "▦" }] },
  {
    title: "Build",
    items: [
      { to: "agents", label: "Agents", icon: "◆" },
      { to: "workflows", label: "Workflows", icon: "⛓", gated: true },
      { to: "tools", label: "Tools & Skills", icon: "⚒" },
      { to: "packages", label: "Packages", icon: "▣" },
      { to: "config", label: "Config & Caps", icon: "⚙", gated: true },
    ],
  },
  {
    title: "Operate",
    items: [
      { to: "runs", label: "Runs", icon: "≣" },
      { to: "ship", label: "Ship / Targets", icon: "⬡" },
      { to: "health", label: "Health", icon: "♥" },
    ],
  },
];

const ROW = "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs";

export function Sidebar() {
  const pid = useStore((s) => s.activeProjectId);
  const running = useStore((s) => s.runs.filter((r) => r.status === "running").length);
  const scoped = pid !== "";
  return (
    <aside className="flex w-[150px] flex-col gap-0.5 border-r border-border bg-surface px-2 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        <span className="h-4 w-4 rounded bg-accent" />
        <strong className="text-xs">tau-web-ui</strong>
      </div>

      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `${ROW} ${isActive ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"}`
        }
      >
        <span aria-hidden>▦</span>
        Projects
      </NavLink>

      {GROUPS.map((group, gi) => (
        <div key={group.title ?? `g${gi}`} className="mb-1">
          {group.title && (
            <div className="px-2 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-wider text-muted">
              {group.title}
            </div>
          )}
          {group.items.map((it) =>
            scoped ? (
              <NavLink
                key={it.to}
                to={`/projects/${pid}/${it.to}`}
                className={({ isActive }) =>
                  `${ROW} ${isActive ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"}`
                }
              >
                <span aria-hidden>{it.icon}</span>
                {it.label}
                {it.gated && (
                  <span className="ml-auto rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">
                    gated
                  </span>
                )}
                {it.to === "runs" && running > 0 && (
                  <span className="ml-auto rounded-full bg-st-running-soft px-1.5 text-[10px] font-semibold text-st-running">
                    {running}
                  </span>
                )}
              </NavLink>
            ) : (
              <div
                key={it.to}
                aria-disabled="true"
                title="Select a project first"
                className={`${ROW} cursor-not-allowed text-muted opacity-40`}
              >
                <span aria-hidden>{it.icon}</span>
                {it.label}
              </div>
            ),
          )}
        </div>
      ))}
    </aside>
  );
}
