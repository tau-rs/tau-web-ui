import { useEffect, useState } from "react";
import type { Target } from "../types/Target";
import type { Bundle } from "../types/Bundle";
import type { VerifyOutcome } from "../types/VerifyOutcome";
import { listTargets, listBundles, build, verifyBundle } from "../api/ship";

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
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string, VerifyOutcome>>({});

  useEffect(() => {
    listTargets()
      .then((t) => {
        setTargets(t);
        setTarget((cur) => cur || t.find((x) => x.status === "available")?.triple || "");
      })
      .catch(() => {});
    listBundles()
      .then(setBundles)
      .catch(() => {});
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

  async function onVerify(path: string) {
    setVerifying(path);
    try {
      const v = await verifyBundle(path);
      setVerifyResult((p) => ({ ...p, [path]: v }));
    } catch {
      /* surface nothing on the mock */
    } finally {
      setVerifying(null);
    }
  }

  const ready = targets.filter((t) => t.status === "available");

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-base font-semibold">Ship / Targets &amp; Build</h2>

      <section className="space-y-1.5">
        <div className="text-[9px] uppercase text-muted">targets</div>
        <div className="flex flex-wrap gap-2">
          {targets.map((t) => (
            <TargetCard key={t.triple} target={t} />
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
              <option key={t.triple} value={t.triple}>
                {t.triple}
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
        {lastBuild && <div className="text-[10px] text-muted">built {lastBuild.path}</div>}
      </section>

      <section className="space-y-1.5">
        <div className="text-[9px] uppercase text-muted">bundles</div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">artifact</th>
              <th className="px-2 py-1 font-medium">hash</th>
              <th className="px-2 py-1 font-medium">size</th>
              <th className="px-2 py-1 font-medium">built</th>
              <th className="px-2 py-1 font-medium">verify</th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((b, i) => (
              <tr key={`${b.sha256}-${i}`} className="border-b border-border/60">
                <td className="py-1 pr-2 font-mono font-medium text-accent">{b.path}</td>
                <td className="px-2 py-1 font-mono text-muted">{shortHash(b.sha256)}</td>
                <td className="px-2 py-1 text-muted">{humanSize(b.size_bytes)}</td>
                <td className="px-2 py-1 text-muted">{b.built_at ?? "—"}</td>
                <td className="px-2 py-1">
                  {verifyResult[b.path] ? (
                    <span
                      className={verifyResult[b.path].reproducible ? "text-st-ok" : "text-st-error"}
                    >
                      {verifyResult[b.path].reproducible ? "✓ reproducible" : "✗ drift"}
                    </span>
                  ) : (
                    <button
                      onClick={() => onVerify(b.path)}
                      disabled={verifying === b.path}
                      className="rounded border border-border px-1.5 py-0.5 text-[10px] disabled:opacity-50"
                    >
                      {verifying === b.path ? "…" : "Verify"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function TargetCard({ target }: { target: Target }) {
  const reserved = target.status !== "available";
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        reserved ? "border-border opacity-60" : "border-st-ok/40 bg-st-ok-soft/40"
      }`}
    >
      <div className="font-mono font-semibold text-accent">{target.triple}</div>
      <div className="mt-0.5 text-[10px] text-muted">
        {target.tier} · {target.status}
      </div>
      {target.required_shapes.length > 0 && (
        <div className="mt-0.5 font-mono text-[9px] text-muted">
          {target.required_shapes.join(" ")}
        </div>
      )}
    </div>
  );
}
