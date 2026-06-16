import { useAsync } from "../app/useAsync";
import { getRunChecks } from "../api/postconditions";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function ChecksGlanceCard({ pid, runId }: { pid: string; runId: string }) {
  const state = useAsync(() => getRunChecks(pid, runId), [pid, runId]);
  if (state.status === "loading")
    return <div className="h-16 animate-pulse rounded-lg bg-surface" />;
  if (state.status !== "data") return null;
  const results = state.data.results;
  const count = (kind: "goal" | "deliverable", met: boolean) =>
    results.filter((r) => r.kind === kind && (r.final === "met") === met).length;
  const retries = results.reduce((n, r) => n + Math.max(0, r.attempts.length - 1), 0);
  const goalsMet = count("goal", true);
  const delivMet = count("deliverable", true);
  const anyFailed = results.some((r) => r.final !== "met");
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 text-xs font-semibold text-muted">Checks · last run</div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-st-ok-soft px-2 py-0.5 font-semibold text-st-ok">
          {plural(goalsMet, "goal")} met
        </span>
        <span className="rounded-full bg-st-ok-soft px-2 py-0.5 font-semibold text-st-ok">
          {plural(delivMet, "deliverable")} met
        </span>
        {retries > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
            {plural(retries, "retry").replace("retrys", "retries")}
          </span>
        )}
        {anyFailed && (
          <span className="rounded-full bg-st-error-soft px-2 py-0.5 font-semibold text-st-error">
            attention
          </span>
        )}
      </div>
    </div>
  );
}
