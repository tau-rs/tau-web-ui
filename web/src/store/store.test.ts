import { describe, it, expect, vi, afterEach } from "vitest";
import { useStore } from "./store";
import type { WsMessage } from "../types/WsMessage";
import type { Span } from "../types/Span";

// Safety net: restore real timers and global mocks even if a test throws before
// its own cleanup. Scheduler tests must still unsubscribe to reset the store's
// (closure) poller ref-count; this guards the shared vi state between files.
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("store.refreshRuns in-flight guard", () => {
  it("dedups overlapping calls so a slow response is not clobbered", async () => {
    const d = deferred<{ ok: true; json: () => Promise<unknown[]> }>();
    const fetchMock = vi.fn().mockReturnValue(d.promise);
    vi.stubGlobal("fetch", fetchMock);

    const s = useStore.getState();
    const p1 = s.refreshRuns("demo");
    const p2 = s.refreshRuns("demo"); // called while the first is still in flight

    expect(fetchMock).toHaveBeenCalledTimes(1); // second call did NOT start a new fetch

    d.resolve({ ok: true, json: async () => [{ id: "a" } as never] });
    await Promise.all([p1, p2]);

    expect(useStore.getState().runs).toHaveLength(1);
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

describe("store.refreshRuns status", () => {
  it("records runsError and re-throws on failure, but marks loaded", async () => {
    useStore.setState({ runsLoaded: false, runsError: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }),
    );
    await expect(useStore.getState().refreshRuns("demo")).rejects.toThrow();
    expect(useStore.getState().runsLoaded).toBe(true);
    expect(useStore.getState().runsError).toContain("500");
    vi.restoreAllMocks();
  });

  it("clears runsError on success", async () => {
    useStore.setState({ runsError: "old" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    await useStore.getState().refreshRuns("demo");
    expect(useStore.getState().runsLoaded).toBe(true);
    expect(useStore.getState().runsError).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("store.loadHealth connectivity", () => {
  it("captures the reason on failure and keeps the last snapshot + contact time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ gateway_ok: true, engine_ok: true, tau_bin: "x", tau_version: "1" }),
      }),
    );
    await useStore.getState().loadHealth("demo");
    const contactAt = useStore.getState().healthCheckedAt;
    expect(contactAt).not.toBeNull();
    expect(useStore.getState().healthError).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    await useStore.getState().loadHealth("demo");
    expect(useStore.getState().healthError).toBe("Failed to fetch");
    expect(useStore.getState().health?.gateway_ok).toBe(true);
    expect(useStore.getState().healthCheckedAt).toBe(contactAt);
    vi.restoreAllMocks();
  });
});

const okFetch = () => vi.fn().mockResolvedValue({ ok: true, json: async () => [] as unknown[] });
const errFetch = () =>
  vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });

describe("store.subscribeRuns scheduler", () => {
  it("two subscribers share one interval (one GET /runs per tick)", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const s = useStore.getState();
    const un1 = s.subscribeRuns("demo", 5000);
    const un2 = s.subscribeRuns("demo", 5000); // 2nd subscriber must NOT start a 2nd timer

    await vi.advanceTimersByTimeAsync(0); // flush the single immediate tick
    fetchMock.mockClear();

    await vi.advanceTimersByTimeAsync(5000); // one interval
    expect(fetchMock).toHaveBeenCalledTimes(1); // ONE request, not two

    un1();
    un2();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not poll while the tab is hidden", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });

    const un = useStore.getState().subscribeRuns("demo", 5000);
    await vi.advanceTimersByTimeAsync(20000); // 4 intervals, tab hidden the whole time
    expect(fetchMock).not.toHaveBeenCalled();

    un();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("backs off on repeated errors instead of polling every interval", async () => {
    const fetchMock = errFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const un = useStore.getState().subscribeRuns("demo", 1000); // base 1s

    await vi.advanceTimersByTimeAsync(0); // t=0 immediate tick fails -> next at +2000
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // t=1000: no tick (backed off)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // t=2000: tick fails -> next at +4000
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999); // t=5999: still backed off
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // t=6000: third tick
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // base-interval polling would have fired ~7 times by t=6000; backoff fired 3.

    un();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
