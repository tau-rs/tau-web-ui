import { describe, it, expect, vi, beforeEach } from "vitest";
import { getWorkflowGraph } from "./graph";

beforeEach(() => vi.restoreAllMocks());

describe("graph api path encoding", () => {
  it("percent-encodes the workflow name so a slashed name stays in one path segment", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nodes: [], edges: [] }) });
    vi.stubGlobal("fetch", f);
    await getWorkflowGraph("demo", "a/b?x=1");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/workflows/a%2Fb%3Fx%3D1/graph");
  });
});
