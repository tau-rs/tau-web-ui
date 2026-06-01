import { useEffect, useState } from "react";
import type { Target } from "../types/Target";
import type { Bundle } from "../types/Bundle";
import type { BuildStep } from "../types/BuildStep";
import { listTargets, listBundles, build } from "../api/ship";

function humanSize(bytes: number | bigint): string {
  // ts-rs exports the Rust `u64` `size_bytes` as `bigint`; coerce to number.
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function shortHash(hash: string): string {
  const hex = hash.includes(":") ? hash.split(":")[1] : hash;
  return hex.slice(0, 8);
}

export function ShipPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [target, setTarget] = useState("");
  const [building, setBuilding] = useState(false);
  const [lastBuild, setLastBuild] = useState<Bundle | null>(null);

  useEffect(() => {
    listTargets()
      .then((t) => {
        setTargets(t);
        setTarget((cur) => cur || t.find((x) => x.status === "ready")?.name || "");
      })
      .catch(() => {});
    listBundles().then(setBundles).catch(() => {});
  }, []);

  async function onBuild() {
    if (!target) return;
    setBuilding(true);
    try {
      const b = await build(target);
      setLastBuild(b);
      setBundles((prev) => [b, ...prev]);
    } catch {
      // mock surface — ignore
    } finally {
      setBuilding(false);
    }
  }

  const ready = targets.filter((t) => t.status === "ready");

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-base font-semibold">Ship / Targets &amp; Build</h2>

      <section className="space-y-1.5">
        <div className="text-[9px] uppercase text-muted">targets</div>
        <div className="flex flex-wrap gap-2">
          {targets.map((t) => (
            <TargetCard key={t.name} target={t} />
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="text-[9px] uppercase text-muted">build</div>
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="build-target" className="text-muted">
            target
          </label>
          <select
            id="build-target"
            aria-label="build target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
            {ready.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={onBuild}
            disabled={building || !target}
            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg disabled:opacity-50"
          >
            {building ? "building…" : "Build"}
          </button>
        </div>
        {lastBuild && <StepTimeline steps={lastBuild.steps} />}
      </section>

      <section className="space-y-1.5">
        <div className="text-[9px] uppercase text-muted">bundles</div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">artifact</th>
              <th className="px-2 py-1 font-medium">target</th>
              <th className="px-2 py-1 font-medium">size</th>
              <th className="px-2 py-1 font-medium">hash</th>
              <th className="px-2 py-1 font-medium">drift</th>
              <th className="px-2 py-1 font-medium">built</th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((b, i) => (
              <tr key={`${b.hash}-${i}`} className="border-b border-border/60">
                <td className="py-1 pr-2 font-mono font-medium text-accent">{b.artifact}</td>
                <td className="px-2 py-1 text-muted">{b.target}</td>
                <td className="px-2 py-1 text-muted">{humanSize(b.size_bytes)}</td>
                <td className="px-2 py-1 font-mono text-muted">{shortHash(b.hash)}</td>
                <td className="px-2 py-1">
                  <DriftBadge drift={b.drift} />
                </td>
                <td className="px-2 py-1 text-muted">{b.built_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function TargetCard({ target }: { target: Target }) {
  const gated = target.status !== "ready";
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        gated ? "border-border opacity-60" : "border-st-ok/40 bg-st-ok-soft/40"
      }`}
    >
      <div className="font-semibold text-accent">{target.name}</div>
      <div className="mt-0.5 text-[10px] text-muted">
        {target.substrate}
        {" · "}
        {gated ? (
          <span className="rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">
            {target.gate}
          </span>
        ) : (
          <span className="rounded bg-st-ok-soft px-1 text-[9px] font-medium text-st-ok">ready</span>
        )}
      </div>
    </div>
  );
}

function DriftBadge({ drift }: { drift: string }) {
  const tone = drift === "clean" ? "bg-st-ok-soft text-st-ok" : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{drift}</span>
  );
}

function StepTimeline({ steps }: { steps: BuildStep[] }) {
  const dot = (status: string) =>
    status === "ok" ? "bg-st-ok" : status === "running" ? "bg-st-running" : "bg-st-error";
  return (
    <div className="mt-1 space-y-0.5">
      {steps.map((s, i) => (
        <div key={`${i}-${s.name}`} className="flex items-center gap-2 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${dot(s.status)}`} />
          <span>{s.name}</span>
          <span className="ml-auto text-[10px] text-muted">{s.duration_ms}ms</span>
        </div>
      ))}
    </div>
  );
}
