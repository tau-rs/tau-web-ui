import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getProject,
  listRuns,
  launchRun,
  getTrace,
  cancelRun,
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
});
