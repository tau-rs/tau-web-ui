import type { RequiredToolSpec } from "../types/RequiredToolSpec";

export function RequiresToolsEditor({
  tools,
  onChange,
}: {
  tools: RequiredToolSpec[];
  onChange: (t: RequiredToolSpec[]) => void;
}) {
  const input = "rounded border border-border bg-surface px-2 py-1 text-xs";
  const update = (i: number, patch: Partial<RequiredToolSpec>) =>
    onChange(tools.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-1.5">
      {tools.map((t, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            aria-label={`tool name ${i}`}
            placeholder="name"
            className={`flex-1 ${input}`}
            value={t.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            aria-label={`tool source ${i}`}
            placeholder="source"
            className={`flex-[2] ${input}`}
            value={t.source}
            onChange={(e) => update(i, { source: e.target.value })}
          />
          <input
            aria-label={`tool version ${i}`}
            placeholder="version"
            className={`w-20 ${input}`}
            value={t.version ?? ""}
            onChange={(e) => update(i, { version: e.target.value || null })}
          />
          <button
            type="button"
            aria-label={`remove tool ${i}`}
            className="px-2 text-st-error"
            onClick={() => onChange(tools.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="rounded border border-dashed border-accent/50 px-2 py-1 text-xs font-semibold text-accent"
        onClick={() => onChange([...tools, { name: "", source: "", version: null }])}
      >
        + Add tool
      </button>
    </div>
  );
}
