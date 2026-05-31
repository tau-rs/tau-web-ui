import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
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
