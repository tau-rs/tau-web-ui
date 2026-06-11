import { describe, it, expect, vi } from "vitest";
import { useStore } from "./store";
import type { WsMessage } from "../types/WsMessage";
import type { Span } from "../types/Span";

function span(id: string, status: Span["status"], name = "x"): Span {
  return {
    id,
    parent_id: null,
    run_id: "R1",
    kind: "tool_call",
    name,
    status,
    started_at: "t",
    ended_at: null,
    attributes: {},
  };
}

describe("store.applyWs", () => {
  it("snapshot replaces the current trace", () => {
    useStore.getState().applyWs({
      type: "snapshot",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial Run fixture; follow-up: add a typed run() test helper
      run: { id: "R1", status: "running" } as any,
      spans: [span("s1", "running")],
      events: [],
    } as WsMessage);
    expect(useStore.getState().currentTrace?.run.id).toBe("R1");
    expect(useStore.getState().currentTrace?.spans).toHaveLength(1);
  });

  it("span_update upserts by id (latest wins)", () => {
    const s = useStore.getState();
    s.applyWs({
      type: "snapshot",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial Run fixture; follow-up: add a typed run() test helper
      run: { id: "R1", status: "running" } as any,
      spans: [span("s1", "running")],
      events: [],
    } as WsMessage);
    s.applyWs({ type: "span_update", span: span("s1", "ok") } as WsMessage);
    const spans = useStore.getState().currentTrace!.spans;
    expect(spans).toHaveLength(1);
    expect(spans[0].status).toBe("ok");
  });

  it("event of kind text_delta concatenates assistant text", () => {
    const s = useStore.getState();
    s.applyWs({
      type: "snapshot",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial Run fixture; follow-up: add a typed run() test helper
      run: { id: "R1", status: "running" } as any,
      spans: [],
      events: [],
    } as WsMessage);
    s.applyWs({
      type: "event",
      event: { run_id: "R1", span_id: "t1", ts: "t", kind: "text_delta", payload: { text: "He" } },
    } as WsMessage);
    s.applyWs({
      type: "event",
      event: { run_id: "R1", span_id: "t1", ts: "t", kind: "text_delta", payload: { text: "llo" } },
    } as WsMessage);
    expect(useStore.getState().assistantText).toBe("Hello");
  });

  it("snapshot reconstructs assistant text from text_delta events", () => {
    useStore.getState().applyWs({
      type: "snapshot",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial Run fixture; follow-up: add a typed run() test helper
      run: { id: "R1", status: "running" } as any,
      spans: [],
      events: [
        { run_id: "R1", span_id: "t1", ts: "t", kind: "text_delta", payload: { text: "He" } },
        { run_id: "R1", span_id: "t1", ts: "t", kind: "text_delta", payload: { text: "llo" } },
      ],
    } as WsMessage);
    expect(useStore.getState().assistantText).toBe("Hello");
  });

  it("run_update updates status", () => {
    const s = useStore.getState();
    s.applyWs({
      type: "snapshot",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial Run fixture; follow-up: add a typed run() test helper
      run: { id: "R1", status: "running" } as any,
      spans: [],
      events: [],
    } as WsMessage);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial Run fixture; follow-up: add a typed run() test helper
    s.applyWs({ type: "run_update", run: { id: "R1", status: "completed" } as any } as WsMessage);
    expect(useStore.getState().currentTrace!.run.status).toBe("completed");
  });
});

describe("store.loadHealth", () => {
  it("stores health from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          gateway_ok: true,
          engine_ok: true,
          tau_bin: "x",
          tau_version: "0.0.0-mock",
        }),
      }),
    );
    await useStore.getState().loadHealth("demo");
    expect(useStore.getState().health?.tau_version).toBe("0.0.0-mock");
    vi.restoreAllMocks();
  });
});

describe("store.loadWorkflows", () => {
  it("stores workflow names", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workflows: ["wf-a", "wf-b"] }) }),
    );
    await useStore.getState().loadWorkflows("demo");
    expect(useStore.getState().workflows).toEqual(["wf-a", "wf-b"]);
    vi.restoreAllMocks();
  });
});

describe("store project scope", () => {
  it("setActiveProject records the id", () => {
    useStore.getState().setActiveProject("acme-bot");
    expect(useStore.getState().activeProjectId).toBe("acme-bot");
  });

  it("loadProjects populates the projects list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            meta: { id: "demo", name: "demo", path: "/p", source: { kind: "local" } },
            summary: {},
          },
        ],
      }),
    );
    await useStore.getState().loadProjects();
    expect(useStore.getState().projects).toHaveLength(1);
    expect(useStore.getState().projects[0].meta.id).toBe("demo");
    vi.restoreAllMocks();
  });
});
