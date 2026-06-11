import { useMemo, useState } from "react";
import type { Span } from "../types/Span";
import { spansToTimeline } from "./timeline";
import { useStore } from "../store/store";

const BAR: Record<string, string> = {
  running: "bg-st-running",
  ok: "bg-st-ok",
  error: "bg-st-error",
};

export function TraceTimeline({ spans }: { spans: Span[] }) {
  const select = useStore((s) => s.selectSpan);
  const selectedId = useStore((s) => s.selectedSpanId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => spansToTimeline(spans), [spans]);

  const parentOf = useMemo(() => {
    const m = new Map<string, string | null>();
    rows.forEach((r) => m.set(r.span.id, r.resolvedParent));
    return m;
  }, [rows]);

  const hidden = (id: string) => {
    let p = parentOf.get(id) ?? null;
    while (p) {
      if (collapsed.has(p)) return true;
      p = parentOf.get(p) ?? null;
    }
    return false;
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  return (
    <div className="h-full overflow-auto text-xs">
      <div className="flex border-b border-border px-3 py-1.5 text-muted">
        <span className="w-40">span</span>
        <span className="flex-1">timeline</span>
      </div>
      {rows
        .filter((r) => !hidden(r.span.id))
        .map((r) => (
          // The expand/collapse <button> nested below is a focusable descendant
          // of this role="button" row; it keeps its own keyboard handling and
          // stopPropagation, so the two activations don't collide.
          <div
            key={r.span.id}
            role="button"
            tabIndex={0}
            aria-label={`Select span ${r.span.name}`}
            onClick={() => select(r.span.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                select(r.span.id);
              }
            }}
            className={`flex cursor-pointer items-center border-b border-border/60 px-3 py-1.5 hover:bg-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
              selectedId === r.span.id ? "bg-accent/10" : ""
            }`}
          >
            <span
              className="flex w-40 items-center gap-1.5"
              style={{ paddingLeft: `${r.depth * 14}px` }}
            >
              {r.hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(r.span.id);
                  }}
                  className="text-muted"
                  aria-label={collapsed.has(r.span.id) ? "expand" : "collapse"}
                >
                  {collapsed.has(r.span.id) ? "▸" : "▾"}
                </button>
              ) : (
                <span className="w-[10px]" />
              )}
              <span className={`h-1.5 w-1.5 rounded-full ${BAR[r.span.status] ?? "bg-muted"}`} />
              <span className="truncate font-medium">{r.span.name}</span>
            </span>
            <span className="relative h-2 flex-1">
              <span
                className={`absolute top-0 h-1.5 rounded-sm ${BAR[r.span.status] ?? "bg-muted"} ${
                  r.span.status === "running" ? "opacity-70" : ""
                }`}
                style={{ left: `${r.offsetPct}%`, width: `${r.widthPct}%` }}
              />
            </span>
          </div>
        ))}
    </div>
  );
}
