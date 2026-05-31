# App shell + navigation (navbar · sidebar menu · footer) — design

**Date:** 2026-05-31
**Status:** Approved (brainstorm), pending spec review → writing-plans
**Scope:** Restructure the tau-web-ui frontend shell into a navbar + left sidebar menu + footer, introduce URL routing (React Router), and convert the current store-driven view switch into routed pages. Dashboard and Health are stub pages now; the real Dashboard is a later effort this seam prepares for.

## 0. Decisions (locked in brainstorm)
- **Layout:** "A · Labeled sidebar" — ~130px left menu (icon + label), top navbar in the content column, full-width footer at the bottom. Slate Compact / Tailwind.
- **Routing:** `react-router-dom` v6 (URL routes, deep-linkable trace).
- **Menu items:** Dashboard (stub) · Runs (real) · Health (stub).
- **Footer:** tau version + gateway status + GitHub/docs links.
- **Default landing:** `/` → `/runs` (flip to `/dashboard` once it has content).

## 1. Architecture
`main.tsx` wraps the app in `<BrowserRouter>`. `App.tsx` declares the route table with a single layout route:

```
/            → <Navigate to="/runs" replace/>
/dashboard   → DashboardPage   (stub)
/runs        → RunsPage        (Launcher + RunsTable)
/runs/:id    → TracePage       (TraceView for that run — deep-linkable)
/health      → HealthPage      (stub)
*            → <Navigate to="/runs" replace/>
```

All routes render inside `AppLayout`, which provides the chrome via `<Outlet/>`. Vite's dev server already does SPA history-fallback, so deep links and refreshes work in dev and `vite preview`; no extra config needed (the app is served by Vite, not the gateway).

## 2. Components (all Tailwind, Slate Compact tokens)
Files under `web/src/app/` unless noted.

- **`AppLayout.tsx`** — the shell. Grid: a top row of `[Sidebar | (Navbar + <Outlet/>)]` and a full-width `Footer` beneath. On mount, triggers `loadProject()` + `loadHealth()` (once). One responsibility: layout + global data bootstrap.
- **`Sidebar.tsx`** — brand block + three `NavLink`s (Dashboard `/dashboard`, Runs `/runs`, Health `/health`). Active link styled with the violet accent via `NavLink`'s `isActive` render prop. `/runs/:id` keeps "Runs" active (NavLink `to="/runs"` matches the `/runs` prefix when not `end`).
- **`Navbar.tsx`** — replaces today's `ProjectBar`. Left: the current page title (derived from `useLocation().pathname`; for `/runs/:id` show `Trace · {currentTrace?.run.agent_id ?? "…"}`). Right: `project?.project_path`, an engine status dot (green if `project` loaded else red), and `tau {project?.tau_version}`.
- **`Footer.tsx`** — left: `tau-web-ui`. Center/right: `tau {health?.tau_version}`, a `gateway ok`/`engine down` status from `health`, and links to the GitHub repo (`https://github.com/LEBOCQTitouan/tau-web-ui`) and `/docs` (the repo `docs/` — a plain external link for now).
- **Pages:**
  - `dashboard/DashboardPage.tsx` — stub: a centered "Dashboard — coming soon" card. Holds the seam for the future dashboard.
  - `health/HealthPage.tsx` — stub: "Health checks — coming soon" (maps to deferred surface ⑥).
  - `runs/RunsPage.tsx` — renders the existing `RunsView` (Launcher + RunsTable). Row click navigates (see §3).
  - `trace/TracePage.tsx` — reads `:id` via `useParams`, calls `openTrace(id)` in an effect (re-runs when `id` changes), cleans up via `closeTrace()` on unmount, and renders `TraceView`.

## 3. Navigation / data-flow changes
- **Row click → URL.** `RunsTable`'s `onOpen` is wired by `RunsView` to `useNavigate()` → `navigate('/runs/'+id)`. `RunsTable` itself is unchanged (still takes an `onOpen(id)` callback).
- **`launch()` decoupled from navigation.** Today `launch` calls `refreshRuns` + `openTrace`. New: `launch` creates the run, calls `refreshRuns`, and returns the `run_id` — nothing else. The **Launcher** component does `const id = await launch(...); navigate('/runs/'+id)`. This keeps the store free of navigation concerns. `TracePage` opens the trace from the URL on arrival.
- **`TraceView` back button.** "← Back to runs" uses `useNavigate()` → `navigate('/runs')` (text preserved). WS cleanup still happens via `TracePage`'s unmount → `closeTrace()`.
- **Store additions/edits** (`store.ts`):
  - Add `health: Health | null` + `loadHealth: () => Promise<void>` (calls `getHealth()` from the API client, swallows errors).
  - `launch` returns `run_id` after `refreshRuns()` only (remove the internal `openTrace` call).
  - `openTrace`/`closeTrace`/`currentTrace`/`selectedSpanId`/`assistantText`/`applyWs` stay as-is (now driven by `TracePage` instead of `App`).
- **`App.tsx`** loses the `currentTrace !== null` switch entirely; it becomes the `<Routes>` table.

## 4. Testing
- **Rename/refactor:** `ProjectBar` → `Navbar`; move `ProjectBar.test.tsx` → `Navbar.test.tsx` (same assertions: project path + tau version from the store; wrap in `<MemoryRouter>` since Navbar uses `useLocation`).
- **New unit tests** (wrap router-aware components in `<MemoryRouter>`):
  - `Sidebar.test.tsx` — renders Dashboard/Runs/Health links with correct `href`s.
  - `Footer.test.tsx` — renders tau version + a gateway status + GitHub link (inject `health` via `useStore.setState`).
  - `routing.test.tsx` — `MemoryRouter initialEntries={['/runs']}` renders the Launcher (agent select); `['/runs/R1']` mounts TracePage (calls `openTrace`); `['/dashboard']` renders the Dashboard stub text.
- **Store test:** add a case asserting `launch` no longer sets `currentTrace` (navigation is the component's job) — adjust the existing store test only if it asserted the old `openTrace`-within-`launch` behavior.
- **Preserve for e2e:** the agent select (`aria-label="agent"`), prompt (`aria-label="prompt"`), `Run`, the run row click target, the `fs-read` node, the `completed`/`cancelled` badges, the `Cancel` button, and `← Back to runs` text. The Playwright spec is unchanged in intent: `goto('/')` redirects to `/runs`; launching navigates to `/runs/:id`; clicking a run row navigates to its trace; back returns to `/runs`. Update the spec only if a *visible* string/role changed (it shouldn't).
- All existing unit + e2e tests must stay green; new tests added per above.

## 5. Acceptance criteria
1. The app shows a persistent left sidebar (Dashboard/Runs/Health, active item highlighted), a top navbar (page title + project/engine/version), and a bottom footer (version + gateway status + links) on every route.
2. URLs work: `/runs` lists runs; clicking a run goes to `/runs/:id` and renders its trace; pasting/refreshing a `/runs/:id` URL loads that trace directly (deep link); browser back returns to `/runs`; unknown paths redirect to `/runs`.
3. Dashboard and Health routes render visible "coming soon" stubs.
4. Footer status reflects gateway health (green when reachable).
5. Every pre-existing unit + e2e test still passes; new Sidebar/Footer/routing/Navbar tests pass.

## 6. Non-goals (YAGNI)
- No real Dashboard content/metrics/widgets (next effort).
- No real Health/checks content (gated on deferred surface ⑥).
- No auth, no collapsible/resizable sidebar, no breadcrumb system beyond the page title, no theme toggle.

## 7. File-change summary
- **New:** `web/src/app/AppLayout.tsx`, `Sidebar.tsx`, `Navbar.tsx`, `Footer.tsx`; `web/src/dashboard/DashboardPage.tsx`; `web/src/health/HealthPage.tsx`; `web/src/runs/RunsPage.tsx`; `web/src/trace/TracePage.tsx`; tests `Navbar.test.tsx`, `Sidebar.test.tsx`, `Footer.test.tsx`, `app/routing.test.tsx`.
- **Modified:** `web/package.json` (+`react-router-dom`), `web/src/main.tsx` (`<BrowserRouter>`), `web/src/App.tsx` (routes), `web/src/store/store.ts` (`health`/`loadHealth`, `launch` decoupled), `web/src/runs/RunsView.tsx` (navigate on open), `web/src/runs/Launcher.tsx` (navigate after launch), `web/src/trace/TraceView.tsx` (back button → navigate).
- **Removed:** `web/src/app/ProjectBar.tsx` (+ its test) — superseded by `Navbar.tsx`.
