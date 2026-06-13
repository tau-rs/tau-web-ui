import { useMemo, useState } from "react";
import { ALL_LEVELS, DEFAULT_FILTERS } from "./types";
import type { LogEntry, LogFilterState, LogLevel, LogStreamProps } from "./types";

// There is no dedicated "warn" status token in the design system; warn reuses the
// cancelled (amber) token, which reads as a warning. See web/src/index.css.
const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-muted",
  info: "text-fg",
  warn: "text-st-cancelled",
  error: "text-st-error",
};

function matches(e: LogEntry, f: LogFilterState): boolean {
  if (!f.levels.includes(e.level)) return false;
  if (f.kinds.length > 0 && !f.kinds.includes(e.kind)) return false;
  if (f.query) {
    const hay = `${e.label} ${JSON.stringify(e.detail ?? "")}`.toLowerCase();
    if (!hay.includes(f.query.toLowerCase())) return false;
  }
  return true;
}

export function LogStream({ entries, filters, onFiltersChange, onEntryClick }: LogStreamProps) {
  // Uncontrolled fallback when the host doesn't own filter state.
  const [internal, setInternal] = useState<LogFilterState>(DEFAULT_FILTERS);

  // Controlled-mode footgun: a host that passes `filters` but no `onFiltersChange`
  // would render an inert filter UI. Warn in dev so it surfaces early.
  if (import.meta.env.DEV && filters !== undefined && !onFiltersChange) {
    console.warn(
      "LogStream: `filters` provided without `onFiltersChange`; filter UI will be inert.",
    );
  }

  const f = filters ?? internal;
  const setF = (next: LogFilterState) =>
    onFiltersChange ? onFiltersChange(next) : setInternal(next);

  const toggleLevel = (lvl: LogLevel) =>
    setF({
      ...f,
      levels: f.levels.includes(lvl) ? f.levels.filter((l) => l !== lvl) : [...f.levels, lvl],
    });

  const shown = useMemo(() => entries.filter((e) => matches(e, f)), [entries, f]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {ALL_LEVELS.map((lvl) => (
          <button
            key={lvl}
            aria-pressed={f.levels.includes(lvl)}
            onClick={() => toggleLevel(lvl)}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              f.levels.includes(lvl)
                ? "bg-accent text-accent-fg"
                : "border border-border text-muted"
            }`}
          >
            {lvl}
          </button>
        ))}
        <input
          className="ml-auto rounded-md border border-border bg-surface px-2 py-1 text-xs"
          placeholder="Search logs…"
          value={f.query}
          onChange={(e) => setF({ ...f, query: e.target.value })}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-xs">
        {shown.length === 0 ? (
          <p className="p-4 text-muted">
            {entries.length === 0 ? "No log entries." : "No entries match the current filters."}
          </p>
        ) : (
          <ul>
            {shown.map((e) => (
              <li
                key={e.id}
                role={onEntryClick ? "button" : undefined}
                tabIndex={onEntryClick ? 0 : undefined}
                onClick={() => onEntryClick?.(e)}
                onKeyDown={(ev) => {
                  if (onEntryClick && (ev.key === "Enter" || ev.key === " ")) {
                    ev.preventDefault();
                    onEntryClick(e);
                  }
                }}
                className="flex cursor-pointer gap-3 border-b border-border px-3 py-1.5 hover:bg-bg"
              >
                <span className="shrink-0 text-muted">{e.ts}</span>
                <span className={`shrink-0 uppercase ${LEVEL_CLASS[e.level]}`}>{e.level}</span>
                <span className="truncate">{e.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
