# Centralized runs poll scheduler — design

**Date:** 2026-06-11
**Finding:** audit `design.md` D4 (MEDIUM) — `usePollRuns` runs duplicate 5s
intervals; no shared scheduler, no visibility pause, no backoff, no in-flight
dedup.

## Problem

Each component that wants live runs calls `usePollRuns()`, which creates its
**own** `setInterval(refreshRuns, 5000)`:

```ts
// web/src/runs/usePollRuns.ts
refreshRuns(pid).catch(() => {});
const t = setInterval(() => refreshRuns(pid).catch(() => {}), ms);
return () => clearInterval(t);
```

When a view mounts both `DashboardPage` and `RunsView`, two intervals hit
`GET /runs` in parallel, each `set({ runs })` clobbering the other. There is:

- **no dedup** — N consumers ⇒ N intervals ⇒ N parallel requests per tick;
- **no visibility check** — polls every 5s even while the tab is hidden;
- **no backoff** — a down gateway is hammered every 5s forever;
- **no in-flight guard** — `refreshRuns` (`store.ts:91`) starts a new fetch each
  tick; a slow response can be clobbered by the next tick (last-write-wins race).

## Goal

Smallest change that gives **one interval + dedup + visibility pause + backoff +
in-flight guard**, while keeping both `usePollRuns()` call sites working through a
minimal subscribe API. No store restructuring beyond the scheduler + guard.

## Design

### 1. In-flight guard on `refreshRuns` (store action)

Replace the fire-a-fetch-every-call body with a shared-promise guard. A second
call while one is in flight returns the **same** promise instead of starting a
competing fetch, so a slow response can't be clobbered by the next tick:

```ts
let runsInFlight: Promise<void> | null = null;

refreshRuns: (pid, filters) => {
  if (runsInFlight) return runsInFlight;          // dedup overlapping calls
  runsInFlight = listRuns(pid, filters)
    .then((runs) => void set({ runs }))
    .finally(() => { runsInFlight = null; });
  return runsInFlight;
},
```

`runsInFlight` lives as a closure variable in the `create()` factory (not in
reactive state — it must not trigger re-renders). Rejection still propagates to
awaiters, preserving today's `launch` / `launchWorkflow` semantics.

### 2. Store-side scheduler with ref-counted subscribers

A single self-rescheduling `setTimeout` loop, started by the first subscriber and
stopped by the last. Bookkeeping lives in closure variables alongside
`runsInFlight`. New store action:

```ts
subscribeRuns(pid: string, ms?: number): () => void;   // returns unsubscribe
```

- `subscribeRuns` increments a `pollers` ref-count, records `currentPid` / `ms`.
  On the **0→1** edge it starts the loop (immediate refresh + bind a
  `visibilitychange` listener + schedule the next tick). Returns an unsubscribe
  that decrements; on the **1→0** edge it stops the loop (clear timer, unbind
  listener, reset backoff/in-flight bookkeeping).
- The tick: if `document.hidden`, skip the fetch and reschedule at base interval
  (paused while hidden). Otherwise `await refreshRuns(currentPid)`; on success
  reset `failures = 0`; on error `failures += 1`. Then schedule the next tick at
  `nextDelay()`.
- `nextDelay()` = base `ms` when healthy; on failure exponential backoff
  `min(ms * 2 ** failures, 60_000)` (5s → 10s → 20s → 40s → 60s cap).
- `visibilitychange → visible` clears the pending timer and ticks promptly so the
  UI refreshes the moment the tab is refocused.

### 3. `usePollRuns` becomes a thin subscribe hook

```ts
export function usePollRuns(ms = 5000) {
  const subscribeRuns = useStore((s) => s.subscribeRuns);
  const pid = useProjectId();
  useEffect(() => subscribeRuns(pid, ms), [subscribeRuns, ms, pid]);
}
```

Call sites (`DashboardPage.tsx:26`, `RunsView.tsx:16`) are unchanged — same
`usePollRuns()` signature. Two mounted consumers ⇒ `pollers === 2` ⇒ one loop ⇒
one `GET /runs` per tick.

## Component boundaries

| Unit | Purpose | Depends on |
| --- | --- | --- |
| `refreshRuns` | fetch + set runs once, dedup overlaps | `listRuns`, `set` |
| scheduler (`subscribeRuns` + closure loop) | one interval, ref-count, visibility, backoff | `refreshRuns`, `document`, `setTimeout` |
| `usePollRuns` | subscribe on mount / unsubscribe on unmount | `subscribeRuns`, `useProjectId` |

## Testing (TDD — vitest fake timers)

1. **In-flight guard**: two `refreshRuns` calls while the first is unresolved ⇒
   `listRuns` (fetch to `/runs`) called **once**; the slow response sets `runs`
   once, not clobbered.
2. **Dedup**: two `subscribeRuns` ⇒ advancing one interval triggers **one**
   `GET /runs`, not two.
3. **Visibility pause**: with `document.hidden = true`, advancing intervals issues
   **no** fetch; flipping to visible resumes.
4. **Backoff**: failing fetches ⇒ requests spaced by growing delays, far fewer
   than base-interval count over a fixed window.

`tsc` green, `vitest` green (CI runs node@20; local node is 26 — rely on CI for
the run, verify tsc/eslint/build locally).

## Out of scope

Per-filter polling, WebSocket-based live runs, multi-project concurrent
schedulers, and any store changes beyond the scheduler + guard.
