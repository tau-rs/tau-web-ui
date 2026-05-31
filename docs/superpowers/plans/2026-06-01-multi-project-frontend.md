# Multi-project Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` a global Projects home (cross-project summary, project cards, add-by-path/git, cross-project runs/failures feed) and move the per-project app under `/projects/:pid/…`, with a navbar project switcher — all backed by the gateway API from Plan 1.

**Architecture:** A single client chokepoint prefixes every scoped request with the active project id, so existing surfaces are unchanged. The route param `:pid` drives the active project; `AppLayout` syncs it into the store. A new `ProjectsHome` renders the global view from `GET /api/projects` and `GET /api/projects/runs`.

**Tech Stack:** React 18, react-router-dom v6, Zustand, Vite, TypeScript, Tailwind (Slate Compact tokens), Vitest, Playwright.

This is **Plan 2 of 2** for multi-project support (see `docs/superpowers/specs/2026-06-01-multi-project-design.md`). It depends on Plan 1's API (`/api/projects…`, scoped `/api/projects/:pid/…`) and generated TS types (`ProjectListItem`, `ProjectMeta`, `ProjectSummary`, `ProjectSource`, `CrossProjectRun`).

---

## File Structure

**New files:**
- `web/src/api/projects.ts` — global project API: `listProjects`, `getCrossRuns`, `addProjectByPath`, `addProjectByGit`, `removeProject`.
- `web/src/projects/ProjectsHome.tsx` — the `/` global view (summary strip + cards grid + add card + Activity panel).
- `web/src/projects/ProjectCard.tsx` — one project's mini-dashboard card.
- `web/src/projects/AddProjectForm.tsx` — path + git add form.
- `web/src/projects/ActivityFeed.tsx` — cross-project runs/failures panel with a Failures/All toggle.
- `web/src/projects/NotFound.tsx` — "project not found → back to home".
- Test files: `web/src/api/projects.test.ts`, `web/src/projects/ProjectsHome.test.tsx`, `web/src/projects/ActivityFeed.test.tsx`, `web/src/app/switcher.test.tsx`.

**Modified files:**
- `web/src/api/client.ts` — add `setActiveProject` + `scoped()`; prefix every scoped fetch/WS.
- `web/src/api/config.ts` — prefix every fetch via `scoped()`.
- `web/src/store/store.ts` — add `activeProjectId`, `projects`, `setActiveProject`, `loadProjects`.
- `web/src/App.tsx` — `/` → ProjectsHome; `/projects/:pid/*` → AppLayout subtree; catch-all → `/`.
- `web/src/app/AppLayout.tsx` — read `:pid`, set active project, not-found guard.
- `web/src/app/Sidebar.tsx` — prefix links with `/projects/:pid`.
- `web/src/app/Navbar.tsx` — project switcher dropdown.
- Test updates: `web/src/api/client.test.ts`, `web/src/app/routing.test.tsx`, `web/src/app/Sidebar.test.tsx`, `web/src/app/Navbar.test.tsx`.
- `web/e2e/run.spec.ts` — repoint under `/projects/demo/…`; add home + add-project specs.

**Deferred (YAGNI, logged):** per-project sparkline on cards — the summary endpoint has no time series, and loading every project's full run list on the home is wasteful; cards show the numeric mini-dashboard only.

---

## Task 1: Client scoping chokepoint

**Files:**
- Modify: `web/src/api/client.ts`, `web/src/api/config.ts`
- Test: `web/src/api/client.test.ts`

- [ ] **Step 1: Update the failing test**

Replace `web/src/api/client.test.ts` with a version that sets an active project and asserts the scoped prefix:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getProject, listRuns, launchRun, getTrace, cancelRun, setActiveProject } from "./client";

beforeEach(() => {
  vi.restoreAllMocks();
  setActiveProject("demo");
});

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

describe("api client (project-scoped)", () => {
  it("getProject hits the active project's scoped path", async () => {
    const f = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ project_path: "/p", agents: ["greeter"], tau_version: "0" }),
    });
    vi.stubGlobal("fetch", f);
    await getProject();
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/project");
  });

  it("launchRun posts to the scoped runs path and returns run_id", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ run_id: "R1" }) });
    vi.stubGlobal("fetch", f);
    const id = await launchRun("greeter", "hi");
    expect(id).toBe("R1");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/runs");
    const [, init] = f.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ agent_id: "greeter", prompt: "hi" });
  });

  it("getTrace returns run + spans from the scoped path", async () => {
    mockFetch({ run: { id: "R1" }, spans: [{ id: "s1" }] });
    const t = await getTrace("R1");
    expect(t.spans).toHaveLength(1);
  });

  it("cancelRun returns boolean", async () => {
    mockFetch({ cancelled: true });
    expect(await cancelRun("R1")).toBe(true);
  });

  it("listRuns passes filters under the scoped path", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listRuns({ status: "completed" });
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/runs?status=completed");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm test -- src/api/client.test.ts`
Expected: FAIL (`setActiveProject` is not exported; URLs are unscoped).

- [ ] **Step 3: Rewrite `client.ts` with the chokepoint**

Replace `web/src/api/client.ts` with:

```ts
import type { Event } from "../types/Event";
import type { Run } from "../types/Run";
import type { Span } from "../types/Span";
import type { WsMessage } from "../types/WsMessage";

export interface Project {
  project_path: string;
  agents: string[];
  tau_version: string;
}
export interface Health {
  gateway_ok: boolean;
  tau_bin: string;
  tau_version: string;
  engine_ok: boolean;
}
export interface Trace {
  run: Run;
  spans: Span[];
  events: Event[];
}

let activeProject = "";
/** Set the project id every scoped request is prefixed with. */
export function setActiveProject(pid: string): void {
  activeProject = pid;
}
function scoped(path: string): string {
  return `/api/projects/${activeProject}${path}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getHealth = () => fetch(scoped("/health")).then(json<Health>);
export const getProject = () => fetch(scoped("/project")).then(json<Project>);

export function launchRun(agent_id: string, prompt: string): Promise<string> {
  return fetch(scoped("/runs"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id, prompt }),
  })
    .then(json<{ run_id: string }>)
    .then((r) => r.run_id);
}

export function listRuns(filters: { status?: string; agent?: string } = {}): Promise<Run[]> {
  const q = new URLSearchParams();
  if (filters.status) q.set("status", filters.status);
  if (filters.agent) q.set("agent", filters.agent);
  const qs = q.toString();
  return fetch(scoped(`/runs${qs ? `?${qs}` : ""}`)).then(json<Run[]>);
}

export const getWorkflows = () =>
  fetch(scoped("/workflows"))
    .then(json<{ workflows: string[] }>)
    .then((r) => r.workflows);

export function launchWorkflow(workflow: string, input: string): Promise<string> {
  return fetch(scoped("/workflows/run"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow, input }),
  })
    .then(json<{ run_id: string }>)
    .then((r) => r.run_id);
}

export const getTrace = (id: string) => fetch(scoped(`/runs/${id}`)).then(json<Trace>);
export const cancelRun = (id: string) =>
  fetch(scoped(`/runs/${id}/cancel`), { method: "POST" })
    .then(json<{ cancelled: boolean }>)
    .then((r) => r.cancelled);

/** Open the live WS for a run under the active project. */
export function openRunSocket(id: string, onMessage: (m: WsMessage) => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}${scoped(`/runs/${id}/events`)}`);
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data) as WsMessage);
    } catch {
      /* ignore malformed */
    }
  };
  return ws;
}
```

- [ ] **Step 4: Rewrite `config.ts` to use the same chokepoint**

Replace `web/src/api/config.ts` with (note the imported `scoped` is private to `client.ts`, so re-declare a local `scoped` that reads the same active project — to avoid duplicate state, export `scoped` from `client.ts`). First, add to the end of `client.ts`:

```ts
/** Build a scoped path for the active project (used by other api modules). */
export function scopedPath(path: string): string {
  return scoped(path);
}
```

Then `web/src/api/config.ts`:

```ts
import type { ProjectConfig } from "../types/ProjectConfig";
import type { Package } from "../types/Package";
import type { VerifyResult } from "../types/VerifyResult";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getConfig = () => fetch(scopedPath("/project/config")).then(json<ProjectConfig>);

export const putConfig = (name: string, description: string) =>
  fetch(scopedPath("/project/config"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description: description || null }),
  }).then(json<{ ok: boolean }>);

export const getPackages = () =>
  fetch(scopedPath("/packages"))
    .then(json<{ packages: Package[] }>)
    .then((r) => r.packages);

export const installPackage = (git_url: string) =>
  fetch(scopedPath("/packages/install"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  })
    .then(json<{ package: Package }>)
    .then((r) => r.package);

export const uninstallPackage = (name: string) =>
  fetch(scopedPath(`/packages/${name}`), { method: "DELETE" }).then(json<{ ok: boolean }>);

export const updatePackage = (name: string, to?: string) =>
  fetch(scopedPath(`/packages/${name}/update`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: to ?? null }),
  })
    .then(json<{ package: Package }>)
    .then((r) => r.package);

export const resolvePackages = () =>
  fetch(scopedPath("/packages/resolve"), { method: "POST" })
    .then(json<{ packages: Package[] }>)
    .then((r) => r.packages);

export const verifyPackages = () =>
  fetch(scopedPath("/packages/verify"), { method: "POST" })
    .then(json<{ results: VerifyResult[] }>)
    .then((r) => r.results);

export const importAgent = (git_url: string, llm_backend: string) =>
  fetch(scopedPath("/agents/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url, llm_backend }),
  })
    .then(json<{ agent_id: string }>)
    .then((r) => r.agent_id);
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && pnpm test -- src/api/client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/api/client.ts web/src/api/config.ts web/src/api/client.test.ts
git commit -m "feat(web): project-scoped api client chokepoint"
```

---

## Task 2: Frontend projects API module

**Files:**
- Create: `web/src/api/projects.ts`, `web/src/api/projects.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/api/projects.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listProjects, getCrossRuns, addProjectByPath, addProjectByGit, removeProject } from "./projects";

beforeEach(() => vi.restoreAllMocks());

describe("projects api", () => {
  it("listProjects GETs /api/projects", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listProjects();
    expect(f.mock.calls[0][0]).toBe("/api/projects");
  });

  it("getCrossRuns passes status + limit", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await getCrossRuns("failed", 20);
    expect(f.mock.calls[0][0]).toBe("/api/projects/runs?status=failed&limit=20");
  });

  it("addProjectByPath posts { path }", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "demo" }) });
    vi.stubGlobal("fetch", f);
    await addProjectByPath("/abs/demo");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ path: "/abs/demo" });
  });

  it("addProjectByGit posts { git_url }", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "bot" }) });
    vi.stubGlobal("fetch", f);
    await addProjectByGit("https://x/bot.git");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ git_url: "https://x/bot.git" });
  });

  it("removeProject DELETEs the project", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    vi.stubGlobal("fetch", f);
    await removeProject("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo");
    expect(f.mock.calls[0][1].method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm test -- src/api/projects.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `projects.ts`**

Create `web/src/api/projects.ts`:

```ts
import type { ProjectListItem } from "../types/ProjectListItem";
import type { ProjectMeta } from "../types/ProjectMeta";
import type { CrossProjectRun } from "../types/CrossProjectRun";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listProjects = () => fetch("/api/projects").then(json<ProjectListItem[]>);

export function getCrossRuns(status?: string, limit = 50): Promise<CrossProjectRun[]> {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  q.set("limit", String(limit));
  return fetch(`/api/projects/runs?${q.toString()}`).then(json<CrossProjectRun[]>);
}

export const addProjectByPath = (path: string) =>
  fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).then(json<ProjectMeta>);

export const addProjectByGit = (git_url: string) =>
  fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  }).then(json<ProjectMeta>);

export const removeProject = (pid: string) =>
  fetch(`/api/projects/${pid}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`);
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && pnpm test -- src/api/projects.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/api/projects.ts web/src/api/projects.test.ts
git commit -m "feat(web): global projects api module"
```

---

## Task 3: Store — active project + projects list

**Files:**
- Modify: `web/src/store/store.ts`
- Test: `web/src/store/store.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `web/src/store/store.test.ts`:

```ts
describe("store project scope", () => {
  it("setActiveProject records the id", () => {
    useStore.getState().setActiveProject("acme-bot");
    expect(useStore.getState().activeProjectId).toBe("acme-bot");
  });

  it("loadProjects populates the projects list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { meta: { id: "demo", name: "demo", path: "/p", source: { kind: "local" } }, summary: {} },
        ],
      }),
    );
    await useStore.getState().loadProjects();
    expect(useStore.getState().projects).toHaveLength(1);
    expect(useStore.getState().projects[0].meta.id).toBe("demo");
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm test -- src/store/store.test.ts`
Expected: FAIL (`setActiveProject`/`loadProjects`/`activeProjectId` missing).

- [ ] **Step 3: Extend the store**

In `web/src/store/store.ts`:

1. Add imports:

```ts
import { setActiveProject as clientSetActiveProject } from "../api/client";
import { listProjects } from "../api/projects";
import type { ProjectListItem } from "../types/ProjectListItem";
```

2. Add fields to the `AppStore` interface (after `socket: WebSocket | null;`):

```ts
  activeProjectId: string;
  projects: ProjectListItem[];
  setActiveProject: (pid: string) => void;
  loadProjects: () => Promise<void>;
```

3. Add the initial state (after `socket: null,`):

```ts
  activeProjectId: "",
  projects: [],
```

4. Add the actions (anywhere among the action definitions, e.g. after `loadProject`):

```ts
  setActiveProject: (pid) => {
    clientSetActiveProject(pid);
    set({ activeProjectId: pid });
  },
  loadProjects: async () => {
    try {
      set({ projects: await listProjects() });
    } catch {
      /* gateway unreachable — leave projects as-is */
    }
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && pnpm test -- src/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/store/store.ts web/src/store/store.test.ts
git commit -m "feat(web): store tracks active project + projects list"
```

---

## Task 4: Routing — ProjectsHome at `/`, app under `/projects/:pid`

**Files:**
- Create: `web/src/projects/NotFound.tsx`
- Modify: `web/src/App.tsx`, `web/src/app/AppLayout.tsx`
- Test: `web/src/app/routing.test.tsx`

This task wires routing against a **placeholder** ProjectsHome (the real one lands in Task 6) so routing is testable in isolation. Create a minimal placeholder now and replace it in Task 6.

- [ ] **Step 1: Create the NotFound + placeholder home**

Create `web/src/projects/NotFound.tsx`:

```tsx
import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="p-8 text-sm text-muted">
      <p className="mb-2 font-semibold text-fg">Project not found.</p>
      <Link to="/" className="text-accent underline">
        Back to projects
      </Link>
    </div>
  );
}
```

Create a temporary `web/src/projects/ProjectsHome.tsx` placeholder (replaced in Task 6):

```tsx
export function ProjectsHome() {
  return <div className="p-4">Projects home</div>;
}
```

- [ ] **Step 2: Rewrite `App.tsx`**

Replace `web/src/App.tsx` with:

```tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { StubPage } from "./app/StubPage";
import { ConfigPage } from "./config/ConfigPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { PackagesPage } from "./packages/PackagesPage";
import { RunsPage } from "./runs/RunsPage";
import { TracePage } from "./trace/TracePage";
import { ProjectsHome } from "./projects/ProjectsHome";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectsHome />} />
      <Route path="/projects/:pid" element={<AppLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route
          path="agents"
          element={<StubPage title="Agents" subtitle="Author agents — coming soon." />}
        />
        <Route
          path="workflows"
          element={
            <StubPage
              title="Workflows"
              subtitle="Author & run workflows — coming soon."
              gated="β.2 (visual graph)"
            />
          }
        />
        <Route
          path="tools"
          element={<StubPage title="Tools & Skills" subtitle="Skills & plugins — coming soon." />}
        />
        <Route path="packages" element={<PackagesPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<TracePage />} />
        <Route
          path="ship"
          element={
            <StubPage
              title="Ship / Targets"
              subtitle="Targets, build & verify — coming soon."
              gated="β.6 (conformance)"
            />
          }
        />
        <Route
          path="health"
          element={<StubPage title="Health checks" subtitle="tau check & sandbox — coming soon." />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 3: Rewrite `AppLayout.tsx` to scope on `:pid`**

Replace `web/src/app/AppLayout.tsx` with:

```tsx
import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { useStore } from "../store/store";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { NotFound } from "../projects/NotFound";

export function AppLayout() {
  const { pid } = useParams();
  const setActiveProject = useStore((s) => s.setActiveProject);
  const loadProject = useStore((s) => s.loadProject);
  const loadHealth = useStore((s) => s.loadHealth);
  const loadProjects = useStore((s) => s.loadProjects);
  const projects = useStore((s) => s.projects);

  useEffect(() => {
    if (!pid) return;
    setActiveProject(pid);
    loadProjects().catch(() => {});
    loadProject().catch(() => {});
    loadHealth().catch(() => {});
  }, [pid, setActiveProject, loadProjects, loadProject, loadHealth]);

  // Once projects are known, guard against an unknown :pid.
  const known = projects.length === 0 || projects.some((p) => p.meta.id === pid);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar />
          <main className="min-h-0 flex-1 overflow-auto">{known ? <Outlet /> : <NotFound />}</main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 4: Update `routing.test.tsx`**

Replace `web/src/app/routing.test.tsx` with paths under `/projects/demo` and a home assertion:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { useStore } from "../store/store";

beforeEach(() =>
  useStore.setState({
    currentTrace: null,
    runs: [],
    projects: [
      { meta: { id: "demo", name: "demo", path: "/p", source: { kind: "local" } }, summary: {} } as never,
    ],
  }),
);

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("routing", () => {
  it("renders the Projects home at /", () => {
    at("/");
    expect(screen.getByText(/projects home/i)).toBeInTheDocument();
  });

  it("renders the Runs page at /projects/demo/runs", () => {
    at("/projects/demo/runs");
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });

  it("renders the Dashboard at /projects/demo/dashboard", () => {
    at("/projects/demo/dashboard");
    expect(screen.getByText(/success rate/i)).toBeInTheDocument();
  });

  it("renders stub pages for the new Build/Operate surfaces", () => {
    at("/projects/demo/agents");
    expect(screen.getByText(/author agents/i)).toBeInTheDocument();
  });

  it("renders the Workflows stub as gated", () => {
    at("/projects/demo/workflows");
    expect(screen.getByText(/waits on tau/i)).toBeInTheDocument();
  });

  it("renders the Packages page", () => {
    at("/projects/demo/packages");
    expect(screen.getByRole("heading", { name: /packages/i })).toBeInTheDocument();
  });

  it("shows not-found for an unknown project id", () => {
    at("/projects/ghost/runs");
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });

  it("redirects unknown top-level paths to the home", () => {
    at("/nope");
    expect(screen.getByText(/projects home/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && pnpm test -- src/app/routing.test.tsx`
Expected: PASS. (The Workflows stub assertion `/waits on tau/i` mirrors the existing StubPage gated copy — keep whatever text StubPage already renders; if StubPage's gated line differs, match its actual text.)

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/app/AppLayout.tsx web/src/projects/NotFound.tsx web/src/projects/ProjectsHome.tsx web/src/app/routing.test.tsx
git commit -m "feat(web): route per-project app under /projects/:pid, home at /"
```

---

## Task 5: Sidebar + Navbar switcher

**Files:**
- Modify: `web/src/app/Sidebar.tsx`, `web/src/app/Navbar.tsx`
- Test: `web/src/app/Sidebar.test.tsx`, `web/src/app/Navbar.test.tsx`, `web/src/app/switcher.test.tsx`

- [ ] **Step 1: Make Sidebar links project-scoped**

In `web/src/app/Sidebar.tsx`, the `GROUPS` `to` values stay as bare sub-paths (`/dashboard`, etc.); prefix them with the active project at render. Replace the component body so it reads `:pid` and builds hrefs, and keep the running badge logic:

Change the import line to add `useParams`:

```tsx
import { NavLink, useParams } from "react-router-dom";
```

Replace the `GROUPS` `to` fields to be bare segments (no leading slash) and prefix in the `NavLink`:

```tsx
const GROUPS: { title: string | null; items: Item[] }[] = [
  { title: null, items: [{ to: "dashboard", label: "Dashboard", icon: "▦" }] },
  {
    title: "Build",
    items: [
      { to: "agents", label: "Agents", icon: "◆" },
      { to: "workflows", label: "Workflows", icon: "⛓", gated: true },
      { to: "tools", label: "Tools & Skills", icon: "⚒" },
      { to: "packages", label: "Packages", icon: "▣" },
      { to: "config", label: "Config & Caps", icon: "⚙", gated: true },
    ],
  },
  {
    title: "Operate",
    items: [
      { to: "runs", label: "Runs", icon: "≣" },
      { to: "ship", label: "Ship / Targets", icon: "⬡", gated: true },
      { to: "health", label: "Health", icon: "♥" },
    ],
  },
];
```

In the component, derive `pid` and the running badge condition (which used `it.to === "/runs"` → now `it.to === "runs"`):

```tsx
export function Sidebar() {
  const { pid } = useParams();
  const running = useStore((s) => s.runs.filter((r) => r.status === "running").length);
  return (
    <aside className="flex w-[150px] flex-col gap-0.5 border-r border-border bg-surface px-2 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        <span className="h-4 w-4 rounded bg-accent" />
        <strong className="text-xs">tau-web-ui</strong>
      </div>
      {GROUPS.map((group, gi) => (
        <div key={group.title ?? `g${gi}`} className="mb-1">
          {group.title && (
            <div className="px-2 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-wider text-muted">
              {group.title}
            </div>
          )}
          {group.items.map((it) => (
            <NavLink
              key={it.to}
              to={`/projects/${pid}/${it.to}`}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                  isActive ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"
                }`
              }
            >
              <span aria-hidden>{it.icon}</span>
              {it.label}
              {it.gated && (
                <span className="ml-auto rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">
                  gated
                </span>
              )}
              {it.to === "runs" && running > 0 && (
                <span className="ml-auto rounded-full bg-st-running-soft px-1.5 text-[10px] font-semibold text-st-running">
                  {running}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 2: Update `Sidebar.test.tsx` to expect scoped hrefs**

Replace the href expectations block in `web/src/app/Sidebar.test.tsx`. Wrap renders in a router whose path provides `:pid`, using `MemoryRouter` + a `Routes` so `useParams` resolves `pid=demo`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ runs: [] }));

function renderAt(pid = "demo") {
  render(
    <MemoryRouter initialEntries={[`/projects/${pid}/runs`]}>
      <Routes>
        <Route path="/projects/:pid/*" element={<Sidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("renders the Build and Operate group labels", () => {
    renderAt();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Operate")).toBeInTheDocument();
  });

  it("renders all surface links scoped to the active project", () => {
    renderAt();
    const expected: [RegExp, string][] = [
      [/dashboard/i, "/projects/demo/dashboard"],
      [/agents/i, "/projects/demo/agents"],
      [/workflows/i, "/projects/demo/workflows"],
      [/tools/i, "/projects/demo/tools"],
      [/packages/i, "/projects/demo/packages"],
      [/config/i, "/projects/demo/config"],
      [/runs/i, "/projects/demo/runs"],
      [/ship/i, "/projects/demo/ship"],
      [/health/i, "/projects/demo/health"],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("badges the partially-gated areas (Workflows, Config, Ship)", () => {
    renderAt();
    expect(screen.getAllByText(/gated/i)).toHaveLength(3);
  });

  it("shows a running-count badge on Runs when runs are in flight", () => {
    useStore.setState({
      runs: [{ id: "a", status: "running" } as never, { id: "b", status: "completed" } as never],
    });
    renderAt();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Rewrite `Navbar.tsx` with a project switcher**

Replace `web/src/app/Navbar.tsx` with:

```tsx
import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useStore } from "../store/store";

function subRoute(pathname: string, pid: string): string {
  const prefix = `/projects/${pid}/`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "runs";
}

export function Navbar() {
  const { pid } = useParams();
  const projects = useStore((s) => s.projects);
  const project = useStore((s) => s.project);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const activeName = projects.find((p) => p.meta.id === pid)?.meta.name ?? pid ?? "project";

  function switchTo(nextPid: string) {
    setOpen(false);
    navigate(`/projects/${nextPid}/${subRoute(pathname, pid ?? "")}`);
  }

  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
      <div className="relative">
        <button
          aria-label="project switcher"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-semibold"
        >
          <span aria-hidden>▦</span>
          {activeName}
          <span aria-hidden>▾</span>
        </button>
        {open && (
          <div className="absolute left-0 z-10 mt-1 w-44 rounded-md border border-border bg-surface p-1 shadow-lg">
            {projects.map((p) => (
              <button
                key={p.meta.id}
                onClick={() => switchTo(p.meta.id)}
                className={`block w-full rounded px-2 py-1 text-left text-xs ${
                  p.meta.id === pid ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"
                }`}
              >
                {p.meta.name}
              </button>
            ))}
            <Link
              to="/"
              onClick={() => setOpen(false)}
              className="mt-1 block border-t border-border px-2 pt-1.5 text-xs text-muted hover:text-fg"
            >
              Manage projects…
            </Link>
          </div>
        )}
      </div>
      <span className="ml-auto font-mono text-xs text-muted">
        {project?.project_path ?? "connecting…"}
      </span>
      <span
        title={project ? "engine reachable" : "no engine"}
        className={`h-2.5 w-2.5 rounded-full ${project ? "bg-st-ok" : "bg-st-error"}`}
      />
      <span className="text-xs text-muted">tau {project?.tau_version ?? "—"}</span>
    </header>
  );
}
```

- [ ] **Step 4: Update `Navbar.test.tsx` + add `switcher.test.tsx`**

Replace `web/src/app/Navbar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useStore } from "../store/store";

function renderAt(pid = "demo") {
  render(
    <MemoryRouter initialEntries={[`/projects/${pid}/runs`]}>
      <Routes>
        <Route path="/projects/:pid/*" element={<Navbar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Navbar", () => {
  it("shows the project path and tau version", () => {
    useStore.setState({
      project: { project_path: "/p/demo", agents: ["greeter"], tau_version: "0.0.0-mock" },
      projects: [],
    });
    renderAt();
    expect(screen.getByText(/\/p\/demo/)).toBeInTheDocument();
    expect(screen.getByText(/0\.0\.0-mock/)).toBeInTheDocument();
  });
});
```

Create `web/src/app/switcher.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useStore } from "../store/store";

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="loc">{pathname}</div>;
}

function setup(pid = "demo") {
  useStore.setState({
    project: null,
    projects: [
      { meta: { id: "demo", name: "demo", path: "/p", source: { kind: "local" } }, summary: {} } as never,
      { meta: { id: "acme-bot", name: "acme-bot", path: "/q", source: { kind: "local" } }, summary: {} } as never,
    ],
  });
  render(
    <MemoryRouter initialEntries={[`/projects/${pid}/runs`]}>
      <Routes>
        <Route path="/projects/:pid/*" element={<><Navbar /><Probe /></>} />
        <Route path="/" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("project switcher", () => {
  it("switches to another project preserving the sub-route", async () => {
    const user = userEvent.setup();
    setup("demo");
    await user.click(screen.getByLabelText("project switcher"));
    await user.click(screen.getByRole("button", { name: "acme-bot" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/projects/acme-bot/runs");
  });
});
```

If `@testing-library/user-event` is not already a dependency, add it: `cd web && pnpm add -D @testing-library/user-event`. (Check first: `grep user-event web/package.json`.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd web && pnpm test -- src/app/Sidebar.test.tsx src/app/Navbar.test.tsx src/app/switcher.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/Sidebar.tsx web/src/app/Navbar.tsx web/src/app/Sidebar.test.tsx web/src/app/Navbar.test.tsx web/src/app/switcher.test.tsx web/package.json
git commit -m "feat(web): project-scoped sidebar + navbar switcher"
```

---

## Task 6: Projects home (cards + add + activity)

**Files:**
- Create: `web/src/projects/ProjectCard.tsx`, `web/src/projects/AddProjectForm.tsx`, `web/src/projects/ActivityFeed.tsx`
- Replace: `web/src/projects/ProjectsHome.tsx`
- Test: `web/src/projects/ProjectsHome.test.tsx`, `web/src/projects/ActivityFeed.test.tsx`

- [ ] **Step 1: ProjectCard**

Create `web/src/projects/ProjectCard.tsx`:

```tsx
import { useNavigate } from "react-router-dom";
import type { ProjectListItem } from "../types/ProjectListItem";

const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

function dotColor(item: ProjectListItem): string {
  if (!item.summary.engine_ok) return "bg-st-error";
  if (item.summary.running > 0) return "bg-st-running";
  return "bg-st-ok";
}

export function ProjectCard({ item }: { item: ProjectListItem }) {
  const navigate = useNavigate();
  const s = item.summary;
  return (
    <button
      onClick={() => navigate(`/projects/${item.meta.id}/dashboard`)}
      className="rounded-lg border border-border bg-surface p-3 text-left hover:border-accent"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor(item)}`} />
        <strong className="text-sm">{item.meta.name}</strong>
        <span className="ml-auto font-mono text-[10px] text-muted">{item.meta.path}</span>
      </div>
      <div className="flex gap-4 text-xs">
        <span>
          <b>{s.runs}</b> runs
        </span>
        <span className={s.failed_24h > 0 ? "text-st-error" : ""}>
          <b>{s.failed_24h}</b> failed
        </span>
        <span className="text-st-ok">
          <b>{Math.round(s.success_rate * 100)}%</b>
        </span>
        <span>
          <b>{fmtTok(s.tokens)}</b> tok
        </span>
      </div>
      <div className="mt-1.5 text-[10px] text-muted">
        {s.agents} agents · {s.running} running
        {!s.engine_ok && " · engine down"}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: AddProjectForm**

Create `web/src/projects/AddProjectForm.tsx`:

```tsx
import { useState } from "react";
import { addProjectByPath, addProjectByGit } from "../api/projects";

export function AddProjectForm({ onAdded }: { onAdded: () => void }) {
  const [path, setPath] = useState("");
  const [git, setGit] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(kind: "path" | "git") {
    setError(null);
    try {
      if (kind === "path") {
        if (!path.trim()) return;
        await addProjectByPath(path.trim());
        setPath("");
      } else {
        if (!git.trim()) return;
        await addProjectByGit(git.trim());
        setGit("");
      }
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to add project");
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-accent/50 p-3 text-xs">
      <div className="mb-2 font-semibold text-accent">+ Add project</div>
      <div className="mb-2 flex gap-2">
        <input
          aria-label="project path"
          placeholder="/abs/path/to/project"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1"
        />
        <button
          onClick={() => submit("path")}
          className="rounded bg-accent px-2 py-1 font-semibold text-accent-fg"
        >
          Add path
        </button>
      </div>
      <div className="flex gap-2">
        <input
          aria-label="project git url"
          placeholder="https://github.com/org/repo.git"
          value={git}
          onChange={(e) => setGit(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1"
        />
        <button
          onClick={() => submit("git")}
          className="rounded bg-accent px-2 py-1 font-semibold text-accent-fg"
        >
          Clone
        </button>
      </div>
      {error && <div className="mt-2 text-st-error">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 3: ActivityFeed**

Create `web/src/projects/ActivityFeed.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCrossRuns } from "../api/projects";
import type { CrossProjectRun } from "../types/CrossProjectRun";

const STATUS_CLASS: Record<string, string> = {
  failed: "bg-st-error/15 text-st-error",
  completed: "bg-st-ok/15 text-st-ok",
  running: "bg-st-running/15 text-st-running",
  cancelled: "bg-st-cancelled/15 text-st-cancelled",
};

export function ActivityFeed() {
  const [mode, setMode] = useState<"failures" | "all">("failures");
  const [rows, setRows] = useState<CrossProjectRun[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const status = mode === "failures" ? "failed" : undefined;
    getCrossRuns(status, 30)
      .then(setRows)
      .catch(() => setRows([]));
  }, [mode]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs font-semibold">
        Activity
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => setMode("failures")}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              mode === "failures" ? "bg-accent text-accent-fg" : "border border-border text-muted"
            }`}
          >
            Failures
          </button>
          <button
            onClick={() => setMode("all")}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              mode === "all" ? "bg-accent text-accent-fg" : "border border-border text-muted"
            }`}
          >
            All runs
          </button>
        </div>
      </div>
      {rows.length === 0 && <div className="px-3 py-4 text-xs text-muted">No activity.</div>}
      {rows.map((r) => (
        <button
          key={`${r.project_id}-${r.run.id}`}
          onClick={() => navigate(`/projects/${r.project_id}/runs/${r.run.id}`)}
          className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-xs last:border-0 hover:bg-accent/5"
        >
          <span className="rounded bg-bg px-1.5 py-0.5 text-[10px] font-semibold text-muted">
            {r.project_name}
          </span>
          <b className="truncate">{r.run.agent_id}</b>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              STATUS_CLASS[r.run.status] ?? "bg-bg text-muted"
            }`}
          >
            {r.run.status}
          </span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: ProjectsHome (replace placeholder)**

Replace `web/src/projects/ProjectsHome.tsx` with:

```tsx
import { useEffect } from "react";
import { useStore } from "../store/store";
import { ProjectCard } from "./ProjectCard";
import { AddProjectForm } from "./AddProjectForm";
import { ActivityFeed } from "./ActivityFeed";

const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-lg font-bold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function ProjectsHome() {
  const projects = useStore((s) => s.projects);
  const loadProjects = useStore((s) => s.loadProjects);

  useEffect(() => {
    loadProjects().catch(() => {});
  }, [loadProjects]);

  const totalRuns = projects.reduce((a, p) => a + p.summary.runs, 0);
  const running = projects.reduce((a, p) => a + p.summary.running, 0);
  const failed24h = projects.reduce((a, p) => a + p.summary.failed_24h, 0);
  const tokens = projects.reduce((a, p) => a + p.summary.tokens, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <h1 className="text-lg font-bold">Projects</h1>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Projects" value={projects.length} />
        <Stat label="Runs (all)" value={totalRuns} />
        <Stat label="Running" value={running} tone="text-st-running" />
        <Stat label="Failed (24h)" value={failed24h} tone="text-st-error" />
        <Stat label="Tokens" value={fmtTok(tokens)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.meta.id} item={p} />
          ))}
          <AddProjectForm onAdded={() => loadProjects()} />
        </div>
        <ActivityFeed />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the component tests**

Create `web/src/projects/ProjectsHome.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectsHome } from "./ProjectsHome";
import { useStore } from "../store/store";

function item(id: string, runs: number, failed: number) {
  return {
    meta: { id, name: id, path: `/p/${id}`, source: { kind: "local" } },
    summary: {
      runs,
      running: 1,
      failed_24h: failed,
      success_rate: 0.9,
      tokens: 1_200_000,
      last_activity: null,
      agents: 2,
      engine_ok: true,
    },
  };
}

beforeEach(() => {
  useStore.setState({ projects: [item("demo", 10, 1), item("acme-bot", 5, 0)] as never });
  // ActivityFeed + loadProjects both fetch — stub to empty.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

describe("ProjectsHome", () => {
  it("renders a card per project and the global summary", () => {
    render(
      <MemoryRouter>
        <ProjectsHome />
      </MemoryRouter>,
    );
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByText("acme-bot")).toBeInTheDocument();
    // global Runs (all) = 15
    expect(screen.getByText("15")).toBeInTheDocument();
    // add card present
    expect(screen.getByLabelText("project path")).toBeInTheDocument();
  });
});
```

Create `web/src/projects/ActivityFeed.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ActivityFeed } from "./ActivityFeed";

function run(pid: string, agent: string, status: string) {
  return {
    project_id: pid,
    project_name: pid,
    run: { id: `${pid}-${agent}`, agent_id: agent, status, started_at: "t" },
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("ActivityFeed", () => {
  it("loads failures first, then toggles to all runs", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [run("demo", "summariser", "failed")] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [run("demo", "greeter", "completed")],
      });
    vi.stubGlobal("fetch", f);

    render(
      <MemoryRouter>
        <ActivityFeed />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("summariser")).toBeInTheDocument());
    expect(f.mock.calls[0][0]).toContain("status=failed");

    await userEvent.click(screen.getByRole("button", { name: "All runs" }));
    await waitFor(() => expect(screen.getByText("greeter")).toBeInTheDocument());
    expect(f.mock.calls[1][0]).not.toContain("status=");
  });
});
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd web && pnpm test -- src/projects/`
Expected: PASS (ProjectsHome + ActivityFeed). Confirm the temporary placeholder test in routing still passes — `routing.test.tsx` asserts `/projects home/i`; update that assertion to match the real home heading by changing it to `screen.getByRole("heading", { name: /projects/i })`.

Apply that routing-test tweak: in `web/src/app/routing.test.tsx`, replace the two `expect(screen.getByText(/projects home/i)).toBeInTheDocument();` lines with:

```tsx
expect(screen.getByRole("heading", { name: /^projects$/i })).toBeInTheDocument();
```

- [ ] **Step 7: Run the full web unit suite**

Run: `cd web && pnpm test`
Expected: ALL pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/projects/ web/src/app/routing.test.tsx
git commit -m "feat(web): projects home with cards, add form, cross-project activity feed"
```

---

## Task 7: E2e — repoint + home/add specs

**Files:**
- Modify: `web/e2e/run.spec.ts`

- [ ] **Step 1: Repoint existing specs and add home/add coverage**

Replace `web/e2e/run.spec.ts` with (every per-project nav goes through `/projects/demo/…`; the gateway auto-registers `--project ./fixtures/demo` as id `demo`):

```ts
import { test, expect } from "@playwright/test";

const P = "/projects/demo";

test("launch a run and watch the live trace build", async ({ page }) => {
  await page.goto(`${P}/runs`);
  await expect(page.getByLabel("agent")).toContainText("greeter");

  await page.getByLabel("prompt").fill("hello from e2e");
  const t0 = Date.now();
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByText(/Hello!/)).toBeVisible({ timeout: 1500 });
  const firstPaint = Date.now() - t0;
  expect(firstPaint).toBeLessThan(1500);

  await expect(page.getByText("fs-read")).toBeVisible();
  await page.getByText("fs-read").click();
  await expect(page.getByText(/"path"/)).toBeVisible();

  await expect(page.getByText("completed")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/tok/)).toBeVisible();

  await page.screenshot({ path: "../docs/verification/trace-complete.png", fullPage: true });

  await page.getByRole("button", { name: /back to runs/i }).click();
  await page.locator("table tbody tr").first().click();
  await expect(page.getByText("fs-read")).toBeVisible();
});

test("cancel mid-run", async ({ page }) => {
  await page.goto(`${P}/runs`);
  await page.getByLabel("prompt").fill("long run");
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("cancelled")).toBeVisible({ timeout: 5000 });
});

test("launch a workflow and watch the step trace", async ({ page }) => {
  await page.goto(`${P}/runs`);
  await page.getByRole("button", { name: "Workflow", exact: true }).click();
  await page.getByLabel("workflow").selectOption("nightly-research");
  await page.getByLabel("prompt").fill("q3 churn");
  await page.getByRole("button", { name: "Run" }).click();

  await expect(page.getByText("gather")).toBeVisible({ timeout: 5000 });
  await expect(page.getByText("save-results")).toBeVisible({ timeout: 5000 });

  await page.getByText("gather").click();
  await expect(page.getByText(/view agent trace/i)).toBeVisible();
  await expect(page.getByText("completed")).toBeVisible({ timeout: 5000 });
});

test("config + packages surfaces work", async ({ page }) => {
  await page.goto(`${P}/packages`);
  await expect(page.getByRole("cell", { name: "anthropic", exact: true })).toBeVisible({
    timeout: 5000,
  });
  await page.getByLabel("install git url").fill("https://github.com/acme/cooltool.git");
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect(page.getByRole("cell", { name: "cooltool", exact: true })).toBeVisible({
    timeout: 5000,
  });

  await page.goto(`${P}/config`);
  await expect(page.getByLabel("project name")).toBeVisible({ timeout: 5000 });
  await page.getByLabel("import git url").fill("https://github.com/acme/researcher-pro.git");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("cell", { name: "researcher-pro", exact: true })).toBeVisible({
    timeout: 5000,
  });
});

test("projects home lists the project and links into it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^projects$/i })).toBeVisible({ timeout: 5000 });
  // demo card is present and clickable
  await page.getByRole("button", { name: /demo/ }).first().click();
  await expect(page).toHaveURL(/\/projects\/demo\/dashboard/);
});

test("add a project by path from the home", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("project path").fill(process.cwd() + "/../fixtures/demo");
  await page.getByRole("button", { name: "Add path" }).click();
  // demo already registered → dedup keeps one card; assert no error surfaced
  await expect(page.getByText(/failed to add/i)).toHaveCount(0);
});
```

- [ ] **Step 2: Build the gateway + fake serve, then run e2e**

Run:

```bash
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```

Expected: all specs PASS. (The Playwright `webServer` already launches the gateway with `--project ./fixtures/demo`; its health check hits `/api/health`, which Plan 1 keeps as the global gateway health route.)

- [ ] **Step 3: Restore mutated fixtures**

The config+packages spec mutates `fixtures/demo/tau.toml`. Restore it:

```bash
git checkout fixtures/demo/tau.toml
```

- [ ] **Step 4: Commit**

```bash
git add web/e2e/run.spec.ts
git commit -m "test(web): repoint e2e under /projects/:pid + home/add specs"
```

---

## Task 8: Lint, typecheck, build green

**Files:** none (verification + fixes)

- [ ] **Step 1: Run the web CI gates**

Run:

```bash
cd web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

Expected: all green. Common fixes:
- Prettier: run `pnpm format` and re-check.
- ESLint unused imports (e.g. a leftover `State`/`useLocation`): remove them.
- TS: ensure `ProjectListItem`/`ProjectMeta`/`CrossProjectRun` type files exist (generated by Plan 1 Task 10). If missing, Plan 1 must be merged/applied first.

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "chore(web): lint/format/typecheck fixes for multi-project"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-multi-project-design.md`):
- §5.1 routing (`/` home, `/projects/:pid/*`, unknown-pid not-found, legacy→home catch-all) → Task 4. §5.2 active project + client chokepoint + `projects.ts` → Tasks 1, 2, 3. §5.3 ProjectsHome (summary strip, cards, add path/git, Activity Failures/All) → Task 6. §5.4 navbar switcher (lists projects, preserves sub-route, Manage→`/`) → Task 5. §6 web + e2e tests → Tasks 1–7. All covered. **Deferred:** per-card sparkline (no time-series in summary) — logged in File Structure.

**Placeholder scan:** none — every code step is complete. The Task 4 `ProjectsHome` is an intentional, labeled placeholder replaced in Task 6 (routing is tested against it first, then the assertion is tightened in Task 6 Step 6).

**Type consistency:** `setActiveProject`/`scopedPath` exported from `client.ts` and consumed by `config.ts` + store. Store adds `activeProjectId`, `projects: ProjectListItem[]`, `setActiveProject`, `loadProjects` — referenced consistently in AppLayout, Navbar, Sidebar, ProjectsHome. `ProjectListItem.{meta:{id,name,path,source},summary:{runs,running,failed_24h,success_rate,tokens,last_activity,agents,engine_ok}}` and `CrossProjectRun.{project_id,project_name,run}` match the gateway types from Plan 1 exactly. Route param is `:pid` everywhere (App, AppLayout, Sidebar, Navbar, switcher test).

**Cross-plan dependency:** Task 8 Step 1 notes that the generated TS types come from Plan 1 Task 10 — apply/merge Plan 1 before Plan 2's typecheck.
```
