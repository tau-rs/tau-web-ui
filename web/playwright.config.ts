import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // Retry in CI only: the suite has timing-sensitive flows (e.g. cancel mid-run
  // races the mock's run duration). Local runs stay at 0 to surface real flakes.
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: "http://127.0.0.1:5173", trace: "on", video: "on", screenshot: "on" },
  webServer: [
    {
      command:
        "./target/debug/tau-gateway --project ./fixtures/demo --tau-bin ./target/debug/fake-tau-serve --no-sandbox --port 4317",
      url: "http://127.0.0.1:4317/api/health",
      cwd: "..",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
