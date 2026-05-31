import type { Run } from "../types/Run";

const STATUS_COLORS: Record<string, string> = {
  running: "#2563eb",
  completed: "#16a34a",
  failed: "#dc2626",
  cancelled: "#a16207",
};

export function StatusBadge({ status }: { status: Run["status"] }) {
  return (
    <span
      style={{
        background: STATUS_COLORS[status] ?? "#666",
        color: "white",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 12,
      }}
    >
      {status}
    </span>
  );
}

export function SubstrateModeBadge({
  substrate,
  mode,
}: {
  substrate: Run["substrate"];
  mode: Run["mode"];
}) {
  return (
    <span
      style={{
        border: "1px solid #ccc",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 12,
        color: "#555",
      }}
    >
      {substrate} · {mode}
    </span>
  );
}
