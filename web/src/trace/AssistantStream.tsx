import { useStore } from "../store/store";

export function AssistantStream() {
  const text = useStore((s) => s.assistantText);
  return (
    <div style={{ padding: 12, fontFamily: "ui-monospace, monospace", fontSize: 13,
      whiteSpace: "pre-wrap", borderTop: "1px solid #eee", maxHeight: 180, overflow: "auto" }}>
      {text || <span style={{ color: "#aaa" }}>No assistant output yet…</span>}
    </div>
  );
}
