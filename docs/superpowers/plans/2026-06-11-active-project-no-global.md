# Active-Project: replace mutated module global with ProjectContext + explicit arg

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (executed inline this session). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove the `activeProject` module global in `web/src/api/client.ts` (mutated during `ProjectScope` render) so a request's target project is bound explicitly at the call site and can never read a stale/wrong project.

**Architecture:** `ProjectScope` (the one owner of the `:pid` route param) provides the active project id through a new React `ProjectContext`. The API client and the per-domain API modules take `pid` as an explicit first argument instead of reading a global. Components/hooks read `useProjectId()` and pass it down; the zustand store's scoped actions take `pid` from their callers. No module-level mutable scoping state remains; nothing is mutated during render.

**Tech Stack:** React 19 + react-router, zustand store, Vitest + Testing Library, TypeScript, Vite.

**Finding:** audit/design.md (HIGH, design) — `client.ts:23-30` (module global + mutation), `ProjectScope.tsx:15-17` (mutation during render).

---

## Source of truth for the active project

- **Before:** `let activeProject = ""` in `client.ts`, mutated by `setActiveProject(pid)` which is called *during render* in `ProjectScope` and by `store.setActiveProject`. `scoped(path)` reads the global.
- **After:**
  - `client.ts` exposes `scopedPath(pid, path)` and every scoped fetch fn takes `pid` first. No global, no `setActiveProject`.
  - New `web/src/app/project-context.tsx`: `ProjectContext` + `ProjectProvider` + `useProjectId()`.
  - `ProjectScope` provides `pid` via `<ProjectProvider>` (render-time *provision*, not mutation) and passes `pid` into its store loads.
  - Per-domain api modules (`agents/skills/ship/providers/tools/checks/config/plugins/graph`) take `pid` first and forward to `scopedPath(pid, …)`.
  - store scoped actions (`loadProject/loadHealth/refreshRuns/launch/loadWorkflows/launchWorkflow/openTrace/cancelCurrent`) take `pid`.
  - `activeProjectId` + `setActiveProject` stay in the store **as a display label only** (read by Navbar/Sidebar/TraceView/RunsView/Launcher, which can live above ProjectScope) — they no longer touch any client global.

---

## Task 1: Failing test — per-request project isolation (drives the client API change)

**Files:**
- Test: `web/src/api/client.test.ts`

- [ ] **Step 1: Add a failing test** at the end of the `describe("api client (project-scoped)")` block:

```ts
it("binds each request to its explicit project argument (no shared-global leak)", async () => {
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", f);
  // Two project scopes issue requests concurrently; with the old mutable global
  // the second would clobber the first. Each must hit its own project.
  await Promise.all([listRuns("alpha"), listRuns("beta")]);
  const urls = f.mock.calls.map((c) => c[0]).sort();
  expect(urls).toEqual(["/api/projects/alpha/runs", "/api/projects/beta/runs"]);
});
```

- [ ] **Step 2: Run, expect FAIL** (tsc/vitest): `listRuns("alpha")` — current `listRuns` takes only `filters`, so the call mis-scopes / type-errors.

Run: `cd web && npx vitest run src/api/client.test.ts`

## Task 2: client.ts — explicit `pid`, remove global

**Files:** Modify `web/src/api/client.ts`

- [ ] Replace the global block (lines 23-30) with:

```ts
/** Build a path scoped to project `pid`. */
function scoped(pid: string, path: string): string {
  return `/api/projects/${pid}${path}`;
}
```

- [ ] Add `pid: string` as the **first** parameter to each exported scoped fn and thread it through `scoped(pid, …)`:
  - `getHealth(pid)`, `getProject(pid)`
  - `launchRun(pid, agent_id, prompt)`
  - `listRuns(pid, filters = {})`
  - `getWorkflows(pid)`
  - `launchWorkflow(pid, workflow, input)`
  - `getTrace(pid, id)`, `cancelRun(pid, id)`
  - `openRunSocket(pid, id, onMessage)` → uses `scoped(pid, …)`
  - `scopedPath(pid, path)` (exported helper) → `return scoped(pid, path)`
- [ ] Delete `setActiveProject` and the `let activeProject` line.

- [ ] **Run Task 1 test, expect PASS.** Update the existing client tests in the same file to pass `"demo"` explicitly and drop the `setActiveProject` import / `beforeEach` call (e.g. `getProject("demo")`, `launchRun("demo","greeter","hi")`, `listRuns("demo",{status:"completed"})`, `getTrace("demo","R1")`, `cancelRun("demo","R1")`).

Run: `cd web && npx vitest run src/api/client.test.ts` → PASS

## Task 3: ProjectContext

**Files:** Create `web/src/app/project-context.tsx`

```tsx
import { createContext, useContext, type ReactNode } from "react";

const ProjectContext = createContext<string | null>(null);

/** Provides the active project id (from the :pid route) to scoped descendants. */
export function ProjectProvider({ pid, children }: { pid: string; children: ReactNode }) {
  return <ProjectContext.Provider value={pid}>{children}</ProjectContext.Provider>;
}

/** Read the active project id. Throws if used outside a ProjectProvider. */
export function useProjectId(): string {
  const pid = useContext(ProjectContext);
  if (pid === null) throw new Error("useProjectId must be used within a ProjectProvider");
  return pid;
}
```

## Task 4: ProjectScope — provide context, stop mutating during render

**Files:** Modify `web/src/app/ProjectScope.tsx`

- [ ] Remove `import { setActiveProject as setClientProject } from "../api/client"` and the render-time `if (pid) setClientProject(pid);`.
- [ ] In the effect, pass `pid` to the scoped loads: `loadProject(pid)`, `loadHealth(pid)` (keep `loadProjects()` unscoped, keep `setActiveProject(pid)` label).
- [ ] Wrap the rendered `<Outlet />` in `<ProjectProvider pid={pid}>` (only the `known` branch needs it; `NotFound` does not). Guard: render provider only when `pid` is defined.

## Task 5: store — thread `pid` into scoped actions

**Files:** Modify `web/src/store/store.ts`

- [ ] Update the `AppStore` interface signatures: `loadHealth(pid: string)`, `loadProject(pid: string)`, `refreshRuns(pid: string, filters?)`, `launch(pid: string, agent, prompt)`, `loadWorkflows(pid: string)`, `launchWorkflow(pid: string, workflow, input)`, `openTrace(pid: string, id)`, `cancelCurrent(pid: string)`.
- [ ] Update implementations to forward `pid` to the client fns. `launch`/`launchWorkflow` call `get().refreshRuns(pid)`. `openTrace(pid, id)` → `getTrace(pid, id)` and `openRunSocket(pid, id, …)`. `cancelCurrent(pid)` → `cancelRun(pid, id)`.
- [ ] Remove `setActiveProject as clientSetActiveProject` import; `setActiveProject` now only `set({ activeProjectId: pid })`.

## Task 6: per-domain api modules — explicit `pid`

**Files:** Modify `agents.ts, skills.ts, ship.ts, providers.ts, tools.ts, checks.ts, config.ts, plugins.ts, graph.ts`

- [ ] In each, change `import { scopedPath }` calls to pass `pid` and add `pid: string` as the first param of every exported fn (forward to `scopedPath(pid, …)`). Examples:
  - `listAgents(pid)`, `getAgent(pid, id)`, `putAgent(pid, agent, opts?)`, `deleteAgent(pid, id)`
  - `getProviders(pid)`, `listTools(pid)`, `getChecks(pid)`, `listPlugins(pid)`, `getWorkflowGraph(pid, name)`
  - `listSkills(pid)`, `getSkill(pid, name)`, `putSkill(pid, skill, opts?)`, `deleteSkill(pid, name)`, `importSkill(pid, git_url)`
  - `listTargets(pid)`, `listBundles(pid)`, `build(pid, target)`, `verifyBundle(pid, path)`
  - config: `getConfig(pid)`, `putConfig(pid, name, description)`, `getPackages(pid)`, `installPackage(pid, git_url)`, `uninstallPackage(pid, name)`, `updatePackage(pid, name, to?)`, `resolvePackages(pid)`, `verifyPackages(pid)`, `importAgent(pid, git_url, llm_backend)`

## Task 7: component/hook call sites — read `useProjectId()`, pass `pid`

**Files (each: add `const pid = useProjectId()` and prepend `pid` to the relevant calls):**
- `agents/AgentEditorPage.tsx` — `getAgent(pid,…)`, `putAgent(pid,…)`, `deleteAgent(pid,…)`, `getProviders(pid)` (already has `pid` from `useParams` for nav links — reuse `useProjectId()`).
- `agents/AgentsIndexPage.tsx` — `listAgents(pid)` (add to effect deps).
- `config/ConfigPage.tsx` — `getConfig(pid)`, `putConfig(pid,…)`, `importAgent(pid,…)`.
- `providers/ProvidersPage.tsx` — `getProviders(pid)`, `installPackage(pid,url)`.
- `tools/ToolsTab.tsx` — `listTools(pid)`.
- `tools/SkillsIndex.tsx` — `listSkills(pid)`, `importSkill(pid,…)`.
- `tools/SkillEditorPage.tsx` — `getSkill(pid,…)`, `putSkill(pid,…)`, `deleteSkill(pid,…)`.
- `tools/PluginsTab.tsx` — `listPlugins(pid)`.
- `ship/ShipPage.tsx` — `listTargets(pid)`, `listBundles(pid)`, `build(pid,target)`, `verifyBundle(pid,path)`.
- `packages/PackagesPage.tsx` — `getPackages(pid)`, `installPackage(pid,…)`, `uninstallPackage(pid,…)`, `updatePackage(pid,…)`, `resolvePackages(pid)`, `verifyPackages(pid)`.
- `health/HealthPage.tsx` — `getChecks(pid)`, `loadHealth(pid)`.
- `graph/GraphEditor.tsx` — `getWorkflows(pid)`, `getWorkflowGraph(pid,…)`, `getProviders(pid)`, `listAgents(pid)`.
- `runs/Launcher.tsx` — `launch(pid,…)`, `launchWorkflow(pid,…)`, `loadWorkflows(pid)` (replace `pid = useStore(s=>s.activeProjectId)` with `useProjectId()`; keep nav).
- `runs/usePollRuns.ts` — `const pid = useProjectId()`; `refreshRuns(pid)` (add to deps).
- `trace/TracePage.tsx` — `openTrace(pid, id)` (add pid to deps).
- `trace/RunControls.tsx` — `cancelCurrent(pid)`.

Effect-dependency arrays must include `pid` where a `pid`-using call lives in the effect.

## Task 8: update tests to pass `pid` / wrap in ProjectProvider

**Files:**
- `api/agents.test.ts`, `api/skills.test.ts` — drop `setActiveProject` import/`beforeEach`; pass `"demo"` to every call (`listAgents("demo")`, `getSkill("demo","critic")`, …).
- `store/store.test.ts` — `loadHealth("demo")`, `loadWorkflows("demo")`; `setActiveProject` test unchanged (label still works).
- Component tests rendering scoped components must provide context. Wrap the rendered element in `<ProjectProvider pid="demo">…</ProjectProvider>`:
  - `agents/AgentEditorPage.test.tsx`, `agents/AgentsIndexPage.test.tsx`,
  - `tools/SkillEditorPage.test.tsx`, `tools/SkillsIndex.test.tsx`, `tools/ToolsPage.test.tsx`, `tools/ToolsTab.test.tsx`, `tools/PluginsTab.test.tsx`,
  - `config/ConfigPage.test.tsx`, `providers/ProvidersPage.test.tsx`, `packages/PackagesPage.test.tsx`,
  - `ship/ShipPage.test.tsx`, `health/HealthPage.test.tsx`, `graph/GraphEditor.test.tsx`,
  - `runs/Launcher.test.tsx`, `runs/RunsView.filter.test.tsx`, `dashboard/DashboardPage.test.tsx`, `trace/*` if they mount scoped components.
  - Drop now-removed `setActiveProject` imports where present.
  - Keep existing `MemoryRouter`/route wrappers; nest `ProjectProvider` inside the route element (or wrap the whole tree) so `useProjectId()` resolves to `"demo"`.

(Exact wrapping discovered per-file during execution; only files whose components call `useProjectId()` need it.)

## Task 9: verification + commit

- [ ] `cd web && pnpm typecheck` → clean
- [ ] `cd web && npx vitest run` → all green
- [ ] `cd web && pnpm lint` → clean
- [ ] `cd web && pnpm exec prettier --check .` → clean (run `prettier --write` on touched files first)
- [ ] `cd web && pnpm build` → succeeds
- [ ] requesting-code-review, then commit (Co-Authored-By: Claude Fable 5), push, `gh pr create -R tau-rs/tau-web-ui --base main` citing the finding. STOP — no merge.
