import { describe, it, expect } from "vitest";
import { useStore } from "./store";
import type { WsMessage } from "../types/WsMessage";
import type { Span } from "../types/Span";

function span(id: string, status: Span["status"], name = "x"): Span {
  return { id, parent_id: null, run_id: "R1", kind: "tool_call", name,
    status, started_at: "t", ended_at: null, attributes: {} };
}

describe("store.applyWs", () => {
  it("snapshot replaces the current trace", () => {
    useStore.getState().applyWs({
      type: "snapshot",
      run: { id: "R1", status: "running" } as any,
      spans: [span("s1", "running")],
    } as WsMessage);
    expect(useStore.getState().currentTrace?.run.id).toBe("R1");
    expect(useStore.getState().currentTrace?.spans).toHaveLength(1);
  });

  it("span_update upserts by id (latest wins)", () => {
    const s = useStore.getState();
    s.applyWs({ type: "snapshot", run: { id: "R1", status: "running" } as any,
      spans: [span("s1", "running")] } as WsMessage);
    s.applyWs({ type: "span_update", span: span("s1", "ok") } as WsMessage);
    const spans = useStore.getState().currentTrace!.spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
  });

  it("event of kind text_delta concatenates assistant text", () => {
    const s = useStore.getState();
    s.applyWs({ type: "snapshot", run: { id: "R1", status: "running" } as any, spans: [] } as WsMessage);
    s.applyWs({ type: "event", event: { run_id: "R1", span_id: "t1", ts: "t",
      kind: "text_delta", payload: { text: "He" } } } as WsMessage);
    s.applyWs({ type: "event", event: { run_id: "R1", span_id: "t1", ts: "t",
      kind: "text_delta", payload: { text: "llo" } } } as WsMessage);
    expect(useStore.getState().assistantText).toBe("Hello");
  });

  it("run_update updates status", () => {
    const s = useStore.getState();
    s.applyWs({ type: "snapshot", run: { id: "R1", status: "running" } as any, spans: [] } as WsMessage);
    s.applyWs({ type: "run_update", run: { id: "R1", status: "completed" } as any } as WsMessage);
    expect(useStore.getState().currentTrace!.run.status).toBe("completed");
  });
});
