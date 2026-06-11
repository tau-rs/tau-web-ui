import { describe, it, expect, afterEach, vi } from "vitest";

// The Vite dev proxy target is Node-side config (process.env), distinct from the
// browser API root (import.meta.env). `vi.stubEnv` writes to process.env, and
// re-importing with a fresh module graph makes the config read it.
async function loadProxyTarget(): Promise<string> {
  vi.resetModules();
  const mod = await import("../../vite.config");
  const cfg = mod.default as {
    server: { proxy: Record<string, { target: string }> };
  };
  return cfg.server.proxy["/api"].target;
}

describe("Vite gateway proxy target (VITE_GATEWAY_TARGET)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to http://127.0.0.1:4317 when unset", async () => {
    expect(await loadProxyTarget()).toBe("http://127.0.0.1:4317");
  });

  it("an override changes the resolved target", async () => {
    vi.stubEnv("VITE_GATEWAY_TARGET", "http://gw.internal:9000");
    expect(await loadProxyTarget()).toBe("http://gw.internal:9000");
  });
});
