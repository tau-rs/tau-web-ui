import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProject, listRuns, launchRun, getTrace, cancelRun, setActiveProject } from "./client";

beforeEach(() => {
  vi.restoreAllMocks();
  setActiveProject("demo");
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
    await getProject();
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/project");
  });

  it("launchRun posts to the scoped runs path and returns run_id", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run_id: "R1" }) });
    vi.stubGlobal("fetch", f);
    const id = await launchRun("greeter", "hi");
    expect(id).toBe("R1");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/runs");
    const [, init] = f.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ agent_id: "greeter", prompt: "hi" });
  });

  it("getTrace returns run + spans from the scoped path", async () => {
    mockFetch({ run: { id: "R1" }, spans: [{ id: "s1" }] });
    const t = await getTrace("R1");
    expect(t.spans).toHaveLength(1);
  });

  it("cancelRun returns boolean", async () => {
    mockFetch({ cancelled: true });
    expect(await cancelRun("R1")).toBe(true);
  });

  it("listRuns passes filters under the scoped path", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listRuns({ status: "completed" });
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/runs?status=completed");
  });
});
