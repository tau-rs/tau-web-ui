# Loading states, error boundary, and connectivity detail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-panel loading states, a recoverable global+per-route error boundary, and surfaced connectivity-failure detail (reason + last-contact, "unreachable" vs "engine down") to tau-ui.

**Architecture:** A small `useAsync` hook exposes a `loading | error | empty | data` lifecycle, rendered by a presentational `<Async>` panel with skeletons. A class `ErrorBoundary` catches render throws, reports via the existing `surfaceError` helper, and shows a recoverable fallback — mounted at the SPA root and per-route. The zustand store records first-load status for runs and captures health-fetch errors + last-contact time so the Health strip and the Navbar/Footer dots can explain outages.

**Tech Stack:** React 19, TypeScript, react-router-dom 7, zustand 5, Tailwind 3, Vitest 2 + Testing Library 16.

---

## Conventions

- Working directory for all commands: `web/` (run `cd web` once per shell). The package manager is **pnpm**.
- **node@20 is unavailable locally, so Vitest cannot run here** — `pnpm test` is expected to fail to launch (not a test failure). Rely on `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm build` locally; CI runs Vitest on node@20. For each task, "run the test" means: write it, and verify it at minimum **typechecks** (`pnpm typecheck`) and lints clean; CI is the source of truth for green tests. Still write tests test-first.
- Every task ends by re-running the local gate and committing. Include `pnpm format:check` (per-task gate omits prettier otherwise, causing churn).
- Commit message trailer for every commit:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Tailwind tokens already in the codebase: `bg-surface`, `border-border`, `text-muted`, `text-fg`, `bg-accent`, `text-accent-fg`, `text-st-error`, `bg-st-error-soft`, `bg-st-ok`, `bg-st-error`. `animate-pulse` is a stock Tailwind utility.

---

## File Structure

**New files (all under `web/src/`):**
- `notify/notify.ts` — *(modify)* export `errorMessage(err)`.
- `app/relative-time.ts` — `relativeTime(ts, now?)` compact "time ago".
- `app/Skeleton.tsx` — shimmer-block primitive.
- `app/useAsync.ts` — the `loading|error|empty|data` hook.
- `app/Async.tsx` — presentational slot renderer for an `AsyncState`.
- `app/ErrorBoundary.tsx` — class boundary + recoverable fallback.
- Colocated tests: `relative-time.test.ts`, `useAsync.test.tsx`, `Async.test.tsx`, `ErrorBoundary.test.tsx`, `notify.test.ts` *(extend existing)*.

**Modified files:**
- `main.tsx` — wrap `<App/>` in top-level `<ErrorBoundary>`.
- `app/AppShell.tsx` — per-route `<ErrorBoundary resetKey={location.key}>` around `<Outlet/>`.
- `store/store.ts` — `runsLoaded`/`runsError`, `healthError`/`healthCheckedAt`; `refreshRuns`/`loadHealth` capture status.
- `health/HealthPage.tsx` — checks via `useAsync`; connectivity strip rewrite.
- `providers/ProvidersPage.tsx` — providers via `useAsync`.
- `dashboard/DashboardPage.tsx` — skeleton until `runsLoaded`.
- `app/Navbar.tsx`, `app/Footer.tsx` — enriched dot `title=` tooltips.

---

## Task 1: `errorMessage` helper (shared)

**Files:**
- Modify: `web/src/notify/notify.ts`
- Test: `web/src/notify/notify.test.ts`

- [ ] **Step 1: Write the failing test** — append to `notify.test.ts` (create the file's `errorMessage` describe block; keep any existing tests). If the file does not exist, create it:

```ts
import { describe, it, expect } from "vitest";
import { errorMessage } from "./notify";

describe("errorMessage", () => {
  it("returns the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });
  it("stringifies non-Error values", () => {
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(503)).toBe("503");
  });
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: FAIL — `errorMessage` is not exported from `./notify`.

- [ ] **Step 3: Implement** — in `web/src/notify/notify.ts`, add the export and refactor `surfaceError` to use it:

```ts
/** Extract a human-readable message from any thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Surface a failed operation: log it for diagnostics AND show the user a toast.
 * The shared replacement for silent `.catch(() => {})` sites.
 */
export function surfaceError(context: string, err: unknown): void {
  console.error(`${context}:`, err);
  notify("error", `${context}: ${errorMessage(err)}`);
}
```

(Delete the old inline `const detail = ...` line inside `surfaceError`.)

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/notify/notify.ts web/src/notify/notify.test.ts
git commit -m "feat(web): export shared errorMessage() helper from notify

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `relativeTime` helper

**Files:**
- Create: `web/src/app/relative-time.ts`
- Test: `web/src/app/relative-time.test.ts`

- [ ] **Step 1: Write the failing test** — `web/src/app/relative-time.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = 1_700_000_000_000;

describe("relativeTime", () => {
  it("reports 'just now' under 5s", () => {
    expect(relativeTime(NOW - 2_000, NOW)).toBe("just now");
  });
  it("reports seconds, minutes, hours, days", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("10s ago");
    expect(relativeTime(NOW - 120_000, NOW)).toBe("2m ago");
    expect(relativeTime(NOW - 7_200_000, NOW)).toBe("2h ago");
    expect(relativeTime(NOW - 172_800_000, NOW)).toBe("2d ago");
  });
  it("never reports a negative future delta", () => {
    expect(relativeTime(NOW + 5_000, NOW)).toBe("just now");
  });
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: FAIL — cannot find module `./relative-time`.

- [ ] **Step 3: Implement** — `web/src/app/relative-time.ts`:

```ts
/** Compact "time ago" label for a past timestamp (ms epoch). */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
```

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/relative-time.ts web/src/app/relative-time.test.ts
git commit -m "feat(web): add relativeTime() helper for last-contact labels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: `Skeleton` primitive

**Files:**
- Create: `web/src/app/Skeleton.tsx`

(Trivial presentational component; exercised by page tests in later tasks — no dedicated test.)

- [ ] **Step 1: Implement** — `web/src/app/Skeleton.tsx`:

```tsx
/** A neutral shimmer block used to compose loading skeletons. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-border/60 ${className}`} aria-hidden />;
}
```

- [ ] **Step 2: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/Skeleton.tsx
git commit -m "feat(web): add Skeleton shimmer primitive

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: `useAsync` hook

**Files:**
- Create: `web/src/app/useAsync.ts`
- Test: `web/src/app/useAsync.test.tsx`

- [ ] **Step 1: Write the failing test** — `web/src/app/useAsync.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAsync } from "./useAsync";

afterEach(() => vi.restoreAllMocks());

describe("useAsync", () => {
  it("transitions loading -> data", async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve([1, 2]), []));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("data"));
    const s = result.current;
    if (s.status !== "data") throw new Error("expected data");
    expect(s.data).toEqual([1, 2]);
  });

  it("transitions loading -> empty via isEmpty", async () => {
    const { result } = renderHook(() =>
      useAsync(() => Promise.resolve([] as number[]), [], { isEmpty: (d) => d.length === 0 }),
    );
    await waitFor(() => expect(result.current.status).toBe("empty"));
  });

  it("transitions loading -> error and exposes the reason", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useAsync(() => Promise.reject(new Error("503: down")), []),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    const s = result.current;
    if (s.status !== "error") throw new Error("expected error");
    expect(s.error).toBe("503: down");
    expect(spy).toHaveBeenCalled();
  });

  it("reload re-runs the fetcher", async () => {
    let n = 0;
    const { result } = renderHook(() => useAsync(() => Promise.resolve(++n), []));
    await waitFor(() => expect(result.current.status).toBe("data"));
    act(() => result.current.reload());
    await waitFor(() => {
      const s = result.current;
      expect(s.status === "data" && s.data === 2).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: FAIL — cannot find module `./useAsync`.

- [ ] **Step 3: Implement** — `web/src/app/useAsync.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";
import { errorMessage } from "../notify/notify";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "empty" }
  | { status: "data"; data: T };

export type UseAsyncResult<T> = AsyncState<T> & { reload: () => void };

/**
 * Run an async fetcher and expose a 4-state lifecycle: loading | error | empty |
 * data. A failed read is logged for diagnostics and surfaced inline by the
 * caller's panel — it does NOT toast (distinct from surfaceError's mutation path).
 *
 * The effect is keyed on the caller-provided `deps`, not on `fetcher` (whose
 * identity changes every render). A request-id + mounted guard discard stale or
 * post-unmount results, including under StrictMode's double-invoke.
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  opts: { isEmpty?: (d: T) => boolean } = {},
): UseAsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const { isEmpty } = opts;
  const reqId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    const id = ++reqId.current;
    setState({ status: "loading" });
    fetcher().then(
      (data) => {
        if (!mounted.current || id !== reqId.current) return;
        setState(isEmpty?.(data) ? { status: "empty" } : { status: "data", data });
      },
      (err) => {
        if (!mounted.current || id !== reqId.current) return;
        console.error("useAsync:", err);
        setState({ status: "error", error: errorMessage(err) });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run };
}
```

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS. (The single `react-hooks/exhaustive-deps` disable is intentional and matches the documented behavior.)

- [ ] **Step 5: Commit**

```bash
git add web/src/app/useAsync.ts web/src/app/useAsync.test.tsx
git commit -m "feat(web): add useAsync hook (loading|error|empty|data lifecycle)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: `Async` panel

**Files:**
- Create: `web/src/app/Async.tsx`
- Test: `web/src/app/Async.test.tsx`

- [ ] **Step 1: Write the failing test** — `web/src/app/Async.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Async } from "./Async";
import type { AsyncState } from "./useAsync";

function renderAsync<T>(state: AsyncState<T>, reload = () => {}) {
  return render(
    <Async
      state={{ ...state, reload }}
      skeleton={<div data-testid="skel" />}
      empty={<div data-testid="empty" />}
    >
      {(data) => <div data-testid="data">{String(data)}</div>}
    </Async>,
  );
}

describe("Async", () => {
  it("shows the skeleton while loading (distinct from empty)", () => {
    renderAsync<string>({ status: "loading" });
    expect(screen.getByTestId("skel")).toBeInTheDocument();
    expect(screen.queryByTestId("empty")).not.toBeInTheDocument();
  });
  it("shows the empty slot when empty", () => {
    renderAsync<string>({ status: "empty" });
    expect(screen.getByTestId("empty")).toBeInTheDocument();
    expect(screen.queryByTestId("skel")).not.toBeInTheDocument();
  });
  it("renders children with data", () => {
    renderAsync<string>({ status: "data", data: "hi" });
    expect(screen.getByTestId("data")).toHaveTextContent("hi");
  });
  it("shows the reason and a working Retry on error", async () => {
    const reload = vi.fn();
    renderAsync<string>({ status: "error", error: "503: down" }, reload);
    expect(screen.getByRole("alert")).toHaveTextContent("503: down");
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(reload).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: FAIL — cannot find module `./Async`.

- [ ] **Step 3: Implement** — `web/src/app/Async.tsx`:

```tsx
import type { ReactNode } from "react";
import type { AsyncState } from "./useAsync";

interface AsyncProps<T> {
  state: AsyncState<T> & { reload: () => void };
  skeleton: ReactNode;
  empty: ReactNode;
  children: (data: T) => ReactNode;
}

/** Render the slot matching a useAsync() state. */
export function Async<T>({ state, skeleton, empty, children }: AsyncProps<T>) {
  switch (state.status) {
    case "loading":
      return <>{skeleton}</>;
    case "empty":
      return <>{empty}</>;
    case "error":
      return (
        <div
          role="alert"
          className="flex flex-col items-start gap-1.5 rounded-md border border-st-error/40 bg-st-error-soft px-3 py-2 text-xs text-st-error"
        >
          <span>Couldn’t load: {state.error}</span>
          <button
            onClick={state.reload}
            className="rounded border border-st-error/40 px-2 py-0.5 font-semibold"
          >
            Retry
          </button>
        </div>
      );
    case "data":
      return <>{children(state.data)}</>;
  }
}
```

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/Async.tsx web/src/app/Async.test.tsx
git commit -m "feat(web): add Async panel for useAsync states (skeleton/empty/error/data)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: `ErrorBoundary`

**Files:**
- Create: `web/src/app/ErrorBoundary.tsx`
- Test: `web/src/app/ErrorBoundary.test.tsx`

- [ ] **Step 1: Write the failing test** — `web/src/app/ErrorBoundary.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";
import { useNotifications } from "../notify/notify";

function Boom(): JSX.Element {
  throw new Error("kaboom");
}

beforeEach(() => useNotifications.setState({ items: [] }));

describe("ErrorBoundary", () => {
  it("renders a recoverable fallback instead of unmounting, and reports the error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // surfaceError() pushed a toast carrying the message
    expect(useNotifications.getState().items.some((n) => /kaboom/.test(n.message))).toBe(true);
    spy.mockRestore();
  });

  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});
```

> Note: if `JSX.Element` is not in scope under this TS config, type `Boom` as `(): never` and keep the `throw`. Verify with `pnpm typecheck`.

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: FAIL — cannot find module `./ErrorBoundary`.

- [ ] **Step 3: Implement** — `web/src/app/ErrorBoundary.tsx`:

```tsx
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { surfaceError } from "../notify/notify";

interface Props {
  children: ReactNode;
  /** When this value changes, the boundary clears any caught error. */
  resetKey?: unknown;
}
interface State {
  error: Error | null;
}

/** Catches render-time throws, reports them, and shows a recoverable fallback. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    surfaceError("UI crashed", error);
    console.error(info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  private reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <div className="text-base font-semibold">Something went wrong</div>
        <div className="max-w-md break-words font-mono text-xs text-st-error">{error.message}</div>
        <div className="flex gap-2">
          <button
            onClick={this.reset}
            className="rounded-md border border-border px-3 py-1 text-xs font-semibold"
          >
            Try again
          </button>
          <button
            onClick={() => location.reload()}
            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
```

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ErrorBoundary.tsx web/src/app/ErrorBoundary.test.tsx
git commit -m "feat(web): add recoverable ErrorBoundary that reports via surfaceError

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Mount the ErrorBoundary (root + per-route)

**Files:**
- Modify: `web/src/main.tsx`
- Modify: `web/src/app/AppShell.tsx`

- [ ] **Step 1: Edit `web/src/main.tsx`** — wrap `<App/>` (inside StrictMode, outside Router is fine; place outside Router so a routing-layer throw is also caught):

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import "./index.css";
import "@xyflow/react/dist/style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
```

- [ ] **Step 2: Edit `web/src/app/AppShell.tsx`** — add a per-route boundary around the Outlet, reset on navigation. Full file:

```tsx
import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useStore } from "../store/store";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { ErrorBoundary } from "./ErrorBoundary";
import { Toaster } from "../notify/Toaster";

export function AppShell() {
  const loadProjects = useStore((s) => s.loadProjects);
  const { key } = useLocation();
  useEffect(() => {
    loadProjects().catch(() => {});
  }, [loadProjects]);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar />
          <main className="min-h-0 flex-1 overflow-auto">
            <ErrorBoundary resetKey={key}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <Footer />
      <Toaster />
    </div>
  );
}
```

- [ ] **Step 3: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`
Expected: PASS; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/main.tsx web/src/app/AppShell.tsx
git commit -m "feat(web): mount ErrorBoundary at SPA root and per-route (keeps shell alive)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Store — runs first-load status + health connectivity

**Files:**
- Modify: `web/src/store/store.ts`
- Test: `web/src/store/store.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `web/src/store/store.test.ts`:

```ts
describe("store.refreshRuns status", () => {
  it("records runsError and re-throws on failure, but marks loaded", async () => {
    useStore.setState({ runsLoaded: false, runsError: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }),
    );
    await expect(useStore.getState().refreshRuns("demo")).rejects.toThrow();
    expect(useStore.getState().runsLoaded).toBe(true);
    expect(useStore.getState().runsError).toContain("500");
    vi.restoreAllMocks();
  });

  it("clears runsError on success", async () => {
    useStore.setState({ runsError: "old" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    await useStore.getState().refreshRuns("demo");
    expect(useStore.getState().runsLoaded).toBe(true);
    expect(useStore.getState().runsError).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("store.loadHealth connectivity", () => {
  it("captures the reason on failure and keeps the last snapshot + contact time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ gateway_ok: true, engine_ok: true, tau_bin: "x", tau_version: "1" }),
      }),
    );
    await useStore.getState().loadHealth("demo");
    const contactAt = useStore.getState().healthCheckedAt;
    expect(contactAt).not.toBeNull();
    expect(useStore.getState().healthError).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    await useStore.getState().loadHealth("demo");
    expect(useStore.getState().healthError).toBe("Failed to fetch");
    // last good snapshot + contact time preserved
    expect(useStore.getState().health?.gateway_ok).toBe(true);
    expect(useStore.getState().healthCheckedAt).toBe(contactAt);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: FAIL — `runsLoaded`, `runsError`, `healthError`, `healthCheckedAt` are not on the store type.

- [ ] **Step 3: Implement** — in `web/src/store/store.ts`:

(a) Add the import:

```ts
import { errorMessage } from "../notify/notify";
```

(b) Add to the `AppStore` interface (near `health`, `runs`):

```ts
  health: Health | null;
  healthError: string | null;
  healthCheckedAt: number | null;
  project: Project | null;
  runs: Run[];
  runsLoaded: boolean;
  runsError: string | null;
```

(c) Add to the initial state object (alongside `health: null`, `runs: []`):

```ts
  health: null,
  healthError: null,
  healthCheckedAt: null,
  project: null,
  runs: [],
  runsLoaded: false,
  runsError: null,
```

(d) Replace `loadHealth`:

```ts
  loadHealth: async (pid) => {
    try {
      set({ health: await getHealth(pid), healthError: null, healthCheckedAt: Date.now() });
    } catch (e) {
      // Keep the last snapshot + contact time; record why the latest contact failed.
      set({ healthError: errorMessage(e) });
    }
  },
```

(e) Replace `refreshRuns`:

```ts
  refreshRuns: async (pid, filters) => {
    try {
      set({ runs: await listRuns(pid, filters), runsLoaded: true, runsError: null });
    } catch (e) {
      // Record status for first-load UI, but preserve the throw-and-caller-catch contract.
      set({ runsLoaded: true, runsError: errorMessage(e) });
      throw e;
    }
  },
```

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/store/store.ts web/src/store/store.test.ts
git commit -m "feat(web): store tracks runs first-load status + health error/last-contact

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Dashboard skeleton on first load

**Files:**
- Modify: `web/src/dashboard/DashboardPage.tsx`
- Test: `web/src/dashboard/DashboardPage.test.tsx`

- [ ] **Step 1: Update the existing test + add a loading test** — `web/src/dashboard/DashboardPage.test.tsx`. The existing `beforeEach` sets `runs` but not `runsLoaded`; with the new gate it would render the skeleton. Set `runsLoaded: true` there, and add a first-load test:

Replace the `beforeEach` (lines ~27-29) with:

```ts
beforeEach(() =>
  useStore.setState({
    runs: [run({ id: "a" }), run({ id: "b", agent_id: "researcher" })],
    runsLoaded: true,
    runsError: null,
  }),
);
```

Add inside the `describe("DashboardPage", ...)` block:

```ts
  it("shows a loading skeleton before the first runs load (distinct from empty)", () => {
    useStore.setState({ runs: [], runsLoaded: false, runsError: null });
    render(
      <ProjectProvider pid="demo">
        <DashboardPage />
      </ProjectProvider>,
    );
    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
  });

  it("shows an empty hint when loaded with zero runs", () => {
    useStore.setState({ runs: [], runsLoaded: true, runsError: null });
    render(
      <ProjectProvider pid="demo">
        <DashboardPage />
      </ProjectProvider>,
    );
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: FAIL — `runsLoaded` not yet read in the page / `dashboard-skeleton` not present (typecheck passes but the new test would fail at runtime; if `useStore.setState` rejects unknown keys it won't — keys exist from Task 8). Primary gate here is the test intent; proceed.

- [ ] **Step 3: Implement** — `web/src/dashboard/DashboardPage.tsx`. Add `Skeleton` import and a first-load gate before the metrics render. Full file:

```tsx
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useStore } from "../store/store";
import { usePollRuns } from "../runs/usePollRuns";
import { computeMetrics } from "./metrics";
import { StatCard } from "./StatCard";
import { StatusBars } from "./StatusBars";
import { RunsSparkline } from "./RunsSparkline";
import { AgentTable } from "./AgentTable";
import { TopErrors } from "./TopErrors";
import { Skeleton } from "../app/Skeleton";

const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
const fmtMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 text-xs font-semibold text-muted">{title}</div>
      {children}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3 p-4" data-testid="dashboard-skeleton" aria-busy="true">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

export function DashboardPage() {
  usePollRuns();
  const runs = useStore((s) => s.runs);
  const runsLoaded = useStore((s) => s.runsLoaded);
  const m = useMemo(() => computeMetrics(runs), [runs]);

  if (!runsLoaded) return <DashboardSkeleton />;

  return (
    <div className="space-y-3 p-4">
      {runs.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-2 text-xs text-muted">
          No runs yet — launch an agent or workflow to populate the dashboard.
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Runs"
          value={m.total}
          sub={`${m.byKind.workflow} wf · ${m.byKind.agent} agent`}
        />
        <StatCard
          label="Success rate"
          tone="text-st-ok"
          value={m.successRate == null ? "—" : `${Math.round(m.successRate * 100)}%`}
          sub={`${m.byStatus.completed} ok · ${m.byStatus.failed} failed`}
        />
        <StatCard label="Running now" tone="text-st-running" value={m.byStatus.running} sub="live" />
        <StatCard
          label="Tokens"
          value={fmtTok(m.tokens.total)}
          sub={`${fmtTok(m.tokens.input)} in · ${fmtTok(m.tokens.output)} out`}
        />
        <StatCard
          label="Latency p50"
          value={m.durations ? fmtMs(m.durations.p50) : "—"}
          sub={
            m.durations ? `p90 ${fmtMs(m.durations.p90)} · p99 ${fmtMs(m.durations.p99)}` : undefined
          }
        />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Status distribution">
          <StatusBars byStatus={m.byStatus} total={m.total} />
        </Panel>
        <Panel title="Runs over time">
          <RunsSparkline data={m.overTime} />
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="By agent">
          <AgentTable agents={m.byAgent} />
        </Panel>
        <Panel title="Top failure reasons">
          <TopErrors errors={m.topErrors} />
        </Panel>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/dashboard/DashboardPage.tsx web/src/dashboard/DashboardPage.test.tsx
git commit -m "feat(web): dashboard shows skeleton on first load, empty hint when zero runs (D14)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Providers via `useAsync`

**Files:**
- Modify: `web/src/providers/ProvidersPage.tsx`
- Test: `web/src/providers/ProvidersPage.test.tsx` (existing tests must keep passing)

- [ ] **Step 1: Add a loading + empty test** — append inside `describe("ProvidersPage", ...)` in `ProvidersPage.test.tsx`:

```ts
  it("shows skeleton rows while providers load, distinct from the empty state", async () => {
    // never-resolving providers fetch keeps the panel in 'loading'
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/credentials"))
          return Promise.resolve({ ok: true, json: async () => [], text: async () => "" });
        if (url.includes("/providers")) return new Promise(() => {});
        return Promise.resolve({ ok: true, json: async () => ({}), text: async () => "" });
      }),
    );
    render(
      <ProjectProvider pid="demo">
        <ProvidersPage />
      </ProjectProvider>,
    );
    expect(await screen.findByTestId("providers-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/no providers/i)).not.toBeInTheDocument();
  });

  it("shows an empty state when no providers are returned", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/api/credentials"))
          return Promise.resolve({ ok: true, json: async () => [], text: async () => "" });
        if (url.includes("/providers"))
          return Promise.resolve({ ok: true, json: async () => [], text: async () => "" });
        return Promise.resolve({ ok: true, json: async () => ({}), text: async () => "" });
      }),
    );
    render(
      <ProjectProvider pid="demo">
        <ProvidersPage />
      </ProjectProvider>,
    );
    expect(await screen.findByText(/no providers/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: PASS to compile, but the new tests fail at runtime (no `providers-skeleton`, no "no providers" text) — confirming the behavior is missing.

- [ ] **Step 3: Implement** — `web/src/providers/ProvidersPage.tsx`. Replace the local providers state + `reloadProviders` with `useAsync`, wrap the table body region in `<Async>`. Full file:

```tsx
import { Fragment, useCallback, useEffect, useState } from "react";
import type { Provider } from "../types/Provider";
import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import { getProviders } from "../api/providers";
import { installPackage } from "../api/config";
import { getCredentials } from "../api/credentials";
import { useProjectId } from "../app/project-context";
import { useAsync } from "../app/useAsync";
import { Async } from "../app/Async";
import { Skeleton } from "../app/Skeleton";
import { CredentialChainEditor } from "./CredentialChainEditor";

export function ProvidersPage() {
  const pid = useProjectId();
  const providersState = useAsync<Provider[]>(() => getProviders(pid), [pid], {
    isEmpty: (ps) => ps.length === 0,
  });
  const [creds, setCreds] = useState<Record<string, BackendCredentialStatus>>({});
  const [url, setUrl] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const reloadCreds = useCallback(
    () =>
      getCredentials()
        .then((cs) => setCreds(Object.fromEntries(cs.map((c) => [c.backend, c]))))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    reloadCreds();
  }, [reloadCreds]);

  async function onAdd() {
    if (!url.trim()) return;
    await installPackage(pid, url).catch(() => {});
    setUrl("");
    providersState.reload();
  }

  const btn = "rounded-md px-2.5 py-1 text-xs font-medium";
  const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  const badge = "rounded px-1.5 py-0.5 text-[10px] font-medium";

  function credBadge(name: string) {
    const c = creds[name];
    if (c?.resolved) {
      return <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ via {c.resolved_via}</span>;
    }
    return <span className={`${badge} bg-amber-100 text-amber-800`}>🔒 none</span>;
  }

  function ProviderRows({ providers }: { providers: Provider[] }) {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-3 py-2 font-medium">provider</th>
              <th className="px-3 py-2 font-medium">source</th>
              <th className="px-3 py-2 font-medium">installed</th>
              <th className="px-3 py-2 font-medium">recommended</th>
              <th className="px-3 py-2 font-medium">credential</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <Fragment key={p.name}>
                <tr className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{p.name}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted">{p.source}</td>
                  <td className="px-3 py-2">
                    {p.installed ? (
                      <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ installed</span>
                    ) : (
                      <span className="text-[10px] text-muted">not installed</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {p.recommended && (
                      <span className={`${badge} bg-st-ok-soft text-st-ok`}>✓ recommended</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {credBadge(p.name)}
                      <button
                        type="button"
                        aria-expanded={expanded === p.name}
                        onClick={() => setExpanded((cur) => (cur === p.name ? null : p.name))}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:text-fg"
                      >
                        {expanded === p.name ? "close" : "set credential"}
                      </button>
                    </span>
                  </td>
                </tr>
                {expanded === p.name && (
                  <tr className="border-b border-border/60 bg-accent/5">
                    <td colSpan={5} className="px-3 py-3">
                      <CredentialChainEditor
                        backend={p.name}
                        status={creds[p.name]}
                        onSaved={reloadCreds}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Providers</h2>
      <p className="max-w-2xl text-xs text-muted">
        LLM backends available to this project&apos;s agents. The <b>recommended</b> one is the
        most-used backend across your agents. Credentials are <b>per machine</b> and resolve through
        an ordered source chain (first that resolves wins).
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <input
          aria-label="add provider git url"
          placeholder="https://github.com/org/llm-backend.git"
          className={`min-w-0 flex-1 ${input}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={onAdd} className={`${btn} bg-accent text-accent-fg`}>
          Add provider
        </button>
      </div>

      <Async
        state={providersState}
        skeleton={
          <div
            className="space-y-2 rounded-lg border border-border bg-surface p-3"
            data-testid="providers-skeleton"
            aria-busy="true"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        }
        empty={
          <div className="rounded-lg border border-dashed border-border bg-surface px-3 py-4 text-center text-xs text-muted">
            No providers — add one above to get started.
          </div>
        }
      >
        {(providers) => <ProviderRows providers={providers} />}
      </Async>
    </div>
  );
}
```

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/providers/ProvidersPage.tsx web/src/providers/ProvidersPage.test.tsx
git commit -m "feat(web): Providers panel uses useAsync (skeleton/empty/error+retry)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: Health page — checks via `useAsync` + connectivity strip rewrite

**Files:**
- Modify: `web/src/health/HealthPage.tsx`
- Test: `web/src/health/HealthPage.test.tsx`

- [ ] **Step 1: Add a connectivity-reason test + a loading test** — append inside `describe("HealthPage", ...)` in `HealthPage.test.tsx`. Import `useStore` at the top (add `import { useStore } from "../store/store";`):

```ts
  it("surfaces a connectivity reason and last-contact, not just a flipped dot", async () => {
    useStore.setState({
      health: { gateway_ok: false, engine_ok: false, tau_bin: "x", tau_version: "1" },
      healthError: "503: Service Unavailable",
      healthCheckedAt: Date.now() - 120_000,
    });
    render(
      <ProjectProvider pid="demo">
        <HealthPage />
      </ProjectProvider>,
    );
    expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/503: Service Unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/last contact/i)).toHaveTextContent(/ago/);
  });

  it("distinguishes reachable-but-engine-down from unreachable", async () => {
    useStore.setState({
      health: { gateway_ok: true, engine_ok: false, tau_bin: "x", tau_version: "1" },
      healthError: null,
      healthCheckedAt: Date.now(),
    });
    render(
      <ProjectProvider pid="demo">
        <HealthPage />
      </ProjectProvider>,
    );
    expect(await screen.findByText(/gateway ok/i)).toBeInTheDocument();
    expect(screen.getByText(/engine down/i)).toBeInTheDocument();
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument();
  });
```

> The existing two tests stub `fetch` to resolve the checks report; they continue to pass because the checks data still renders (now via `useAsync`). Add `import { beforeEach }` is already present; add a `beforeEach` reset of the health fields so tests don't leak: at the top-level `beforeEach` (the one stubbing fetch) append `useStore.setState({ health: null, healthError: null, healthCheckedAt: null });`.

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: PASS to compile; new tests fail at runtime (no "unreachable" / "engine down" / "last contact" text) — confirming missing behavior.

- [ ] **Step 3: Implement** — `web/src/health/HealthPage.tsx`. Replace the local checks `useState`/`load` with `useAsync`, and rewrite the connectivity strip to read `health`, `healthError`, `healthCheckedAt`. Full file:

```tsx
import { useState } from "react";
import type { CheckReport } from "../types/CheckReport";
import type { CategoryStatus } from "../types/CategoryStatus";
import { getChecks } from "../api/checks";
import { useStore } from "../store/store";
import { useProjectId } from "../app/project-context";
import { useAsync } from "../app/useAsync";
import { Async } from "../app/Async";
import { Skeleton } from "../app/Skeleton";
import { relativeTime } from "../app/relative-time";

const SEV_CLASS: Record<string, string> = {
  error: "bg-st-error-soft text-st-error",
  "needs-setup": "bg-amber-100 text-amber-800",
  warning: "bg-st-running-soft text-st-running",
  pass: "bg-st-ok-soft text-st-ok",
};

function SeverityBadge({ severity, label }: { severity: string; label?: string }) {
  const cls = SEV_CLASS[severity] ?? SEV_CLASS.warning;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {label ?? severity}
    </span>
  );
}

function worst(c: CategoryStatus): "error" | "needs-setup" | "warning" | "pass" {
  if (c.errors > 0) return "error";
  if (c.needs_setup > 0) return "needs-setup";
  if (c.warnings > 0) return "warning";
  return "pass";
}

export function HealthPage() {
  const pid = useProjectId();
  const health = useStore((s) => s.health);
  const healthError = useStore((s) => s.healthError);
  const healthCheckedAt = useStore((s) => s.healthCheckedAt);
  const loadHealth = useStore((s) => s.loadHealth);
  const [filter, setFilter] = useState<string | null>(null);

  const checks = useAsync<CheckReport>(() => getChecks(pid), [pid]);

  // Re-run refreshes both the checks report and the connectivity strip it sits in.
  function rerun() {
    checks.reload();
    loadHealth(pid).catch(() => {});
  }

  const report = checks.status === "data" ? checks.data : null;
  const findings = report?.findings ?? [];
  const shown = filter ? findings.filter((f) => f.category === filter) : findings;

  // unreachable = the latest health fetch threw; engine-down = reached but engine_ok false.
  const unreachable = healthError != null;
  const gatewayLabel = unreachable ? "unreachable" : health?.gateway_ok ? "ok" : "down";
  const gatewayOk = !unreachable && !!health?.gateway_ok;
  const engineLabel = unreachable || !health ? "—" : health.engine_ok ? "ok" : "down";
  const engineOk = !unreachable && !!health?.engine_ok;

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-base font-semibold">Health / Checks</h2>

      {/* connectivity */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${gatewayOk ? "bg-st-ok" : "bg-st-error"}`} />
          gateway {gatewayLabel}
        </span>
        {unreachable && <span className="text-st-error">{healthError}</span>}
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${engineOk ? "bg-st-ok" : "bg-st-error"}`} />
          engine {engineLabel}
        </span>
        <span className="text-muted">
          last contact {healthCheckedAt ? relativeTime(healthCheckedAt) : "—"}
        </span>
        <span className="font-mono text-muted">tau {health?.tau_version || "—"}</span>
        <button
          onClick={rerun}
          className="ml-auto rounded-md border border-border px-2 py-0.5 text-xs font-semibold"
        >
          Re-run
        </button>
      </div>

      {/* checks */}
      <section className="space-y-2">
        <div className="text-[9px] uppercase text-muted">checks</div>
        <Async
          state={checks}
          skeleton={
            <div className="space-y-2" aria-busy="true" data-testid="checks-skeleton">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6" />
              ))}
            </div>
          }
          empty={<div className="text-xs text-muted">No findings.</div>}
        >
          {(rep) => (
            <>
              <div className="flex flex-wrap gap-2">
                {rep.categories.map((c) => {
                  const w = worst(c);
                  const total = c.errors + c.warnings + c.needs_setup;
                  const active = filter === c.name;
                  return (
                    <button
                      key={c.name}
                      aria-pressed={active}
                      onClick={() => setFilter(active ? null : c.name)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${
                        active ? "border-accent" : "border-border"
                      }`}
                    >
                      <SeverityBadge severity={w} label={w === "pass" ? "✓" : String(total)} />
                      <span className="font-medium">{c.name}</span>
                    </button>
                  );
                })}
              </div>

              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted">
                    <th className="py-1 pr-2 font-medium">severity</th>
                    <th className="px-2 py-1 font-medium">rule</th>
                    <th className="px-2 py-1 font-medium">summary</th>
                    <th className="px-2 py-1 font-medium">location</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f, i) => (
                    <tr key={`${f.rule}-${i}`} className="border-b border-border/60 align-top">
                      <td className="py-1 pr-2">
                        <SeverityBadge severity={f.severity} />
                      </td>
                      <td className="px-2 py-1 font-mono text-accent">{f.rule}</td>
                      <td className="px-2 py-1">
                        {f.summary}
                        {f.remediation && (
                          <div className="text-[10px] text-muted">↳ {f.remediation}</div>
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono text-muted">
                        {f.location
                          ? `${f.location.path}${f.location.line ? `:${f.location.line}` : ""}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-muted">
                        No findings.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </Async>
      </section>

      {/* sandbox */}
      <section className="space-y-1">
        <div className="text-[9px] uppercase text-muted">sandbox</div>
        <div className="text-xs">
          tier <span className="font-mono">{report?.sandbox.tier ?? "—"}</span>
          {" · "}
          <SeverityBadge
            severity={report?.sandbox.status === "ready" ? "pass" : "note"}
            label={report?.sandbox.status ?? "—"}
          />
          {report?.sandbox.no_sandbox && (
            <span className="ml-2 text-amber-800">⚠ running with --no-sandbox</span>
          )}
        </div>
      </section>

      {/* conformance (gated) */}
      <section className="space-y-1">
        <div className="flex items-center gap-2 text-[9px] uppercase text-muted">
          conformance
          <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">
            gated
          </span>
        </div>
        <div className="rounded-md border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Cross-target conformance — waits on tau β.6.
        </div>
      </section>
    </div>
  );
}
```

> Note: the existing "renders category chips + findings" test asserts findings text appears — still true (rendered inside the `data` slot). The "filters by category chip" test still works (filter state unchanged). The sandbox section now reads `report` only when `checks.status === "data"`; the existing report stub includes `sandbox`, so it renders.

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/health/HealthPage.tsx web/src/health/HealthPage.test.tsx
git commit -m "feat(web): Health page surfaces connectivity reason + last-contact, checks via useAsync (G5/D14)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12: Navbar + Footer dot tooltips

**Files:**
- Modify: `web/src/app/Navbar.tsx`
- Modify: `web/src/app/Footer.tsx`
- Test: `web/src/app/Footer.test.tsx` (add a title assertion)

- [ ] **Step 1: Add a Footer tooltip test** — append inside `describe("Footer", ...)` in `Footer.test.tsx`:

```ts
  it("explains the reason + last contact in the dot tooltip when down", () => {
    useStore.setState({
      health: { gateway_ok: false, engine_ok: false, tau_bin: "x", tau_version: "0.0.0-mock" },
      healthError: "Failed to fetch",
      healthCheckedAt: Date.now() - 60_000,
    });
    render(<Footer />);
    const dot = screen.getByTitle(/unreachable — Failed to fetch/i);
    expect(dot).toBeInTheDocument();
    expect(dot.getAttribute("title")).toMatch(/last ok/i);
  });
```

> Add a reset so this doesn't leak into the first test: at the top of the `describe`, the first test already calls `useStore.setState({ health: ... })` fully, so order independence holds; no extra reset needed.

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `cd web && pnpm typecheck`
Expected: PASS to compile; the new test fails at runtime (no element with that title).

- [ ] **Step 3a: Implement Footer** — `web/src/app/Footer.tsx`. Build a tooltip string and apply it via `title=`. Full file:

```tsx
import { useStore } from "../store/store";
import { relativeTime } from "./relative-time";

const REPO = "https://github.com/LEBOCQTitouan/tau-web-ui";

export function Footer() {
  const health = useStore((s) => s.health);
  const healthError = useStore((s) => s.healthError);
  const healthCheckedAt = useStore((s) => s.healthCheckedAt);
  const ok = (health?.gateway_ok ?? false) && healthError == null;

  const lastOk = healthCheckedAt ? ` · last ok ${relativeTime(healthCheckedAt)}` : "";
  const title = healthError
    ? `unreachable — ${healthError}${lastOk}`
    : ok
      ? `gateway reachable${lastOk}`
      : `gateway down${lastOk}`;

  return (
    <footer className="flex items-center gap-3 border-t border-border bg-surface px-4 py-1.5 text-[11px] text-muted">
      <span>tau-web-ui</span>
      <span>·</span>
      <span>tau {health?.tau_version ?? "—"}</span>
      <span>·</span>
      <span className="flex items-center gap-1.5" title={title}>
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-st-ok" : "bg-st-error"}`} />
        {ok ? "gateway ok" : "gateway down"}
      </span>
      <span className="ml-auto flex gap-3">
        <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-fg">
          GitHub
        </a>
        <a href={`${REPO}/tree/main/docs`} target="_blank" rel="noreferrer" className="hover:text-fg">
          docs
        </a>
      </span>
    </footer>
  );
}
```

> Behavior preserved: the existing test asserts the visible text "gateway ok" when `gateway_ok: true` (and `healthError` defaults to `null` after `setState`, so `ok` is true). Confirm by re-reading the first Footer test — it sets only `health`, leaving `healthError` at its store default `null`. ✓

- [ ] **Step 3b: Implement Navbar** — `web/src/app/Navbar.tsx`. Enrich the existing dot `title`. Read the extra store fields and build the tooltip. Apply minimal edits:

Add to the selectors block (after `const project = useStore((s) => s.project);`):

```tsx
  const health = useStore((s) => s.health);
  const healthError = useStore((s) => s.healthError);
  const healthCheckedAt = useStore((s) => s.healthCheckedAt);
```

Add an import at the top:

```tsx
import { relativeTime } from "./relative-time";
```

Replace the trailing status dot block (the `<span title={project ? ...} .../>`) with:

```tsx
      {(() => {
        const lastOk = healthCheckedAt ? ` · last ok ${relativeTime(healthCheckedAt)}` : "";
        const engineUp = !!health?.engine_ok && healthError == null;
        const title = healthError
          ? `unreachable — ${healthError}${lastOk}`
          : engineUp
            ? `engine reachable${lastOk}`
            : `no engine${lastOk}`;
        return (
          <span
            title={title}
            className={`h-2.5 w-2.5 rounded-full ${project ? "bg-st-ok" : "bg-st-error"}`}
          />
        );
      })()}
```

> The dot **color** stays keyed on `project` (unchanged — preserves existing Navbar tests, which don't set health). Only the `title` is enriched.

- [ ] **Step 4: Verify** — `cd web && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/Navbar.tsx web/src/app/Footer.tsx web/src/app/Footer.test.tsx
git commit -m "feat(web): Navbar/Footer dots explain reason + last-contact via title tooltip (G5)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (whole-PR gate)

- [ ] **Run the full local gate:**

```bash
cd web && pnpm typecheck && pnpm lint && pnpm format:check && pnpm build
```
Expected: all PASS. (Vitest runs in CI on node@20; `pnpm test` is not runnable locally — see Conventions.)

- [ ] **Confirm clean tree & review the diff against main:**

```bash
git status --short
git diff --stat origin/main...
```

- [ ] Proceed to `requesting-code-review`, then open the PR:
  `gh pr create -R tau-rs/tau-web-ui --base main` citing **D14**, **G4**, **G5**. STOP — no merge.

---

## Self-Review (author checklist — done at plan-writing time)

- **Spec coverage:**
  - ErrorBoundary (root + per-route, recoverable, reports) → Tasks 6, 7. ✓
  - `useAsync` 4-state hook + `<Async>` + skeletons → Tasks 3, 4, 5. ✓
  - Dashboard first-load (store change) → Tasks 8, 9. ✓
  - Providers loading/empty/error → Task 10. ✓
  - Health connectivity (reason, last-contact, unreachable vs engine-down) + checks loading → Tasks 8, 11. ✓
  - Navbar/Footer dot tooltips → Task 12. ✓
  - Reuse `surfaceError`/`errorMessage` → Task 1, used in 4, 6, 8. ✓
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `AsyncState<T>`/`UseAsyncResult<T>` defined in Task 4 and consumed unchanged in Tasks 5, 10, 11. Store fields `runsLoaded`/`runsError`/`healthError`/`healthCheckedAt` defined in Task 8 and read in Tasks 9, 11, 12. `relativeTime` (Task 2) used in 11, 12. `errorMessage` (Task 1) used in 4, 8. Consistent. ✓
- **Out of scope (not implemented):** silent `.catch` mutation sweep (brief 06 follow-up); loading/error for unlisted pages; dot color-semantics changes.
```
