import type { Capability } from "../types/Capability";

const CAP_FIELDS: Record<string, string[]> = {
  "fs.read": ["paths"],
  "fs.write": ["paths"],
  "net.http": ["hosts", "methods"],
  "process.spawn": ["commands"],
};
const KINDS = Object.keys(CAP_FIELDS);

const input = "rounded border border-border bg-surface px-2 py-1 text-xs";

export function CapabilitiesEditor({
  capabilities,
  onChange,
}: {
  capabilities: Capability[];
  onChange: (c: Capability[]) => void;
}) {
  const update = (i: number, patch: Partial<Capability>) =>
    onChange(capabilities.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  function setKind(i: number, kind: string) {
    const fields: Record<string, string[]> = {};
    for (const p of CAP_FIELDS[kind] ?? []) fields[p] = [];
    update(i, { kind, fields });
  }

  function setParam(i: number, param: string, csv: string) {
    const list = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const fields = { ...capabilities[i].fields, [param]: list };
    update(i, { fields });
  }

  return (
    <div className="space-y-2">
      {capabilities.map((c, i) => (
        <div key={i} className="rounded-md border border-border p-2">
          <div className="flex items-center gap-2">
            <select
              aria-label={`capability kind ${i}`}
              className={input}
              value={c.kind}
              onChange={(e) => setKind(i, e.target.value)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`remove capability ${i}`}
              className="ml-auto px-2 text-st-error"
              onClick={() => onChange(capabilities.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          </div>
          {(CAP_FIELDS[c.kind] ?? []).map((param) => (
            <div key={param} className="mt-1.5">
              <label className="mb-0.5 block text-[9px] uppercase text-muted">{param}</label>
              <input
                aria-label={`${param} ${i}`}
                placeholder={`${param} (comma-separated)`}
                className={`w-full ${input}`}
                value={(c.fields[param] ?? []).join(", ")}
                onChange={(e) => setParam(i, param, e.target.value)}
              />
            </div>
          ))}
        </div>
      ))}
      <button
        type="button"
        className="rounded border border-dashed border-accent/50 px-2 py-1 text-xs font-semibold text-accent"
        onClick={() => onChange([...capabilities, { kind: "fs.read", fields: { paths: [] } }])}
      >
        + Add capability
      </button>
    </div>
  );
}
