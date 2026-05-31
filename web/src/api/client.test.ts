import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProject, listRuns, launchRun, getTrace, cancelRun } from "./client";

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

describe("api client", () => {
  it("getProject returns agents", async () => {
    mockFetch({ project_path: "/p", agents: ["greeter"], tau_version: "0.0.0" });
    const p = await getProject();
    expect(p.agents).toEqual(["greeter"]);
  });

  it("launchRun posts agent_id + prompt and returns run_id", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run_id: "R1" }) });
    vi.stubGlobal("fetch", f);
    const id = await launchRun("greeter", "hi");
    expect(id).toBe("R1");
    const [, init] = f.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ agent_id: "greeter", prompt: "hi" });
  });

  it("getTrace returns run + spans", async () => {
    mockFetch({ run: { id: "R1" }, spans: [{ id: "s1" }] });
    const t = await getTrace("R1");
    expect(t.spans).toHaveLength(1);
  });

  it("cancelRun returns boolean", async () => {
    mockFetch({ cancelled: true });
    expect(await cancelRun("R1")).toBe(true);
  });

  it("listRuns passes filters", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listRuns({ status: "completed" });
    expect(f.mock.calls[0][0]).toContain("status=completed");
  });
});
