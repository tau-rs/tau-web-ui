/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Override with VITE_GATEWAY_TARGET to proxy the dev server at a non-default
// gateway. Defaults to today's value so behavior is unchanged when unset.
const GATEWAY_TARGET = process.env.VITE_GATEWAY_TARGET ?? "http://127.0.0.1:4317";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    proxy: {
      // REST + WS both live under /api; ws:true upgrades the events endpoint.
      "/api": { target: GATEWAY_TARGET, ws: true, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Unit tests live under src/; e2e/ is Playwright-only (different runner).
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
