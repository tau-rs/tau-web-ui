import { useStore } from "../store/store";
import { TraceGraph } from "./TraceGraph";
import { AssistantStream } from "./AssistantStream";
import { SpanInspector } from "./SpanInspector";
import { RunControls } from "./RunControls";

export function TraceView() {
  const trace = useStore((s) => s.currentTrace);
  const selectedId = useStore((s) => s.selectedSpanId);
  const close = useStore((s) => s.closeTrace);

  if (!trace) {
    return (
      <section style={{ padding: 16, color: "#888" }}>Select a run to view its trace.</section>
    );
  }
  const selected = trace.spans.find((s) => s.id === selectedId) ?? null;

  return (
    <section style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px" }}>
        <strong style={{ fontSize: 14 }}>Trace · {trace.run.agent_id}</strong>
        <button onClick={close}>← Back to runs</button>
      </div>
      <RunControls />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 2, borderRight: "1px solid #eee", minWidth: 0 }}>
          <TraceGraph spans={trace.spans} />
        </div>
        <div style={{ flex: 1, minWidth: 280, overflow: "auto" }}>
          <SpanInspector span={selected} />
        </div>
      </div>
      <AssistantStream />
    </section>
  );
}
