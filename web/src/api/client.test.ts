import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getProject,
  listRuns,
  launchRun,
  getTrace,
  cancelRun,
  openRunSocket,
  request,
  requestVoid,
} from "./client";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

describe("api client (project-scoped)", () => {
  it("getProject hits the active project's scoped path", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project_path: "/p", agents: ["greeter"], tau_version: "0" }),
    });
    vi.stubGlobal("fetch", f);
    await getProject("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/project");
  });

  it("launchRun posts to the scoped runs path and returns run_id", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run_id: "R1" }) });
    vi.stubGlobal("fetch", f);
    const id = await launchRun("demo", "greeter", "hi");
    expect(id).toBe("R1");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/runs");
    const [, init] = f.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ agent_id: "greeter", prompt: "hi" });
  });

  it("getTrace returns run + spans from the scoped path", async () => {
    mockFetch({ run: { id: "R1" }, spans: [{ id: "s1" }] });
    const t = await getTrace("demo", "R1");
    expect(t.spans).toHaveLength(1);
  });

  it("cancelRun returns boolean", async () => {
    mockFetch({ cancelled: true });
    expect(await cancelRun("demo", "R1")).toBe(true);
  });

  it("listRuns passes filters under the scoped path", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listRuns("demo", { status: "completed" });
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/runs?status=completed");
  });

  it("percent-encodes the project id so a slashed pid stays in one path segment", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    await getProject("a/b#c%d");
    expect(f.mock.calls[0][0]).toBe("/api/projects/a%2Fb%23c%25d/project");
  });

  it("percent-encodes the run id so it cannot break out of /runs/:id", async () => {
    mockFetch({ run: { id: "R1" }, spans: [], events: [] });
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run: {}, spans: [] }) });
    vi.stubGlobal("fetch", f);
    await getTrace("demo", "../secret");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/runs/..%2Fsecret");
  });

  it("percent-encodes the run id in cancelRun", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ cancelled: true }) });
    vi.stubGlobal("fetch", f);
    await cancelRun("demo", "a/b");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/runs/a%2Fb/cancel");
  });

  it("percent-encodes the run id in the live WS url", () => {
    const urls: string[] = [];
    class FakeWS {
      onmessage: ((ev: MessageEvent) => void) | null = null;
      constructor(url: string) {
        urls.push(url);
      }
    }
    vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
    openRunSocket("demo", "a/b", () => {});
    expect(urls[0]).toContain("/api/projects/demo/runs/a%2Fb/events");
  });

  it("scopes each request to its explicit project argument, not a shared default", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    // Two projects' requests must each hit their own project. The old API had no
    // per-call project — it read a single mutable module global — so this could
    // only ever target one project. Guards against reintroducing such a default.
    await Promise.all([listRuns("alpha"), listRuns("beta")]);
    const urls = f.mock.calls.map((c) => c[0]).sort();
    expect(urls).toEqual(["/api/projects/alpha/runs", "/api/projects/beta/runs"]);
  });
});

describe("shared request helper (error normalization in one place)", () => {
  it("request throws `${status}: ${text}` on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "down" }),
    );
    await expect(request("/api/anything")).rejects.toThrow("503: down");
  });

  it("request returns parsed JSON on an OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ a: 1 }) }));
    expect(await request<{ a: number }>("/x")).toEqual({ a: 1 });
  });

  it("requestVoid throws `${status}: ${text}` on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "nope" }),
    );
    await expect(requestVoid("/api/gone", { method: "DELETE" })).rejects.toThrow("404: nope");
  });

  it("requestVoid resolves without parsing JSON on an OK response", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", f);
    await expect(requestVoid("/api/ok", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("forwards an init-less request to fetch with no second argument (byte-identical)", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    await request("/api/plain");
    // A bare GET must call fetch(url) — not fetch(url, undefined) or
    // fetch(url, {}). This keeps the consolidation byte-identical to the prior
    // direct-fetch call sites and is the invariant `send` exists to preserve.
    expect(f.mock.calls[0]).toEqual(["/api/plain"]);
  });

  it("forwards a caller's init through unchanged", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };
    await request("/api/thing", init);
    expect(f.mock.calls[0]).toEqual(["/api/thing", init]);
  });
});

describe("openRunSocket error paths", () => {
  class FakeWS {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    constructor(public url: string) {}
    drop() {
      this.onclose?.({} as CloseEvent);
    }
    deliver(data: string) {
      this.onmessage?.({ data } as MessageEvent);
    }
  }

  function stubWs(): { current: FakeWS | null } {
    const ref: { current: FakeWS | null } = { current: null };
    vi.stubGlobal(
      "WebSocket",
      class extends FakeWS {
        constructor(url: string) {
          super(url);
          ref.current = this;
        }
      } as unknown as typeof WebSocket,
    );
    return ref;
  }

  it("reflects a dropped socket to the onClose callback", () => {
    const ref = stubWs();
    const onClose = vi.fn();
    openRunSocket("demo", "R1", () => {}, onClose);
    expect(ref.current).not.toBeNull();
    ref.current!.drop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("swallows a malformed frame without invoking onMessage or throwing", () => {
    const ref = stubWs();
    const onMessage = vi.fn();
    openRunSocket("demo", "R1", onMessage);
    expect(() => ref.current!.deliver("not json")).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe("API root is env-configurable (VITE_API_ROOT)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to /api when VITE_API_ROOT is unset", async () => {
    vi.resetModules();
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    const { getProject } = await import("./client");
    await getProject("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/project");
  });

  it("an override changes the resolved root for scoped paths", async () => {
    vi.stubEnv("VITE_API_ROOT", "/gw");
    vi.resetModules();
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    const { getProject } = await import("./client");
    await getProject("demo");
    expect(f.mock.calls[0][0]).toBe("/gw/projects/demo/project");
  });
});
