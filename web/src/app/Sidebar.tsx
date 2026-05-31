import { NavLink } from "react-router-dom";

const ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: "▦" },
  { to: "/runs", label: "Runs", icon: "≣" },
  { to: "/health", label: "Health", icon: "♥" },
];

export function Sidebar() {
  return (
    <aside className="flex w-[150px] flex-col gap-1 border-r border-border bg-surface px-2 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        <span className="h-4 w-4 rounded bg-accent" />
        <strong className="text-xs">tau-web-ui</strong>
      </div>
      {ITEMS.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
              isActive ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"
            }`
          }
        >
          <span aria-hidden>{it.icon}</span>
          {it.label}
        </NavLink>
      ))}
    </aside>
  );
}
