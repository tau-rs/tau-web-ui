# Loading states, error boundary, and connectivity detail

**Date:** 2026-06-11
**Audit findings:** D14 (design — no loading states / no error boundary), G4
(diagnostics — no error boundary), G5 (diagnostics — connectivity reduced to two
unexplained dots).
**Brief:** `audit-remediation/briefs/55-tau-ui-loading-error-boundary-connectivity.md`

## Problem

Three related "perceived-empty / opaque-outage / no-failure-detail" gaps:

1. **No loading states.** Every page renders its final layout immediately with
   empty data. A slow or unreachable gateway looks identical to a genuinely
   empty project (compounds D10). Health-checks and Providers fetch locally with
   `.then(set).catch(() => {})` starting from empty arrays; the Dashboard reads
   `runs` from the zustand store via `usePollRuns`, which does not track whether
   the first fetch has completed.
2. **No error boundary.** `<App/>` is mounted bare in `main.tsx`. Any render-time
   throw (e.g. an optimistic `as Record<string, unknown>` cast in
   `SpanInspector.tsx` breaking) unmounts the whole React tree — the user sees a
   blank page with only a console trace.
3. **Connectivity reduced to two unexplained dots.** Health is a green/red dot in
   the Navbar/Footer plus the Health strip. `loadHealth` swallows its error, so
   there is no surfaced reason (timeout? 500? wrong port?), no last-error text,
   and no last-successful-contact timestamp. "Unreachable" and "reachable but
   engine down" are indistinguishable.

## Scope decisions

- **One PR** covering all three concerns, structured so the ErrorBoundary is a
  self-contained, independently reviewable piece.
- **Dashboard gets the full first-load treatment** (a small store change), not a
  follow-up.
- **Connectivity detail reaches the Navbar/Footer dots** (via `title=` tooltips),
  not just the Health page.
- Reuse the shared `surfaceError` helper from brief 06 (already landed in
  `notify/notify.ts`). Do **not** re-fix the silent `.catch` sweep — that is
  brief 06's follow-up. No unrelated refactors. Match existing tau-ui style.

## Design

### 1. ErrorBoundary (D14, G4)

`web/src/app/ErrorBoundary.tsx` — a class component (React error boundaries must
be classes) implementing `getDerivedStateFromError` + `componentDidCatch`.

- On catch: call `surfaceError("UI crashed", error)` (logs to console **and**
  toasts), then render a recoverable fallback.
- Fallback: a centered card — "Something went wrong", the error message, a
  **Try again** button (resets boundary state to re-render children) and a
  **Reload** button (`location.reload()`).
- The boundary accepts an optional `resetKey` prop; when it changes, the boundary
  clears its error state (used for per-route reset).

Two placements:

- **Top-level** in `main.tsx`, wrapping `<App/>` — last-resort catch so a throw
  never blanks the whole SPA.
- **Per-route** in `AppShell.tsx`, wrapping `<main><Outlet/></main>` with
  `resetKey={useLocation().key}` — one page throwing keeps the Sidebar / Navbar /
  Footer alive, and navigating away auto-recovers.

### 2. `useAsync` loading-state hook + `<Async>` panel (D14)

`web/src/app/useAsync.ts` — the 4-state model from the brief:

```ts
type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "empty" }
  | { status: "data"; data: T };

function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  opts?: { isEmpty?: (d: T) => boolean },
): AsyncState<T> & { reload: () => void };
```

- Re-runs `fetcher` when `deps` change; a mounted-ref guard prevents `setState`
  after unmount and ignores stale results under StrictMode's double-invoke.
- On success → `empty` (when `opts.isEmpty(data)` is true) else `data`.
- On failure → `error` with the message via `errorMessage(err)`, and
  `console.error` for diagnostics. It does **not** toast: a failed read is
  surfaced inline by the panel, distinct from brief 06's mutation-toast pattern.
- `reload()` re-runs the fetcher on demand.

`web/src/app/Async.tsx` — presentational wrapper:

```tsx
<Async state={state} skeleton={<Skeleton…/>} empty={<EmptyState…/>}>
  {(data) => <Content data={data} />}
</Async>
```

Renders: `loading` → `skeleton`; `error` → reason text + a **Retry** button wired
to `state.reload`; `empty` → `empty` slot; `data` → `children(data)`.

`web/src/app/Skeleton.tsx` — a small shimmer-block primitive used to compose
page-specific skeletons (table rows, stat cards).

### 3. Store changes (D14 dashboard, G5 connectivity)

`web/src/store/store.ts`:

- **Runs first-load.** Add `runsLoaded: boolean` (init `false`) and
  `runsError: string | null` (init `null`). `refreshRuns` wraps the fetch:
  - success → `set({ runs, runsLoaded: true, runsError: null })`
  - failure → `set({ runsLoaded: true, runsError: errorMessage(e) }); throw e`
    (preserves the existing throw-and-caller-`.catch` contract; only records
    status as a side effect). `runsLoaded` flips on the first settle (success or
    failure), so the Dashboard can show skeleton → data / empty / error.
- **Health connectivity.** Add `healthError: string | null` and
  `healthCheckedAt: number | null`. `loadHealth`:
  - success → `set({ health, healthError: null, healthCheckedAt: Date.now() })`
  - failure → `set({ healthError: errorMessage(e) })`, **keeping** the last
    `health` snapshot and `healthCheckedAt`.

  This distinguishes **unreachable** (`healthError != null` — the fetch threw:
  wrong port / timeout / 5xx) from **reachable-but-engine-down**
  (`health.gateway_ok && !health.engine_ok`, `healthError == null`).

`web/src/notify/notify.ts` — export `errorMessage(err: unknown): string`
(factoring out the `err instanceof Error ? err.message : String(err)` line that
`surfaceError` already contains) so the store and `useAsync` share it.

### 4. Connectivity surfaces (G5)

- **HealthPage strip** rewritten:
  - gateway: `ok` / **`unreachable` + reason** / `down`
  - engine: `ok` / `down` / `—` (unknown, when unreachable)
  - **"last contact <rel>"** from `healthCheckedAt`, via a `relative-time.ts`
    helper (`"just now"`, `"2m ago"`, `"—"` when never contacted).
  - The checks table moves onto `useAsync` (skeleton rows → table / "No findings"
    / inline error + retry).
- **ProvidersPage** providers fetch → `useAsync` (skeleton rows → table /
  "No providers" / error + retry). The secondary credentials fetch is unchanged.
- **DashboardPage** → skeleton stat-cards / panels until `runsLoaded`; then data,
  "No runs yet" (empty), or an inline error from `runsError`.
- **Navbar + Footer dots** → enriched `title=` tooltip:
  `unreachable — <reason> · last ok <rel>` when down, `engine reachable` when up.
  Dot colors are unchanged — no layout change, no existing-test regressions.

### `relative-time.ts`

`web/src/app/relative-time.ts` — `relativeTime(ts: number, now = Date.now())`
returning `"just now"`, `"<n>s ago"`, `"<n>m ago"`, `"<n>h ago"`, or a short
absolute fallback for older timestamps. Pure and unit-testable.

## Testing (TDD — failing first, then implement)

Required by the brief:

1. **ErrorBoundary** — a child that throws renders the fallback instead of
   unmounting the tree, **and** the error is reported (`surfaceError` /
   `console.error` invoked).
2. **Loading distinct from empty** — a panel in flight shows a loading/skeleton
   state distinct from the empty state (`useAsync` + a page such as Providers or
   Health-checks).
3. **Failed `loadHealth` surfaces a reason** — a rejected health fetch renders a
   reason on the strip (e.g. "unreachable — …"), not just a flipped dot.

Additional unit tests:

- `useAsync` — loading → data, loading → empty (via `isEmpty`), loading → error,
  and `reload`.
- `relative-time` — boundary values.
- Dashboard — skeleton before first `runsLoaded`, then data vs "No runs yet".

## Files

**New:** `app/ErrorBoundary.tsx`, `app/useAsync.ts`, `app/Async.tsx`,
`app/Skeleton.tsx`, `app/relative-time.ts` (+ colocated tests).

**Changed:** `main.tsx`, `app/AppShell.tsx`, `store/store.ts`, `notify/notify.ts`,
`health/HealthPage.tsx`, `providers/ProvidersPage.tsx`,
`dashboard/DashboardPage.tsx`, `app/Navbar.tsx`, `app/Footer.tsx`.

## Out of scope

- The silent `.catch(() => {})` sweep across mutation call-sites (brief 06
  follow-up).
- Re-styling the dots or changing their color semantics.
- Loading/error treatment for pages not named in the finding (Agents, Tools,
  Config, Runs, Trace, Ship, Graph) — the hook/boundary make these easy follow-ups
  but they are not in this cluster.
