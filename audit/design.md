# Design findings — tau-web-ui

## Code design

### D1 — Active project is a module-level mutable global, mutated during render
**Severity:** High
**Location:** `web/src/api/client.ts:23-30`, `web/src/app/ProjectScope.tsx:15-17`, `web/src/store/store.ts:83-86`

The scoped API prefix lives in a single module-level `let activeProject = ""`
(`client.ts:23`). It is set from three places: the zustand store, and — critically —
**synchronously during `ProjectScope`'s render body** (`ProjectScope.tsx:17`,
`if (pid) setClientProject(pid)`). Mutating shared module state during render is a
React anti-pattern: it makes the API layer's behavior depend on *which component
rendered last*, defeats concurrent/Strict-mode rendering, and creates an implicit
global coupling between routing and every `fetch`. Any two project scopes that mount
or re-render in an interleaved way (deep-link, fast nav, future tab/split view) can
issue requests against the wrong project. The team already had to add a hack comment
and an e2e "regression guard for the active-project prefix being set on first paint"
(`web/e2e/run.spec.ts:33-37`) — evidence the design is fragile.

**Impact:** Cross-project request leakage; brittle ordering assumptions; blocks
concurrent rendering.
**Recommendation:** Thread `pid` explicitly into the API functions (e.g.
`api.scoped(pid).getChecks()`), or read it from a React context, instead of a mutable
global written during render.

### D2 — Duplicated `json<T>` fetch helper across ~9 modules; no shared API client
**Severity:** Medium
**Location:** `web/src/api/client.ts:32-35`, and re-declared in `checks.ts:4-7`, `agents.ts:4-7`, `config.ts:6-9`, `credentials.ts:4-7`, `projects.ts:5-8`, `skills.ts`, `tools.ts`, `providers.ts`, `ship.ts`, `graph.ts`, `plugins.ts`

The same `async function json<T>(res)` (throws `new Error(\`${status}: ${text}\`)`) is
copy-pasted into every API module. There is no central place for base URL, default
headers, timeouts, abort signals, retry, or error normalization. Adding the Origin
header from S1, or a request timeout, would mean editing a dozen files.

**Impact:** Maintenance drift; no single seam for cross-cutting concerns (auth, abort,
error mapping).
**Recommendation:** Extract one `request<T>(path, init)` helper (or a tiny typed client)
and have all modules call it.

### D3 — `severity`/`kind` typed as bare `string`; UI silently mislabels unknown values
**Severity:** Medium
**Location:** `web/src/types/CheckFinding.ts:4` (`severity: string`), `web/src/health/HealthPage.tsx:7-21` (`SEV_CLASS` + `?? SEV_CLASS.warning`), `web/src/types/Event.ts:7` (`kind: string`, `payload: unknown`)

`CheckFinding.severity` is generated as `string` (not a discriminated union). The
health page maps it through `SEV_CLASS` and falls back to the **warning** style for any
unrecognized value (`HealthPage.tsx:15`). So a backend `severity: "critical"` (or a
typo) renders as a yellow "warning" badge — silently downgrading severity in a
*security/health* surface. Same pattern for the sandbox badge (`status === "ready" ?
"pass" : "note"`) and run/span statuses elsewhere rely on `Record<string,...>` lookups
with silent fallbacks. The types drift from the backend's real enum shapes.

**Impact:** Wrong severity/state shown to the operator — the exact audience that relies
on accurate triage.
**Recommendation:** Narrow these to string-literal unions at the ts-rs boundary (or
validate on receipt) and render an explicit "unknown severity" state rather than
defaulting to a benign color.

### D4 — `usePollRuns` runs duplicate 5s intervals; no shared scheduler or backoff
**Severity:** Medium
**Location:** `web/src/runs/usePollRuns.ts:5-11`, mounted by `web/src/dashboard/DashboardPage.tsx:26` and `web/src/runs/RunsView.tsx:16`

Each component that wants live runs calls `usePollRuns()`, which creates its **own**
`setInterval(refreshRuns, 5000)`. When a view renders both (or future composite
layouts), multiple intervals hit `GET /runs` in parallel, each overwriting
`store.runs`. There is no visibility check (polls while the tab is hidden), no backoff
on failure (a down gateway is hammered every 5s forever), and no dedup. `refreshRuns`
itself (`store.ts:95`) has no in-flight guard, so a slow response can be clobbered by
the next tick (last-write-wins race).

**Impact:** Redundant network load, battery drain, and races between overlapping
refreshes.
**Recommendation:** Centralize polling in the store (single interval, ref-counted
subscribers), pause on `document.hidden`, add exponential backoff on error, and guard
against overlapping in-flight requests.

### D5 — `ContextBar` is always rendered with no data — dead placeholder in every row
**Severity:** Low
**Location:** `web/src/dashboard/ContextBar.tsx:1-14`, used at `web/src/runs/RunsTable.tsx:64` and `web/src/trace/RunControls.tsx:20`

`ContextBar` is invoked with no `context` prop everywhere it's used, so it always hits
the `context == null` branch and renders a dashed "WIP" chip. Every runs-table row and
the trace header carry an identical placeholder that conveys nothing, adding a column
of visual noise and a per-row component instance for no value.

**Impact:** Wasted column/space, misleading "feature exists" impression, needless renders.
**Recommendation:** Gate the whole column behind a feature flag until tau reports
context usage, or remove it from the table and keep one placeholder.

### D6 — `applyWs` closes the socket but never clears `store.socket`
**Severity:** Low
**Location:** `web/src/store/store.ts:167-173`

On a terminal `run_update`, `applyWs` calls `get().socket?.close()` but does not
`set({ socket: null })` (unlike `openTrace`/`closeTrace`, which do). The store keeps a
reference to a closed socket; subsequent `closeTrace()` calls `.close()` on an
already-closed socket. Harmless today but an inconsistent lifecycle that will bite
reconnect logic.

**Impact:** Stale socket reference; latent bug for reconnection/cleanup.
**Recommendation:** Set `socket: null` when closing on terminal status.

## DX

### D7 — `no-explicit-any` lint rule disabled project-wide
**Severity:** Medium
**Location:** `web/eslint.config.js` (`"@typescript-eslint/no-explicit-any": "off"`)

The recommended TS-ESLint guardrail against `any` is globally turned off. While the
current code happens to avoid `any` (it uses `unknown` + casts instead), the rule's
removal means future `any` usage — the most common way types silently drift from the
gateway's real shapes (the project's stated concern, see D3) — passes CI unflagged.

**Impact:** Type-safety erosion goes undetected.
**Recommendation:** Re-enable as `warn` (or `error` with targeted `eslint-disable`),
since the codebase is already clean.

### D8 — No `pnpm audit` / dependency gate in CI; tested only against the mock
**Severity:** Low
**Location:** `.github/workflows/ci.yml` (web + e2e jobs), `web/playwright.config.ts:9-12`

CI has strong unit/e2e/type-drift gating but (a) never audits dependencies (see S3) and
(b) every e2e test runs against `fake-tau-serve`, so no test exercises the real adapter
or any **error path** (gateway down, 500s, malformed frames). Coverage of the happy
path is excellent; coverage of failure UX is effectively zero.

**Impact:** Vuln deps and broken error states ship green.
**Recommendation:** Add an audit step; add e2e/unit tests that assert error and
empty/loading states (mock a 500 and a dropped socket).

### D9 — API base URL and proxy target are hard-coded; no env configuration
**Severity:** Low
**Location:** `web/src/api/client.ts:29` (`/api/...`), `web/vite.config.ts:10-13` (proxy to `127.0.0.1:4317`)

The gateway port (4317) and host are hard-coded in the Vite proxy, and the API root is
a bare `/api`. There is no `.env`/`import.meta.env` indirection, so pointing the UI at a
non-default gateway requires editing source.

**Impact:** Friction running against a custom gateway port/host.
**Recommendation:** Read the proxy target from an env var with the current value as default.

## UX

### D10 — Pervasive silent error swallowing — failures render as "empty", not "error"
**Severity:** High
**Location:** 38 `.catch(() => {})` / `.catch(() => …)` sites across `web/src` (e.g. `health/HealthPage.tsx:37-39`, `agents/AgentsIndexPage.tsx:11-13`, `packages/PackagesPage.tsx` ×6, `providers/ProvidersPage.tsx` ×3, `graph/GraphEditor.tsx` ×4)

Nearly every data load swallows its error and leaves state at the initial empty value.
A user whose gateway is unreachable sees "No findings.", "No runs yet.", an empty
agents table, an empty providers list — **indistinguishable from a genuinely empty
project**. There is no global error toast, no per-panel error state, and no retry
affordance. This is the single most pervasive UX problem in the app.

**Impact:** Operators cannot tell "broken" from "empty"; failures are invisible.
**Recommendation:** Standardize on a load state (`loading | error | empty | data`) per
panel (a small hook), and a global error surface for connectivity loss.

### D11 — `ConfigPage` shows "✓ saved" even when the save failed
**Severity:** High
**Location:** `web/src/config/ConfigPage.tsx:31-36`

`onSave` does `await putConfig(...).catch(() => {})` then **unconditionally** sets
`saved = true` and shows "✓ saved to tau.toml". A failed write (permissions, gateway
down, 500) produces a green success confirmation. The same anti-pattern affects
`onImport` (`:38-43`) which clears the input and reloads regardless of outcome.

**Impact:** Data-loss illusion — the user believes config persisted when it did not.
**Recommendation:** Only show success on a resolved promise; surface the error otherwise.

### D12 — Clickable table rows are not keyboard-accessible
**Severity:** Medium
**Location:** `web/src/runs/RunsTable.tsx:37-41` (`<tr onClick>`), `web/src/trace/TraceTimeline.tsx:53-59` (`<div onClick>`)

Runs are opened by clicking a `<tr>` with an `onClick` handler; the timeline rows are
clickable `<div>`s. Neither is focusable, has a `role`/`tabIndex`, nor responds to
Enter/Space, so keyboard and screen-reader users cannot open a run or select a span.
(Most other interactive elements correctly use `<button>`/`<Link>` and ARIA, so this is
an inconsistency, not a systemic gap.)

**Impact:** Core navigation (open a run, inspect a span) is unreachable without a mouse.
**Recommendation:** Make rows real buttons/links or add `role="button" tabIndex={0}`
with `onKeyDown` Enter/Space, plus a visible focus ring.

### D13 — Packages "verify" and status badges are always styled green
**Severity:** Medium
**Location:** `web/src/packages/PackagesPage.tsx:87-90`

The status cell renders `status[p.name] ?? p.status` inside a fixed
`bg-st-ok-soft text-st-ok` (green) span regardless of the actual value. After
`Verify`, a package whose status is `"failed"`/`"drift"`/`"stale"` still shows in the
success color — the text changes but the semaphore lies. (Contrast with `ShipPage`'s
`DriftBadge`, which correctly tones by value.)

**Impact:** Failed/stale packages look healthy.
**Recommendation:** Map status → tone like the ship/health badges do.

### D14 — No loading states anywhere; no global error boundary
**Severity:** Medium
**Location:** all pages (e.g. `web/src/dashboard/DashboardPage.tsx`, `health/HealthPage.tsx`, `providers/ProvidersPage.tsx`), `web/src/main.tsx:8-14`

Every page renders its final layout immediately with empty data and silently fills in
when fetches resolve; there is no skeleton/spinner, so a slow gateway looks like an
empty project (compounds D10). There is also **no React error boundary** in the tree
(`main.tsx` mounts `<App/>` bare), so any render-time throw (e.g. a malformed span
shape) blanks the entire SPA with only a console error.

**Impact:** Confusing perceived-empty states; one bad render takes down the whole UI.
**Recommendation:** Add per-panel loading skeletons and wrap routes in an error boundary
with a recoverable fallback.

### D15 — `Launcher.onRun` has no error handling
**Severity:** Low
**Location:** `web/src/runs/Launcher.tsx:31-44`

If `launch`/`launchWorkflow` rejects, the `try/finally` resets `busy` but nothing
catches the rejection — it becomes an unhandled promise rejection and the user gets no
feedback (the form just stays put). Every other editor (`AgentEditorPage`,
`CredentialChainEditor`) surfaces errors; the primary "Run" action does not.

**Impact:** Launch failures are invisible to the user.
**Recommendation:** Catch and display the error (reuse the editors' error-line pattern).
