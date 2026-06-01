import type { PackageDep } from "../types/PackageDep";

const input = "rounded border border-border bg-surface px-2 py-1 text-xs";

export function PackageDepEditor({
  label,
  deps,
  onChange,
}: {
  label: string;
  deps: PackageDep[];
  onChange: (d: PackageDep[]) => void;
}) {
  const update = (i: number, patch: Partial<PackageDep>) =>
    onChange(deps.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  return (
    <div className="space-y-1.5">
      {deps.map((d, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            aria-label={`${label} name ${i}`}
            placeholder="name"
            className={`flex-1 ${input}`}
            value={d.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <input
            aria-label={`${label} source ${i}`}
            placeholder="source"
            className={`flex-[2] ${input}`}
            value={d.source}
            onChange={(e) => update(i, { source: e.target.value })}
          />
          <input
            aria-label={`${label} version ${i}`}
            placeholder="version"
            className={`w-20 ${input}`}
            value={d.version ?? ""}
            onChange={(e) => update(i, { version: e.target.value || null })}
          />
          <button
            type="button"
            aria-label={`remove ${label} ${i}`}
            className="px-2 text-st-error"
            onClick={() => onChange(deps.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="rounded border border-dashed border-accent/50 px-2 py-1 text-xs font-semibold text-accent"
        onClick={() => onChange([...deps, { name: "", source: "", version: null }])}
      >
        + Add {label}
      </button>
    </div>
  );
}
