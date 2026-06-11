import { useCallback, useEffect, useState } from "react";
import type { CheckReport } from "../types/CheckReport";
import type { CategoryStatus } from "../types/CategoryStatus";
import { getChecks } from "../api/checks";
import { useStore } from "../store/store";
import { useProjectId } from "../app/project-context";

const SEV_CLASS: Record<string, string> = {
  error: "bg-st-error-soft text-st-error",
  "needs-setup": "bg-amber-100 text-amber-800",
  warning: "bg-st-running-soft text-st-running",
  pass: "bg-st-ok-soft text-st-ok",
  note: "bg-st-cancelled-soft text-st-cancelled",
};
// A severity we don't recognize must never borrow a benign tone on a triage
// surface — a typo or a newly-added backend value (e.g. "critical") would
// otherwise silently downgrade to the benign "warning" style. Escalate the
// unknown to the error tone and mark it so it can't masquerade as known.
const SEV_UNKNOWN = "bg-st-error-soft text-st-error";

function SeverityBadge({ severity, label }: { severity: string; label?: string }) {
  const known = Object.prototype.hasOwnProperty.call(SEV_CLASS, severity);
  const cls = known ? SEV_CLASS[severity] : SEV_UNKNOWN;
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
      title={known ? undefined : `unrecognized severity: ${severity}`}
    >
      {label ?? severity}
    </span>
  );
}

function worst(c: CategoryStatus): "error" | "needs-setup" | "warning" | "pass" {
  if (c.errors > 0) return "error";
  if (c.needs_setup > 0) return "needs-setup";
  if (c.warnings > 0) return "warning";
  return "pass";
}

export function HealthPage() {
  const pid = useProjectId();
  const health = useStore((s) => s.health);
  const loadHealth = useStore((s) => s.loadHealth);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const load = useCallback(() => {
    getChecks(pid)
      .then(setReport)
      .catch(() => {});
  }, [pid]);
  // Re-run refreshes both the checks report and the connectivity strip it sits in.
  function rerun() {
    load();
    loadHealth(pid).catch(() => {});
  }
  useEffect(() => {
    load();
  }, [load]);

  const findings = report?.findings ?? [];
  const shown = filter ? findings.filter((f) => f.category === filter) : findings;

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-base font-semibold">Health / Checks</h2>

      {/* connectivity */}
      <div className="flex items-center gap-4 rounded-md border border-border bg-surface px-3 py-1.5 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${health?.gateway_ok ? "bg-st-ok" : "bg-st-error"}`}
          />
          gateway {health?.gateway_ok ? "ok" : "down"}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${health?.engine_ok ? "bg-st-ok" : "bg-st-error"}`}
          />
          engine {health?.engine_ok ? "ok" : "down"}
        </span>
        <span className="font-mono text-muted">tau {health?.tau_version || "—"}</span>
        <button
          onClick={rerun}
          className="ml-auto rounded-md border border-border px-2 py-0.5 text-xs font-semibold"
        >
          Re-run
        </button>
      </div>

      {/* checks */}
      <section className="space-y-2">
        <div className="text-[9px] uppercase text-muted">checks</div>
        <div className="flex flex-wrap gap-2">
          {(report?.categories ?? []).map((c) => {
            const w = worst(c);
            const total = c.errors + c.warnings + c.needs_setup;
            const active = filter === c.name;
            return (
              <button
                key={c.name}
                aria-pressed={active}
                onClick={() => setFilter(active ? null : c.name)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                  active ? "border-accent" : "border-border"
                }`}
              >
                <SeverityBadge severity={w} label={w === "pass" ? "✓" : String(total)} />
                <span className="font-medium">{c.name}</span>
              </button>
            );
          })}
        </div>

        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">severity</th>
              <th className="px-2 py-1 font-medium">rule</th>
              <th className="px-2 py-1 font-medium">summary</th>
              <th className="px-2 py-1 font-medium">location</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f, i) => (
              <tr key={`${f.rule}-${i}`} className="border-b border-border/60 align-top">
                <td className="py-1 pr-2">
                  <SeverityBadge severity={f.severity} />
                </td>
                <td className="px-2 py-1 font-mono text-accent">{f.rule}</td>
                <td className="px-2 py-1">
                  {f.summary}
                  {f.remediation && <div className="text-[10px] text-muted">↳ {f.remediation}</div>}
                </td>
                <td className="px-2 py-1 font-mono text-muted">
                  {f.location
                    ? `${f.location.path}${f.location.line ? `:${f.location.line}` : ""}`
                    : "—"}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-2 text-muted">
                  No findings.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* sandbox */}
      <section className="space-y-1">
        <div className="text-[9px] uppercase text-muted">sandbox</div>
        <div className="text-xs">
          tier <span className="font-mono">{report?.sandbox.tier ?? "—"}</span>
          {" · "}
          <SeverityBadge
            severity={report?.sandbox.status === "ready" ? "pass" : "note"}
            label={report?.sandbox.status ?? "—"}
          />
          {report?.sandbox.no_sandbox && (
            <span className="ml-2 text-amber-800">⚠ running with --no-sandbox</span>
          )}
        </div>
      </section>

      {/* conformance (gated) */}
      <section className="space-y-1">
        <div className="flex items-center gap-2 text-[9px] uppercase text-muted">
          conformance
          <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">
            gated
          </span>
        </div>
        <div className="rounded-md border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Cross-target conformance — waits on tau β.6.
        </div>
      </section>
    </div>
  );
}
