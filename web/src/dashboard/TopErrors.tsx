import type { Metrics } from "./metrics";

export function TopErrors({ errors }: { errors: Metrics["topErrors"] }) {
  if (errors.length === 0) return <p className="text-xs text-muted">No failures.</p>;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-border text-left text-muted">
          <th className="py-1 font-medium">reason</th>
          <th className="py-1 text-right font-medium">count</th>
        </tr>
      </thead>
      <tbody>
        {errors.map((e) => (
          <tr key={e.reason} className="border-b border-border/60 last:border-0">
            <td className="py-1 font-mono">{e.reason}</td>
            <td className="py-1 text-right">{e.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
