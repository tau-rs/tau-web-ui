export function ContextBar({ context }: { context?: { pct: number } | null }) {
  if (context == null) {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        title="Context-window usage — not yet reported by tau"
      >
        <span className="h-1.5 w-11 rounded-sm border border-dashed border-border" />
        <span className="rounded bg-amber-100 px-1 text-[9px] font-bold uppercase text-amber-800">
          WIP
        </span>
      </span>
    );
  }
  const pct = Math.round(context.pct * 100);
  return (
    <span className="inline-flex items-center gap-1.5" title={`${pct}% of context window`}>
      <span className="h-1.5 w-11 overflow-hidden rounded-sm bg-bg">
        <span className="block h-1.5 rounded-sm bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[10px] text-muted">{pct}%</span>
    </span>
  );
}
