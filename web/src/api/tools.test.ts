import { describe, it, expect, vi, beforeEach } from "vitest";
import { listTools } from "./tools";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("tools api", () => {
  it("listTools GETs the scoped path and decodes the envelope", async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ tools: [], error_count: 0 }) });
    vi.stubGlobal("fetch", f);
    const cat = await listTools("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/tools");
    expect(cat).toEqual({ tools: [], error_count: 0 });
  });
});
