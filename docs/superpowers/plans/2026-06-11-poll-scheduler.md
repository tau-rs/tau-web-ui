# Centralized Runs Poll Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `usePollRuns`'s per-component 5s intervals with a single store-side scheduler (ref-counted, visibility-paused, error-backoff) plus an in-flight guard on `refreshRuns`.

**Architecture:** All polling bookkeeping lives in closure variables inside the zustand `create()` factory in `web/src/store/store.ts`. `refreshRuns` gains a shared-promise in-flight guard. A new `subscribeRuns(pid, ms)` store action ref-counts subscribers and drives one self-rescheduling `setTimeout` loop that pauses on `document.hidden` and backs off on error. `usePollRuns` becomes a thin subscribe/unsubscribe hook; its two call sites are unchanged.

**Tech Stack:** TypeScript, zustand, React, vitest (jsdom, fake timers).

---

### Task 1: In-flight guard on `refreshRuns`

**Files:**
- Modify: `web/src/store/store.ts` (add closure var; replace `refreshRuns` body at line ~91)
- Test: `web/src/store/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `web/src/store/store.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { useStore } from "./store";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("store.refreshRuns in-flight guard", () => {
  it("dedups overlapping calls so a slow response is not clobbered", async () => {
    const d = deferred<{ ok: true; json: () => Promise<unknown[]> }>();
    const fetchMock = vi.fn().mockReturnValue(d.promise);
    vi.stubGlobal("fetch", fetchMock);

    const s = useStore.getState();
    const p1 = s.refreshRuns("demo");
    const p2 = s.refreshRuns("demo"); // called while the first is still in flight

    expect(fetchMock).toHaveBeenCalledTimes(1); // second call did NOT start a new fetch

    d.resolve({ ok: true, json: async () => [{ id: "a" } as never] });
    await Promise.all([p1, p2]);

    expect(useStore.getState().runs).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/store/store.test.ts -t "in-flight guard"`
Expected: FAIL — `fetchMock` called twice (no guard yet).

- [ ] **Step 3: Write minimal implementation**

In `web/src/store/store.ts`, add a closure variable inside the `create()` factory (just before the returned object literal, after the `create<AppStore>((set, get) => {` — note this requires converting the arrow body to a block that `return`s the object):

```ts
export const useStore = create<AppStore>((set, get) => {
  // --- runs polling bookkeeping (non-reactive: must not trigger re-renders) ---
  let runsInFlight: Promise<void> | null = null;

  return {
    // ...unchanged fields...
```

Replace the `refreshRuns` line:

```ts
  refreshRuns: (pid, filters) => {
    if (runsInFlight) return runsInFlight; // dedup overlapping calls
    runsInFlight = listRuns(pid, filters)
      .then((runs) => void set({ runs }))
      .finally(() => {
        runsInFlight = null;
      });
    return runsInFlight;
  },
```

Close the factory: change the final `}));` to `};\n});`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/store/store.test.ts`
Expected: PASS (all existing store tests still pass too).

- [ ] **Step 5: Typecheck + commit**

```bash
cd web && pnpm tsc -p tsconfig.json --noEmit && pnpm prettier --write src/store/store.ts src/store/store.test.ts
git add web/src/store/store.ts web/src/store/store.test.ts
git commit -m "fix(store): guard refreshRuns against overlapping in-flight requests (audit D4)"
```

---

### Task 2: Ref-counted scheduler with visibility pause + backoff

**Files:**
- Modify: `web/src/store/store.ts` (add `subscribeRuns` to `AppStore` interface + implement scheduler)
- Test: `web/src/store/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/store/store.test.ts`:

```ts
const okFetch = () =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => [] as unknown[] });
const errFetch = () =>
  vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });

describe("store.subscribeRuns scheduler", () => {
  it("two subscribers share one interval (one GET /runs per tick)", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const s = useStore.getState();
    const un1 = s.subscribeRuns("demo", 5000);
    const un2 = s.subscribeRuns("demo", 5000);

    await vi.advanceTimersByTimeAsync(0); // flush the immediate tick
    fetchMock.mockClear();

    await vi.advanceTimersByTimeAsync(5000); // one interval
    expect(fetchMock).toHaveBeenCalledTimes(1); // ONE request, not two

    un1();
    un2();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not poll while the tab is hidden", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });

    const un = useStore.getState().subscribeRuns("demo", 5000);
    await vi.advanceTimersByTimeAsync(20000); // 4 intervals, tab hidden the whole time
    expect(fetchMock).not.toHaveBeenCalled();

    un();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("backs off on repeated errors instead of polling every interval", async () => {
    const fetchMock = errFetch();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const un = useStore.getState().subscribeRuns("demo", 1000); // base 1s

    await vi.advanceTimersByTimeAsync(0); // t=0 immediate tick fails -> next at +2000
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // t=1000: no tick (backed off)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // t=2000: tick fails -> next at +4000
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999); // t=5999: still backed off
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); // t=6000: third tick
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // base-interval polling would have fired ~7 times by t=6000; backoff fired 3.

    un();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm vitest run src/store/store.test.ts -t "scheduler"`
Expected: FAIL — `subscribeRuns is not a function`.

- [ ] **Step 3: Add `subscribeRuns` to the `AppStore` interface**

In `web/src/store/store.ts`, in the `interface AppStore`, after the `refreshRuns` declaration add:

```ts
  /** Subscribe to live runs polling. First subscriber starts one shared,
   *  visibility-paused, error-backoff interval; returns an unsubscribe fn. */
  subscribeRuns: (pid: string, ms?: number) => () => void;
```

- [ ] **Step 4: Implement the scheduler**

In the `create()` factory, extend the bookkeeping block from Task 1:

```ts
  // --- runs polling bookkeeping (non-reactive: must not trigger re-renders) ---
  let runsInFlight: Promise<void> | null = null;
  let pollers = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let pollPid = "";
  let pollMs = 5000;
  const MAX_BACKOFF_MS = 60_000;

  const nextDelay = () =>
    failures === 0 ? pollMs : Math.min(pollMs * 2 ** failures, MAX_BACKOFF_MS);

  const scheduleNext = (delay: number) => {
    timer = setTimeout(runTick, delay);
  };

  async function runTick() {
    timer = null;
    if (typeof document !== "undefined" && document.hidden) {
      scheduleNext(pollMs); // paused while hidden — re-check at base interval
      return;
    }
    try {
      await get().refreshRuns(pollPid);
      failures = 0;
    } catch {
      failures += 1;
    }
    if (pollers > 0) scheduleNext(nextDelay());
  }

  const onVisible = () => {
    if (pollers > 0 && !document.hidden && timer !== null) {
      clearTimeout(timer);
      void runTick(); // refresh promptly when the tab is refocused
    }
  };
```

Add `subscribeRuns` to the returned object (place it right after `refreshRuns`):

```ts
  subscribeRuns: (pid, ms = 5000) => {
    pollPid = pid;
    pollMs = ms;
    pollers += 1;
    if (pollers === 1) {
      failures = 0;
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisible);
      }
      scheduleNext(0); // immediate first tick (honours the hidden check)
    }
    return () => {
      pollers -= 1;
      if (pollers === 0) {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        failures = 0;
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisible);
        }
      }
    };
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && pnpm vitest run src/store/store.test.ts`
Expected: PASS (all scheduler tests + existing tests).

- [ ] **Step 6: Typecheck, format + commit**

```bash
cd web && pnpm tsc -p tsconfig.json --noEmit && pnpm prettier --write src/store/store.ts src/store/store.test.ts
git add web/src/store/store.ts web/src/store/store.test.ts
git commit -m "feat(store): single ref-counted runs poll scheduler with visibility pause + backoff (audit D4)"
```

---

### Task 3: Rewire `usePollRuns` to subscribe

**Files:**
- Modify: `web/src/runs/usePollRuns.ts`
- Verify (no change): `web/src/dashboard/DashboardPage.tsx:26`, `web/src/runs/RunsView.tsx:16`

- [ ] **Step 1: Replace the hook body**

Rewrite `web/src/runs/usePollRuns.ts` in full:

```ts
import { useEffect } from "react";
import { useStore } from "../store/store";
import { useProjectId } from "../app/project-context";

/** Subscribe to the shared runs poller while mounted. Many consumers share one
 *  interval (ref-counted in the store); polling pauses while the tab is hidden
 *  and backs off on error. */
export function usePollRuns(ms = 5000) {
  const subscribeRuns = useStore((s) => s.subscribeRuns);
  const pid = useProjectId();
  useEffect(() => subscribeRuns(pid, ms), [subscribeRuns, ms, pid]);
}
```

- [ ] **Step 2: Run the full suite + typecheck**

Run: `cd web && pnpm tsc -p tsconfig.json --noEmit && pnpm vitest run`
Expected: PASS — including `DashboardPage.test.tsx` and `RunsView.filter.test.tsx`, which render components that call `usePollRuns()`.

- [ ] **Step 3: Lint, format + commit**

```bash
cd web && pnpm prettier --write src/runs/usePollRuns.ts && pnpm eslint src/runs/usePollRuns.ts src/store/store.ts
git add web/src/runs/usePollRuns.ts
git commit -m "refactor(runs): usePollRuns subscribes to the shared scheduler (audit D4)"
```

---

## Notes for the executor

- **Local node is v26; Vitest needs node@20 — it may not run locally. Rely on CI for the test run.** `tsc`, `eslint`, `prettier`, and `build` all work under node 26. If `pnpm vitest run` fails to start locally, record that and confirm green via CI on the PR.
- Use `pnpm` (the repo's package manager), not npm.
- The in-flight guard returns the shared promise, so rejection still propagates to `launch` / `launchWorkflow` callers — behavior preserved.
