# Transparent Workspace + Nav Shell — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nav shell persistent across the whole app (including the Projects overview, with scoped groups greyed when no project is active), render the built-in workspace as an "Unsaved" card with a Save-as flow, and surface Save-as in the navbar while inside the workspace.

**Architecture:** Split today's `AppLayout` into a persistent `AppShell` (sidebar+navbar+footer, reads `activeProjectId` from the store) and a `ProjectScope` element (reads `:pid`, activates the context, not-found guard). Sidebar/Navbar become store-driven. A shared `SaveAsProjectForm` posts to the workspace save-as endpoint.

**Tech Stack:** React 18, react-router-dom v6, Zustand, TypeScript, Tailwind, Vitest + Testing Library + user-event, Playwright.

This is **Plan 2 of 2** for the transparent workspace + nav shell (see `docs/superpowers/specs/2026-06-01-workspace-and-nav-shell-design.md`). It depends on Plan 1's `POST /api/workspace/save-as` + the `ProjectSource` `workspace` variant in the generated TS types.

**Task order note:** Sidebar/Navbar are converted to store-driven (Tasks 2-3) *before* the shell split (Task 4), so each task keeps the suite green.

---

## File Structure

**New:**
- `web/src/projects/SaveAsProjectForm.tsx` — path input → `saveWorkspaceAs`.
- `web/src/projects/UnsavedCard.tsx` — the workspace's "Unsaved" card on the overview.
- `web/src/app/AppShell.tsx` — persistent shell wrapping all routes.
- `web/src/app/ProjectScope.tsx` — per-project context activator + not-found guard.
- Tests: `web/src/projects/SaveAsProjectForm.test.tsx`.

**Modified:**
- `web/src/api/projects.ts` — `saveWorkspaceAs`.
- `web/src/app/Sidebar.tsx` + `Sidebar.test.tsx` — store-driven, Projects item, greying.
- `web/src/app/Navbar.tsx` + `Navbar.test.tsx` + `switcher.test.tsx` — store-driven, Save-as in workspace.
- `web/src/App.tsx` — shell/scope routing; `web/src/app/routing.test.tsx`.
- `web/src/projects/ProjectsHome.tsx` + `ProjectsHome.test.tsx` — Unsaved card + clear active project.

**Removed:**
- `web/src/app/AppLayout.tsx` (its role splits into AppShell + ProjectScope).

---

## Task 1: `saveWorkspaceAs` + `SaveAsProjectForm`

**Files:**
- Modify: `web/src/api/projects.ts`
- Create: `web/src/projects/SaveAsProjectForm.tsx`, `web/src/projects/SaveAsProjectForm.test.tsx`

- [ ] **Step 1: Add `saveWorkspaceAs` to `web/src/api/projects.ts`**

Append:

```ts
export const saveWorkspaceAs = (name: string): Promise<ProjectMeta> =>
  fetch("/api/workspace/save-as", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }).then(json<ProjectMeta>);
```

(`json` helper and `ProjectMeta` import already exist in this file.)

- [ ] **Step 2: Write the failing test `web/src/projects/SaveAsProjectForm.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SaveAsProjectForm } from "./SaveAsProjectForm";

beforeEach(() => vi.restoreAllMocks());

describe("SaveAsProjectForm", () => {
  it("posts the path and calls onSaved with the new project", async () => {
    const meta = { id: "saved", name: "saved", path: "/p/saved", source: { kind: "local" } };
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => meta });
    vi.stubGlobal("fetch", f);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<SaveAsProjectForm onSaved={onSaved} />);

    await user.type(screen.getByLabelText("project name"), "My Bot");
    await user.click(screen.getByRole("button", { name: /save as project/i }));

    expect(f.mock.calls[0][0]).toBe("/api/workspace/save-as");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ name: "My Bot" });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(meta));
  });

  it("shows an error when the gateway rejects", async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, text: async () => "target exists" });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    render(<SaveAsProjectForm onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText("project name"), "My Bot");
    await user.click(screen.getByRole("button", { name: /save as project/i }));
    await vi.waitFor(() => expect(screen.getByText(/target exists/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run to confirm fail**

Run: `cd web && pnpm test -- src/projects/SaveAsProjectForm.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `web/src/projects/SaveAsProjectForm.tsx`**

```tsx
import { useState } from "react";
import type { ProjectMeta } from "../types/ProjectMeta";
import { saveWorkspaceAs } from "../api/projects";

export function SaveAsProjectForm({ onSaved }: { onSaved: (m: ProjectMeta) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) return;
    try {
      onSaved(await saveWorkspaceAs(name.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  return (
    <div className="mt-2 text-xs">
      <div className="flex gap-2">
        <input
          aria-label="project name"
          placeholder="project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1"
        />
        <button
          onClick={submit}
          className="whitespace-nowrap rounded bg-accent px-2 py-1 font-semibold text-accent-fg"
        >
          Save as project
        </button>
      </div>
      {error && <div className="mt-1 text-st-error">{error}</div>}
    </div>
  );
}
```

Note: the gateway writes the project under its managed root from this name (no filesystem path from the client) — this is the path-traversal hardening from the security review.

- [ ] **Step 5: Run to confirm pass**

Run: `cd web && pnpm test -- src/projects/SaveAsProjectForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/api/projects.ts web/src/projects/SaveAsProjectForm.tsx web/src/projects/SaveAsProjectForm.test.tsx
git commit -m "feat(web): saveWorkspaceAs api + SaveAsProjectForm"
```

---

## Task 2: Sidebar — store-driven + Projects item + greying

**Files:**
- Modify: `web/src/app/Sidebar.tsx`, `web/src/app/Sidebar.test.tsx`

- [ ] **Step 1: Rewrite `web/src/app/Sidebar.tsx`**

```tsx
import { NavLink } from "react-router-dom";
import { useStore } from "../store/store";

interface Item {
  to: string;
  label: string;
  icon: string;
  gated?: boolean;
}
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

const ROW = "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs";

export function Sidebar() {
  const pid = useStore((s) => s.activeProjectId);
  const running = useStore((s) => s.runs.filter((r) => r.status === "running").length);
  const scoped = pid !== "";
  return (
    <aside className="flex w-[150px] flex-col gap-0.5 border-r border-border bg-surface px-2 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        <span className="h-4 w-4 rounded bg-accent" />
        <strong className="text-xs">tau-web-ui</strong>
      </div>

      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `${ROW} ${isActive ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"}`
        }
      >
        <span aria-hidden>▦</span>
        Projects
      </NavLink>

      {GROUPS.map((group, gi) => (
        <div key={group.title ?? `g${gi}`} className="mb-1">
          {group.title && (
            <div className="px-2 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-wider text-muted">
              {group.title}
            </div>
          )}
          {group.items.map((it) =>
            scoped ? (
              <NavLink
                key={it.to}
                to={`/projects/${pid}/${it.to}`}
                className={({ isActive }) =>
                  `${ROW} ${isActive ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"}`
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
            ) : (
              <div
                key={it.to}
                aria-disabled="true"
                title="Select a project first"
                className={`${ROW} cursor-not-allowed text-muted opacity-40`}
              >
                <span aria-hidden>{it.icon}</span>
                {it.label}
              </div>
            ),
          )}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 2: Rewrite `web/src/app/Sidebar.test.tsx`**

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ runs: [], activeProjectId: "demo" }));

function renderSidebar() {
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("always shows a Projects item linking to /", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: /projects/i })).toHaveAttribute("href", "/");
  });

  it("renders surface links scoped to the active project", () => {
    renderSidebar();
    const expected: [RegExp, string][] = [
      [/dashboard/i, "/projects/demo/dashboard"],
      [/agents/i, "/projects/demo/agents"],
      [/packages/i, "/projects/demo/packages"],
      [/runs/i, "/projects/demo/runs"],
      [/health/i, "/projects/demo/health"],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("greys (disables) the scoped groups when no project is active", () => {
    useStore.setState({ runs: [], activeProjectId: "" });
    renderSidebar();
    // Projects is still a link; Dashboard is not a link anymore
    expect(screen.getByRole("link", { name: /projects/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the running badge inside a project", () => {
    useStore.setState({
      runs: [{ id: "a", status: "running" } as never],
      activeProjectId: "demo",
    });
    renderSidebar();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run**

Run: `cd web && pnpm test -- src/app/Sidebar.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add web/src/app/Sidebar.tsx web/src/app/Sidebar.test.tsx
git commit -m "feat(web): store-driven sidebar with Projects item + greyed scoped groups"
```

---

## Task 3: Navbar — store-driven + Save-as in workspace

**Files:**
- Modify: `web/src/app/Navbar.tsx`, `web/src/app/Navbar.test.tsx`, `web/src/app/switcher.test.tsx`

- [ ] **Step 1: Rewrite `web/src/app/Navbar.tsx`**

```tsx
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { SaveAsProjectForm } from "../projects/SaveAsProjectForm";

function subRoute(pathname: string, pid: string): string {
  const prefix = `/projects/${pid}/`;
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "runs";
}

export function Navbar() {
  const pid = useStore((s) => s.activeProjectId);
  const projects = useStore((s) => s.projects);
  const project = useStore((s) => s.project);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const activeName =
    pid === "" ? "All projects" : (projects.find((p) => p.meta.id === pid)?.meta.name ?? pid);
  const isWorkspace = pid === "workspace";

  function switchTo(nextPid: string) {
    setOpen(false);
    navigate(`/projects/${nextPid}/${subRoute(pathname, pid)}`);
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
                  p.meta.id === pid
                    ? "bg-accent/10 font-semibold text-accent"
                    : "text-muted hover:text-fg"
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

      {isWorkspace && (
        <div className="relative">
          <button
            aria-label="save as project"
            onClick={() => setSaveOpen((o) => !o)}
            className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"
          >
            Unsaved · Save as project
          </button>
          {saveOpen && (
            <div className="absolute left-0 z-10 mt-1 w-80 rounded-md border border-border bg-surface p-2 shadow-lg">
              <SaveAsProjectForm
                onSaved={(m) => {
                  setSaveOpen(false);
                  navigate(`/projects/${m.id}/dashboard`);
                }}
              />
            </div>
          )}
        </div>
      )}

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

- [ ] **Step 2: Rewrite `web/src/app/Navbar.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useStore } from "../store/store";

function renderNavbar() {
  render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>,
  );
}

describe("Navbar", () => {
  it("shows the project path and tau version inside a project", () => {
    useStore.setState({
      project: { project_path: "/p/demo", agents: ["greeter"], tau_version: "0.0.0-mock" },
      projects: [],
      activeProjectId: "demo",
    });
    renderNavbar();
    expect(screen.getByText(/\/p\/demo/)).toBeInTheDocument();
    expect(screen.getByText(/0\.0\.0-mock/)).toBeInTheDocument();
  });

  it("shows 'All projects' and no Save-as on the overview", () => {
    useStore.setState({ project: null, projects: [], activeProjectId: "" });
    renderNavbar();
    expect(screen.getByLabelText("project switcher")).toHaveTextContent("All projects");
    expect(screen.queryByLabelText("save as project")).not.toBeInTheDocument();
  });

  it("shows Save-as only inside the workspace", () => {
    useStore.setState({ project: null, projects: [], activeProjectId: "workspace" });
    renderNavbar();
    expect(screen.getByLabelText("save as project")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Update `web/src/app/switcher.test.tsx`**

The switcher test must set `activeProjectId` in the store (Navbar no longer reads `:pid`). Replace its `setup` to seed the store and render the Navbar plainly:

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

function setup() {
  useStore.setState({
    project: null,
    activeProjectId: "demo",
    projects: [
      { meta: { id: "demo", name: "demo", path: "/p", source: { kind: "local" } }, summary: {} } as never,
      { meta: { id: "acme-bot", name: "acme-bot", path: "/q", source: { kind: "local" } }, summary: {} } as never,
    ],
  });
  render(
    <MemoryRouter initialEntries={["/projects/demo/runs"]}>
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
    setup();
    await user.click(screen.getByLabelText("project switcher"));
    await user.click(screen.getByRole("button", { name: "acme-bot" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/projects/acme-bot/runs");
  });
});
```

- [ ] **Step 4: Run**

Run: `cd web && pnpm test -- src/app/Navbar.test.tsx src/app/switcher.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/Navbar.tsx web/src/app/Navbar.test.tsx web/src/app/switcher.test.tsx
git commit -m "feat(web): store-driven navbar + workspace Save-as affordance"
```

---

## Task 4: Shell / scope split

**Files:**
- Create: `web/src/app/AppShell.tsx`, `web/src/app/ProjectScope.tsx`
- Modify: `web/src/App.tsx`, `web/src/projects/ProjectsHome.tsx`, `web/src/app/routing.test.tsx`
- Remove: `web/src/app/AppLayout.tsx`

- [ ] **Step 1: Create `web/src/app/AppShell.tsx`**

```tsx
import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useStore } from "../store/store";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

export function AppShell() {
  const loadProjects = useStore((s) => s.loadProjects);
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
            <Outlet />
          </main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/app/ProjectScope.tsx`**

```tsx
import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { useStore } from "../store/store";
import { setActiveProject as setClientProject } from "../api/client";
import { NotFound } from "../projects/NotFound";

export function ProjectScope() {
  const { pid } = useParams();
  const setActiveProject = useStore((s) => s.setActiveProject);
  const loadProject = useStore((s) => s.loadProject);
  const loadHealth = useStore((s) => s.loadHealth);
  const loadProjects = useStore((s) => s.loadProjects);
  const projects = useStore((s) => s.projects);

  // Set the scoped API prefix synchronously during render, before child route
  // effects (which run child-first) fire their data loads.
  if (pid) setClientProject(pid);

  useEffect(() => {
    if (!pid) return;
    setActiveProject(pid);
    loadProjects().catch(() => {});
    loadProject().catch(() => {});
    loadHealth().catch(() => {});
  }, [pid, setActiveProject, loadProjects, loadProject, loadHealth]);

  const known = projects.length === 0 || projects.some((p) => p.meta.id === pid);
  return known ? <Outlet /> : <NotFound />;
}
```

- [ ] **Step 3: Rewrite `web/src/App.tsx`**

```tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { ProjectScope } from "./app/ProjectScope";
import { StubPage } from "./app/StubPage";
import { ConfigPage } from "./config/ConfigPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { PackagesPage } from "./packages/PackagesPage";
import { RunsPage } from "./runs/RunsPage";
import { TracePage } from "./trace/TracePage";
import { ProjectsHome } from "./projects/ProjectsHome";
import { AgentsIndexPage } from "./agents/AgentsIndexPage";
import { AgentEditorPage } from "./agents/AgentEditorPage";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ProjectsHome />} />
        <Route path="projects/:pid" element={<ProjectScope />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="agents" element={<AgentsIndexPage />} />
          <Route path="agents/new" element={<AgentEditorPage />} />
          <Route path="agents/:agentId" element={<AgentEditorPage />} />
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
            element={
              <StubPage title="Health checks" subtitle="tau check & sandbox — coming soon." />
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 4: Clear the active project on the home**

In `web/src/projects/ProjectsHome.tsx`, import the store setter and clear `activeProjectId` on mount so the sidebar greys the scoped groups. Update the component's top:

```tsx
export function ProjectsHome() {
  const projects = useStore((s) => s.projects);
  const loadProjects = useStore((s) => s.loadProjects);
  const setActiveProject = useStore((s) => s.setActiveProject);

  useEffect(() => {
    setActiveProject("");
    loadProjects().catch(() => {});
  }, [setActiveProject, loadProjects]);
```

(Leave the rest of `ProjectsHome` unchanged for now; the Unsaved card lands in Task 5.)

- [ ] **Step 5: Delete `web/src/app/AppLayout.tsx`**

```bash
git rm web/src/app/AppLayout.tsx
```

- [ ] **Step 6: Update `web/src/app/routing.test.tsx`**

The not-found case relies on `projects` being seeded (so an unknown pid resolves to NotFound). Keep the existing seeded `projects` in `beforeEach`. The shell now renders on every route, so the home assertions still hold (ProjectsHome renders `<h1>Projects</h1>`). Re-run and adjust only if something breaks:

Run: `cd web && pnpm test -- src/app/routing.test.tsx`
Expected: PASS. If the "renders the Projects home at /" assertion now matches multiple "projects" texts, it already uses `getByRole("heading", { name: /^projects$/i })` which is unambiguous (the sidebar item is a `link`, not a heading) — no change needed. If the unknown-pid test fails because `projects` isn't loaded in time, ensure the `beforeEach` seeds `projects: [{ meta: { id: "demo", ... }, summary: {} }]` (it already does).

- [ ] **Step 7: Run the full suite + typecheck**

Run: `cd web && pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/AppShell.tsx web/src/app/ProjectScope.tsx web/src/App.tsx web/src/projects/ProjectsHome.tsx web/src/app/routing.test.tsx
git rm web/src/app/AppLayout.tsx
git commit -m "feat(web): persistent AppShell + ProjectScope; nav shell wraps the overview"
```

---

## Task 5: Unsaved card on the overview

**Files:**
- Create: `web/src/projects/UnsavedCard.tsx`
- Modify: `web/src/projects/ProjectsHome.tsx`, `web/src/projects/ProjectsHome.test.tsx`

- [ ] **Step 1: Create `web/src/projects/UnsavedCard.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectListItem } from "../types/ProjectListItem";
import { SaveAsProjectForm } from "./SaveAsProjectForm";

export function UnsavedCard({ item, onSaved }: { item: ProjectListItem; onSaved: () => void }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const s = item.summary;
  return (
    <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50/40 p-3">
      <button
        onClick={() => navigate(`/projects/${item.meta.id}/dashboard`)}
        className="w-full text-left"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-amber-100 px-1.5 text-[9px] font-bold uppercase text-amber-800">
            unsaved
          </span>
          <strong className="text-sm">Working environment</strong>
        </div>
        <div className="flex gap-4 text-xs">
          <span>
            <b>{s.runs}</b> runs
          </span>
          <span className={s.failed_24h > 0 ? "text-st-error" : ""}>
            <b>{s.failed_24h}</b> failed
          </span>
          <span>
            <b>{s.agents}</b> agents
          </span>
        </div>
      </button>
      {saving ? (
        <SaveAsProjectForm
          onSaved={(m) => {
            onSaved();
            navigate(`/projects/${m.id}/dashboard`);
          }}
        />
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="mt-2 rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800"
        >
          Save as project
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render the Unsaved card in `ProjectsHome.tsx`**

Add the import and partition the projects. Update the imports + the card grid:

```tsx
import { UnsavedCard } from "./UnsavedCard";
```

Replace the projects-derived values and the card grid. The `projects.reduce(...)` summary lines stay, but change the **Projects** stat to count real projects and split the list:

```tsx
  const workspace = projects.find((p) => p.meta.source.kind === "workspace");
  const realProjects = projects.filter((p) => p.meta.source.kind !== "workspace");

  const totalRuns = projects.reduce((a, p) => a + p.summary.runs, 0);
  const running = projects.reduce((a, p) => a + p.summary.running, 0);
  const failed24h = projects.reduce((a, p) => a + p.summary.failed_24h, 0);
  const tokens = projects.reduce((a, p) => a + Number(p.summary.tokens), 0);
```

Change the Projects stat value to `realProjects.length`:

```tsx
        <Stat label="Projects" value={realProjects.length} />
```

And the card grid (Unsaved card first, then real projects, then Add):

```tsx
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {workspace && <UnsavedCard item={workspace} onSaved={() => loadProjects()} />}
          {realProjects.map((p) => (
            <ProjectCard key={p.meta.id} item={p} />
          ))}
          <AddProjectForm onAdded={() => loadProjects()} />
        </div>
```

- [ ] **Step 3: Update `web/src/projects/ProjectsHome.test.tsx`**

Add the workspace item to the fixture and assert the Unsaved card renders + real projects still show. Replace the `item` factory and the test body:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectsHome } from "./ProjectsHome";
import { useStore } from "../store/store";

function summary() {
  return {
    runs: 3,
    running: 0,
    failed_24h: 0,
    success_rate: 1,
    tokens: 0,
    last_activity: null,
    agents: 1,
    engine_ok: true,
  };
}

beforeEach(() => {
  useStore.setState({
    projects: [
      { meta: { id: "workspace", name: "workspace", path: "/w", source: { kind: "workspace" } }, summary: summary() },
      { meta: { id: "demo", name: "demo", path: "/p/demo", source: { kind: "local" } }, summary: summary() },
    ] as never,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

describe("ProjectsHome", () => {
  it("renders the Unsaved card + real project cards + global summary", () => {
    render(
      <MemoryRouter>
        <ProjectsHome />
      </MemoryRouter>,
    );
    expect(screen.getByText(/working environment/i)).toBeInTheDocument();
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByLabelText("project path")).toBeInTheDocument();
    // The workspace renders as the Unsaved card, NOT as a normal ProjectCard
    // (ProjectCard navigates to /dashboard via a button labelled by the project
    // name); there must be no card titled "workspace".
    expect(screen.queryByText("workspace")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run**

Run: `cd web && pnpm test -- src/projects/ProjectsHome.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `cd web && pnpm test && pnpm typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/projects/UnsavedCard.tsx web/src/projects/ProjectsHome.tsx web/src/projects/ProjectsHome.test.tsx
git commit -m "feat(web): Unsaved workspace card with Save-as on the overview"
```

---

## Task 6: E2e + final gate

**Files:**
- Modify: `web/e2e/run.spec.ts`

- [ ] **Step 1: Append the workspace spec**

```ts
test("nav shell on the overview + workspace save-as", async ({ page }) => {
  await page.goto("/");
  // shell is present on the overview; scoped groups are greyed (Dashboard is not a link)
  await expect(page.getByRole("link", { name: /projects/i }).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("link", { name: /^dashboard$/i })).toHaveCount(0);

  // the Unsaved card is present; enter the workspace
  await expect(page.getByText(/working environment/i)).toBeVisible();
  await page.getByText(/working environment/i).click();
  await expect(page).toHaveURL(/\/projects\/workspace\/dashboard/);
  // inside the workspace the scoped nav is live
  await expect(page.getByRole("link", { name: /^agents$/i })).toBeVisible({ timeout: 5000 });

  // author an agent in the workspace
  await page.goto("/projects/workspace/agents/new");
  await page.getByLabel("agent id").fill("ws-bot");
  await page.getByLabel("system prompt").fill("hi");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // save the workspace as a real project from the navbar affordance
  await page.getByLabel("save as project").click();
  await page.getByLabel("project name").fill("e2e saved " + Date.now());
  await page.getByRole("button", { name: /save as project/i }).click();

  // we land in the new project, and it has the agent
  await expect(page).toHaveURL(/\/projects\/[^/]+\/dashboard/);
  await page.goto(page.url().replace("/dashboard", "/agents"));
  await expect(page.getByRole("link", { name: "ws-bot" })).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL specs PASS. A genuine assertion failure → STOP and report BLOCKED with specifics. Missing-browser infra error → `pnpm exec playwright install chromium` then retry; if browsers truly unavailable, fall back to `pnpm exec playwright test --list` and note e2e was deferred to CI.

- [ ] **Step 3: Restore mutated fixtures**

The e2e's saved projects land under the gateway's managed data root (`~/.tau-web-ui/saved/…`, uniquely named per run) — they don't touch the repo, so no cleanup is needed there. Just restore repo fixtures:

```bash
cd /Users/titouanlebocq/code/tau-ui && git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null; true
```

- [ ] **Step 4: Full web gate (mirror CI)**

Run: `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
Expected: all green. If `format:check` fails, `pnpm format`, re-check, include formatting in the commit.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source if pnpm format changed files (git status)
git commit -m "test(web): e2e nav shell + workspace save-as"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-workspace-and-nav-shell-design.md`):
- §4.1 shell/scope split (AppShell wraps `/` + `/projects/:pid`; ProjectScope activates + not-found; ProjectsHome clears active project; AppLayout removed) → Task 4. §4.2 sidebar (Projects item, greying) → Task 2; navbar (store-driven, "All projects", Save-as in workspace) → Task 3. §4.3 Unsaved card + Save-as + `saveWorkspaceAs` → Tasks 1 & 5. §5 web tests → Tasks 1-5; e2e → Task 6. All covered.

**Placeholder scan:** none — every code step is complete. Task 4 Step 6 gives the executor a concrete run-and-adjust instruction for `routing.test.tsx` with the exact reason each assertion still holds (not a vague "fix tests").

**Type consistency:** `saveWorkspaceAs(path) → ProjectMeta` is used identically in `SaveAsProjectForm`, `UnsavedCard`, and the navbar. `activeProjectId` (store, `""` when none) drives Sidebar (`scoped = pid !== ""`), Navbar (`"All projects"` / `isWorkspace = pid === "workspace"`), and ProjectsHome (cleared on mount). `p.meta.source.kind === "workspace"` matches the `ProjectSource` TS union from Plan 1. Route params: `:pid` (+ `:agentId`) unchanged; `ProjectScope` reads `:pid`, `AppShell` is pathless.

**Cross-plan dependency:** `saveWorkspaceAs` hits `POST /api/workspace/save-as` and `ProjectSource`'s `workspace` variant — both from Plan 1; apply/merge Plan 1 first.
