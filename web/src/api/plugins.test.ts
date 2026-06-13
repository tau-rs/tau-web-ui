import { describe, it, expect, vi, beforeEach } from "vitest";
import { listPlugins } from "./plugins";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("plugins api", () => {
  it("listPlugins GETs the scoped path and decodes the envelope", async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ plugins: [], errors: [] }) });
    vi.stubGlobal("fetch", f);
    const cat = await listPlugins("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/plugins");
    expect(cat).toEqual({ plugins: [], errors: [] });
  });
});
