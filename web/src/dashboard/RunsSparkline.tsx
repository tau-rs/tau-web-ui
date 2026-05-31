import type { Metrics } from "./metrics";

export function RunsSparkline({ data }: { data: Metrics["overTime"] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex h-16 items-end gap-1">
      {data.map((d) => (
        <span
          key={d.bucketStart}
          title={`${new Date(d.bucketStart).toLocaleString()}: ${d.count}`}
          className="flex-1 rounded-t bg-accent/60"
          style={{ height: `${(d.count / max) * 100}%` }}
        />
      ))}
    </div>
  );
}
