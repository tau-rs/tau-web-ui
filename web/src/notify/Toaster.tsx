import { useNotifications } from "./notify";

const KIND_CLASS: Record<string, string> = {
  error: "border-st-error bg-st-error-soft text-st-error",
  success: "border-st-ok bg-st-ok-soft text-st-ok",
  info: "border-border bg-surface",
};

export function Toaster() {
  const items = useNotifications((s) => s.items);
  const dismiss = useNotifications((s) => s.dismiss);
  if (items.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {items.map((n) => (
        <div
          key={n.id}
          role="alert"
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs shadow ${
            KIND_CLASS[n.kind] ?? KIND_CLASS.info
          }`}
        >
          <span className="flex-1">{n.message}</span>
          <button
            aria-label="dismiss notification"
            onClick={() => dismiss(n.id)}
            className="font-semibold opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
