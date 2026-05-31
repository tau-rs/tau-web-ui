import type { Metrics } from "./metrics";

const ROWS: { key: keyof Metrics["byStatus"]; color: string }[] = [
  { key: "completed", color: "bg-st-ok" },
  { key: "running", color: "bg-st-running" },
  { key: "failed", color: "bg-st-error" },
  { key: "cancelled", color: "bg-st-cancelled" },
];

export function StatusBars({ byStatus, total }: { byStatus: Metrics["byStatus"]; total: number }) {
  return (
    <div>
      {ROWS.map((r) => {
        const n = byStatus[r.key];
        const pct = total > 0 ? (n / total) * 100 : 0;
        return (
          <div key={r.key} className="mb-1.5 flex items-center gap-2 text-xs">
            <span className="w-20 text-muted">{r.key}</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-bg">
              <span className={`block h-2 rounded ${r.color}`} style={{ width: `${pct}%` }} />
            </span>
            <span className="w-8 text-right text-muted">{n}</span>
          </div>
        );
      })}
    </div>
  );
}
