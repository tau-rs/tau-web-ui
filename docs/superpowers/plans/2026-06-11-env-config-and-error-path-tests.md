# Env Config + Error-Path Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the gateway proxy target and API root configurable via env vars (defaults unchanged), and close the error-path test gap (a 500 renders error-not-empty; a dropped/closed socket is reflected to callers).

**Architecture:** Two env vars, each defaulting to today's value so behavior is identical when unset: `VITE_GATEWAY_TARGET` consumed by the Vite dev proxy (Node, `process.env`), and `VITE_API_ROOT` consumed by the browser API client (`import.meta.env`), exported as the single home for the `/api` root so the sibling api modules route through it too. For errors: drive a real 500 through `request()` into `useAsync` to assert the error/empty/loading distinction, and add a minimal `onClose` seam to `openRunSocket` so a dropped socket becomes observable (all current call sites stay byte-identical).

**Tech Stack:** TypeScript, Vite, Vitest, React Testing Library. Run from `web/` with `pnpm`.

---

### Task 1: API root env indirection (D9, browser side)

**Files:**
- Modify: `web/src/vite-env.d.ts` (type the custom env var)
- Modify: `web/src/api/client.ts:23-27,29` (`scoped()` + new `API_ROOT`)
- Modify: `web/src/api/projects.ts:6,16,23,33` (route `/api` through `API_ROOT`)
- Modify: `web/src/api/credentials.ts:7` (route `/api` through `API_ROOT`)
- Test: `web/src/api/client.test.ts` (new specs; uses `vi.stubEnv` + `vi.resetModules` + dynamic import)

- [ ] **Step 1: Write the failing tests** — append to `web/src/api/client.test.ts`:

```ts
describe("API root is env-configurable (VITE_API_ROOT)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to /api when VITE_API_ROOT is unset", async () => {
    vi.resetModules();
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    const { getProject } = await import("./client");
    await getProject("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/project");
  });

  it("an override changes the resolved root for scoped paths", async () => {
    vi.stubEnv("VITE_API_ROOT", "/gw");
    vi.resetModules();
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    const { getProject } = await import("./client");
    await getProject("demo");
    expect(f.mock.calls[0][0]).toBe("/gw/projects/demo/project");
  });
});
```

Ensure `afterEach` and `vi` are imported (the file already imports `vi`; add `afterEach` to the `vitest` import).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/api/client.test.ts`
Expected: the override spec FAILS (resolves to `/api/...`, not `/gw/...`).

- [ ] **Step 3: Implement** — in `web/src/api/client.ts`, replace the `scoped` + `BASE` region:

```ts
/** API root path. Override with `VITE_API_ROOT` (e.g. to point the UI at a
 *  gateway that mounts its REST/WS surface somewhere other than `/api`).
 *  Defaults to today's value so behavior is unchanged when unset. This is the
 *  single home for the root; the sibling api modules import it. */
export const API_ROOT = import.meta.env.VITE_API_ROOT ?? "/api";

/** Build a path scoped to project `pid`. The project is always passed
 *  explicitly by the caller — there is no module-level "active project". */
function scoped(pid: string, path: string): string {
  return `${API_ROOT}/projects/${encodeURIComponent(pid)}${path}`;
}

const BASE = ""; // single future home for an absolute base URL
```

In `web/src/api/projects.ts`, add `import { request, API_ROOT } from "./client";` (merge with the existing `request` import) and replace each literal: `"/api/projects"` → `` `${API_ROOT}/projects` `` and `"/api/workspace/save-as"` → `` `${API_ROOT}/workspace/save-as` ``.

In `web/src/api/credentials.ts`, likewise import `API_ROOT` and replace `"/api/credentials"` → `` `${API_ROOT}/credentials` ``.

- [ ] **Step 4: Type the env var** — replace `web/src/vite-env.d.ts` contents:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the API root path the UI calls. Default: `/api`. */
  readonly VITE_API_ROOT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run src/api/client.test.ts`
Expected: PASS (all specs, including the pre-existing WS/scoping ones still resolving `/api/...`).

- [ ] **Step 6: Commit**

```bash
git add web/src/api/client.ts web/src/api/projects.ts web/src/api/credentials.ts web/src/vite-env.d.ts web/src/api/client.test.ts
git commit -m "feat(web): make API root configurable via VITE_API_ROOT (D9)"
```

---

### Task 2: Gateway proxy target env indirection (D9, dev-server side)

**Files:**
- Modify: `web/vite.config.ts:10-13` (proxy target from `process.env`)
- Test: `web/src/api/env-config.test.ts` (new — dynamic import of the config)

- [ ] **Step 1: Write the failing test** — create `web/src/api/env-config.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";

// The Vite dev proxy target is Node-side config (process.env), distinct from the
// browser API root (import.meta.env). Re-import the config with a fresh module
// graph so each case reads its own env.
async function loadProxyTarget(): Promise<string> {
  vi.resetModules();
  const mod = await import("../../vite.config");
  const cfg = mod.default as {
    server: { proxy: Record<string, { target: string }> };
  };
  return cfg.server.proxy["/api"].target;
}

describe("Vite gateway proxy target (VITE_GATEWAY_TARGET)", () => {
  const original = process.env.VITE_GATEWAY_TARGET;
  afterEach(() => {
    if (original === undefined) delete process.env.VITE_GATEWAY_TARGET;
    else process.env.VITE_GATEWAY_TARGET = original;
  });

  it("defaults to http://127.0.0.1:4317 when unset", async () => {
    delete process.env.VITE_GATEWAY_TARGET;
    expect(await loadProxyTarget()).toBe("http://127.0.0.1:4317");
  });

  it("an override changes the resolved target", async () => {
    process.env.VITE_GATEWAY_TARGET = "http://gw.internal:9000";
    expect(await loadProxyTarget()).toBe("http://gw.internal:9000");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/api/env-config.test.ts`
Expected: the override spec FAILS (target stays `http://127.0.0.1:4317`).

- [ ] **Step 3: Implement** — in `web/vite.config.ts`, add the resolver above `defineConfig` and use it:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/api/env-config.test.ts`
Expected: PASS. (If importing `../../vite.config` fails under jsdom because of the
react plugin, fall back to exporting `export const gatewayTarget = GATEWAY_TARGET`
from the config and asserting that export instead.)

- [ ] **Step 5: Commit**

```bash
git add web/vite.config.ts web/src/api/env-config.test.ts
git commit -m "feat(web): make dev proxy target configurable via VITE_GATEWAY_TARGET (D9)"
```

---

### Task 3: Error-path — a 500 renders error, not empty (D8)

**Files:**
- Modify: `web/src/app/useAsync.test.tsx` (add integration spec through real `request`)

- [ ] **Step 1: Write the failing test** — append inside the `describe("useAsync", …)` block in `web/src/app/useAsync.test.tsx`:

```ts
it("a 500 through the real client lands on error, not empty", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }),
  );
  const { request } = await import("../api/client");
  const { result } = renderHook(() =>
    // isEmpty would classify a [] result as empty — a failed read must NOT take
    // that branch; it must surface as an error.
    useAsync(() => request<number[]>("/api/x"), [], { isEmpty: (d) => d.length === 0 }),
  );
  expect(result.current.status).toBe("loading");
  await waitFor(() => expect(result.current.status).toBe("error"));
  const s = result.current;
  if (s.status !== "error") throw new Error("expected error");
  expect(s.error).toContain("500");
  expect(spy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it passes (behavior already correct)**

Run: `pnpm vitest run src/app/useAsync.test.tsx`
Expected: PASS. This is a coverage-gap test — it documents and guards the
error-not-empty distinction end-to-end (request → useAsync). If it FAILS, that is
a real regression to fix, not the test.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/useAsync.test.tsx
git commit -m "test(web): assert a 500 renders error not empty (D8)"
```

---

### Task 4: Error-path — a dropped socket is reflected (D8)

**Files:**
- Modify: `web/src/api/client.ts:99-116` (`openRunSocket` gains optional `onClose`)
- Test: `web/src/api/client.test.ts` (drop + malformed-frame specs)

- [ ] **Step 1: Write the failing tests** — append to `web/src/api/client.test.ts`:

```ts
describe("openRunSocket error paths", () => {
  class FakeWS {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onclose: ((ev: CloseEvent) => void) | null = null;
    constructor(public url: string) {}
    drop() {
      this.onclose?.({} as CloseEvent);
    }
    deliver(data: string) {
      this.onmessage?.({ data } as MessageEvent);
    }
  }

  it("reflects a dropped socket to the onClose callback", () => {
    let created: FakeWS | null = null;
    vi.stubGlobal(
      "WebSocket",
      class extends FakeWS {
        constructor(url: string) {
          super(url);
          created = this;
        }
      } as unknown as typeof WebSocket,
    );
    const onClose = vi.fn();
    openRunSocket("demo", "R1", () => {}, onClose);
    expect(created).not.toBeNull();
    created!.drop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("swallows a malformed frame without invoking onMessage or throwing", () => {
    let created: FakeWS | null = null;
    vi.stubGlobal(
      "WebSocket",
      class extends FakeWS {
        constructor(url: string) {
          super(url);
          created = this;
        }
      } as unknown as typeof WebSocket,
    );
    const onMessage = vi.fn();
    openRunSocket("demo", "R1", onMessage);
    expect(() => created!.deliver("not json")).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/api/client.test.ts`
Expected: the drop spec FAILS (`openRunSocket` has no 4th param / never calls `onClose`).

- [ ] **Step 3: Implement** — in `web/src/api/client.ts`, update `openRunSocket`:

```ts
/** Open the live WS for a run under project `pid`. `onClose` (optional) is
 *  invoked when the socket drops, so callers can reflect a lost connection. */
export function openRunSocket(
  pid: string,
  id: string,
  onMessage: (m: WsMessage) => void,
  onClose?: () => void,
): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(
    `${proto}://${location.host}${scoped(pid, `/runs/${encodeURIComponent(id)}/events`)}`,
  );
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data) as WsMessage);
    } catch {
      /* ignore malformed */
    }
  };
  if (onClose) ws.onclose = () => onClose();
  return ws;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/api/client.test.ts`
Expected: PASS (new specs + the pre-existing WS-url spec, which passes no 4th arg).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/src/api/client.test.ts
git commit -m "feat(web): reflect a dropped run socket via onClose seam + tests (D8)"
```

---

### Task 5: Full verification

- [ ] **Step 1: Type-check, lint, format, unit, build**

Run (from `web/`):
```bash
pnpm tsc --noEmit
pnpm exec eslint .
pnpm exec prettier --check .
pnpm vitest run
pnpm build
```
Expected: all green. (Per project note, prettier must pass — run `prettier --write` on any touched file that fails the check, then re-check.)

- [ ] **Step 2: Confirm defaults preserved**

The env-config specs in Tasks 1–2 already assert the unset path resolves to
`/api` and `http://127.0.0.1:4317`. Capture that output as evidence.

- [ ] **Step 3 (optional): e2e smoke**

Run: `pnpm exec playwright test` (requires the gateway + fake-tau-serve build).
The error paths are unit-tested by design — `fake-tau-serve` serves only happy
paths and the brief forbids reworking the e2e harness — so e2e is unchanged and
serves only as a regression check that defaults still wire up.

---

## Notes / scope decisions

- **Why unit, not e2e, for D8:** every e2e runs against `fake-tau-serve`, which has
  no failure modes, and the brief forbids reworking that harness. A 500 and a
  socket drop are precisely injectable at the unit layer (`request` / `WebSocket`),
  which is the correct seam.
- **Socket "reflected" = observability seam, not new UI:** `openRunSocket` gains an
  optional `onClose` so a drop is observable to callers; the store keeps its current
  behavior (passes no callback → byte-identical). Wiring a reconnect/error banner
  into the store would exceed "add only the named error-path tests."
- **Not touched:** the `pnpm audit` / dependency gate (owned by brief 51).
