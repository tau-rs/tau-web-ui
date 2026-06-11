import { describe, it, expect, vi, beforeEach } from "vitest";
import { uninstallPackage, updatePackage } from "./config";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("config/packages api path encoding", () => {
  it("percent-encodes the package name so a slashed name stays in one path segment", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", f);
    await uninstallPackage("demo", "../etc/passwd");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/packages/..%2Fetc%2Fpasswd");
  });

  it("percent-encodes the package name in updatePackage, keeping the /update suffix", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ package: {} }) });
    vi.stubGlobal("fetch", f);
    await updatePackage("demo", "a#b");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/packages/a%23b/update");
  });
});
