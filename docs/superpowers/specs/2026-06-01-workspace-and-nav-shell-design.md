# Transparent workspace + nav shell — design

**Status:** approved (brainstorm 2026-06-01)
**Sub-project of:** [Product Information Architecture](2026-05-31-product-information-architecture.md) — refines the app shell + multi-project landing.
**Decomposition:** two implementation plans — (1) gateway workspace + save-as, (2) frontend nav-shell + Unsaved card + Save-as. Plan 2 builds on plan 1's API.

## 1. Goal & motivation

Two coupled problems with the current shipped UI:

1. **The nav disappears on the landing.** The Projects home (`/`) was built chrome-free; the sidebar/navbar only mount inside a project, so the landing feels like a different app. The nav shell should be present everywhere.
2. **Project-required cold start is high friction.** You must create/register a `tau.toml` project before you can author an agent or run anything. There should be a zero-setup working environment you can use immediately and later promote to a real project.

The resolution keeps tau's spine intact (files are the source of truth; everything is a real project on disk): introduce a **transparent working environment** — an auto-provisioned, UI-managed project that is never shown as a named/pathed project. In the UI it appears only as an **"Unsaved"** card; you work in it immediately and **Save as project** to persist it. The word **"sandbox"** stays reserved for tau's execution-isolation tier — the working environment is never called a sandbox.

Locked decisions (brainstorm):
- Nav shell wraps **everything**; on the overview (no active context) the project-scoped sidebar groups render **greyed/disabled**.
- The landing **stays the Projects overview**; the working environment appears there as a special **Unsaved** card alongside real projects.
- The working environment has **no visible name/path** — surfaced only as "Unsaved".
- **Save as project** copies the env's files to a chosen directory, registers it, and **resets** the working environment to a clean slate.

## 2. Architecture overview

- The gateway's `ProjectRegistry` gains an always-present **workspace** project (reserved id `workspace`, `source: Workspace`) auto-provisioned at `<data_root>/workspace/`. It behaves like any project (runs, config, agents all work) but is marked so the frontend renders it specially and the gateway protects it.
- A `save_workspace_as(target)` operation copies the workspace's authoring files to a user-chosen directory, registers that as a normal `Local` project, and resets the workspace.
- The frontend splits the shell from project-scoping: a persistent `AppShell` wraps both the overview and project routes; a `ProjectScope` element activates the project context under `/projects/:pid`. The Projects overview renders the workspace as the Unsaved card with a Save-as affordance.

## 3. Gateway

### 3.1 `ProjectSource::Workspace`

In `gateway/src/projects/mod.rs`, extend the enum:

```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProjectSource {
    Local,
    Git { url: String },
    Workspace,
}
```

`ProjectMeta` is unchanged (`{ id, name, path, source }`); the workspace carries `id: "workspace"`, `name: "workspace"`, a real `path` (hidden by the frontend), `source: Workspace`.

### 3.2 `ensure_workspace`

Called by `ProjectRegistry::load` **first — before** the `projects.json` entries are inserted:
- Create `<data_root>/workspace/tau.toml` if absent (minimal `[project]\nname = "workspace"\n`), then register the workspace entry **in-memory only** under the reserved id `workspace` (it is deterministic and re-ensured every start, so it is *not* written to `projects.json`).
- Because the reserved id is claimed first, the `workspace` slot always belongs to the built-in workspace; a user who later adds a project literally named "workspace" dedupes to `workspace-2` (existing `unique_id` behavior). Manifest entries are then inserted after; their ids were always slugged at add-time and won't be `workspace`.

The workspace's run store is the normal per-project dir `<data_root>/projects/workspace/runs/`, so `list_summaries`/`cross_runs` include it like any project.

### 3.3 Guard `remove`

`ProjectRegistry::remove(id)` returns an error (or `false` + no-op) when `id == "workspace"` — the built-in workspace cannot be unregistered.

### 3.4 `save_workspace_as`

```rust
pub async fn save_workspace_as(&self, name: &str) -> Result<ProjectMeta>
```
The caller supplies a **project name, never a filesystem path** — so there is no path-traversal / arbitrary-write surface (per the commit security review).
1. Trim `name`; **bail** if empty. Compute `slug(name)`; **bail** if the slug is empty. The target is the managed path `<data_root>/saved/<slug>`; **bail** if it already exists.
2. **Recursively copy** the workspace *project dir* (`<data_root>/workspace/`) into the target — `tau.toml`, `agents/`, `workflows/`, and any referenced files. The run store is a *separate* dir, so only authoring files travel; the new project starts with no run history. (A small private recursive-copy helper; no new dependency.)
3. Stamp the chosen display name into the copied project (`config::write_project(&target, name, None)`), then `add_local(target)` → registers it as a normal `Local` project (persisted to `projects.json`); the project id is the deduped slug of the name.
4. **Reset** the workspace: overwrite `<data_root>/workspace/tau.toml` back to the minimal blank, remove `agents/` and `workflows/` under it, and clear the workspace run store dir (`<data_root>/projects/workspace/runs/`).
5. Return the new project's `ProjectMeta`.

### 3.5 API

One global route (mirrors the existing `/api/projects` global handlers):

| Method | Route | Body / result | Errors |
|---|---|---|---|
| POST | `/api/workspace/save-as` | `{ name }` → `ProjectMeta` (the new project) | `400` on empty/invalid/duplicate name with a readable message |

`GET /api/projects` already returns the workspace (frontend renders the Unsaved card). The new `Workspace` variant exports to `web/src/types/ProjectSource.ts` via the existing ts-rs drift gate.

## 4. Frontend

### 4.1 Shell / scope split (routing)

Replace the current `AppLayout`-owns-everything structure:

```tsx
<Routes>
  <Route element={<AppShell />}>
    <Route index element={<ProjectsHome />} />            {/* "/" */}
    <Route path="projects/:pid" element={<ProjectScope />}>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="agents" element={<AgentsIndexPage />} />
      <Route path="agents/new" element={<AgentEditorPage />} />
      <Route path="agents/:agentId" element={<AgentEditorPage />} />
      <Route path="workflows" element={<StubPage … gated />} />
      <Route path="tools" element={<StubPage … />} />
      <Route path="packages" element={<PackagesPage />} />
      <Route path="config" element={<ConfigPage />} />
      <Route path="runs" element={<RunsPage />} />
      <Route path="runs/:id" element={<TracePage />} />
      <Route path="ship" element={<StubPage … gated />} />
      <Route path="health" element={<StubPage … />} />
    </Route>
  </Route>
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

- **`AppShell`** (new; replaces `AppLayout`'s outer role): renders `Sidebar` + `Navbar` + `<main><Outlet/></main>` + `Footer`. Loads the projects list on mount. Reads the active context from the store (`activeProjectId`), not `useParams`.
- **`ProjectScope`** (new): reads `:pid`; sets the API client prefix synchronously during render (cold-load correctness, as already done); in an effect sets the store `activeProjectId`, loads project + health + projects; renders the not-found guard (unknown pid → `NotFound`) or `<Outlet/>`.
- **`ProjectsHome`** (the `/` index): on mount sets `activeProjectId` to `""` so the sidebar greys the scoped groups.
- Legacy `AppLayout.tsx` is removed; its pieces move into `AppShell` + `ProjectScope`.

### 4.2 Sidebar & Navbar

- **Sidebar** reads `activeProjectId` from the store. A **Projects** item at the top links to `/` (active when `activeProjectId === ""`). The scoped groups (Dashboard / Build / Operate) render as `NavLink`s to `/projects/${activeProjectId}/…` when a context is active, and as **disabled, greyed** rows (no navigation) when `activeProjectId === ""`.
- **Navbar** reads `activeProjectId`: the switcher shows **"All projects"** on the overview, the context's display name inside a project. When `activeProjectId === "workspace"`, the navbar also shows a **Save as project** action (opens the same save-as form). "Manage projects…" links to `/`.

### 4.3 Projects overview — Unsaved card + Save-as

- `ProjectsHome` partitions the `listProjects()` result: the item with `meta.source.kind === "workspace"` is rendered **first** as a distinct **Unsaved** card (dashed/amber styling, same mini-dashboard numbers), the rest as normal `ProjectCard`s. Clicking the Unsaved card → `/projects/workspace/dashboard`.
- A **`SaveAsProjectForm`** (project-**name** input + Save) is available on the Unsaved card and from the navbar action. It calls `saveWorkspaceAs(name)`; on success it navigates to the returned project (`/projects/:newId/dashboard`) and refreshes the projects list. Gateway `400` errors render inline. (Name, not a path — the gateway writes under its managed root; see §3.4.)
- New API fn in `web/src/api/projects.ts`: `saveWorkspaceAs(name: string): Promise<ProjectMeta>` → `POST /api/workspace/save-as` with `{ name }`.

## 5. Testing

**Gateway:**
- `ensure_workspace` creates the dir + `tau.toml` and registers id `workspace` with `source: Workspace`; idempotent across reloads; a user project named "workspace" dedupes to `workspace-2`.
- `remove("workspace")` refuses (error/`false`, still registered).
- `save_workspace_as`: copies authoring files (incl. an `agents/` subdir) into the target, registers it as `Local`, the new project has the workspace's agents but **no runs**; the workspace is reset (blank `tau.toml`, no `agents/`, empty run store); `400` when the target already has a `tau.toml`.
- `list_summaries` includes the workspace.

**Web (vitest):**
- `AppShell` renders Sidebar + Navbar on `/` (overview); scoped sidebar groups are disabled/greyed (no project href) when `activeProjectId === ""`, and become links inside a project.
- `ProjectScope` sets the active project and renders the surface; unknown pid → NotFound.
- `ProjectsHome` renders the workspace as the Unsaved card (distinct from `ProjectCard`s) and click-through routes to `/projects/workspace/dashboard`.
- `SaveAsProjectForm` posts the path and navigates to the new project; inline error on failure.
- Navbar shows Save-as only when `activeProjectId === "workspace"`.

**E2e (Playwright):**
- Open `/` → the **Unsaved** card is present → click it → land in `/projects/workspace/…` with the full sidebar live → create an agent there → **Save as project** with a temp path → a new project card appears in the overview and the new project is active; the Unsaved card resets (no agents). Restores any mutated fixtures afterward.

## 6. ts-rs / CI

Only `ProjectSource` changes shape (new `Workspace` variant) — regenerated `web/src/types/ProjectSource.ts` is committed via the existing drift gate. No CI job changes.

## 7. Out of scope (YAGNI)

- Multiple workspaces / named scratch environments — exactly one reserved workspace.
- Migrating existing run history into a saved project (Save-as copies authoring files only).
- A confirmation/undo for the workspace reset beyond the Save-as success (the reset only happens on a successful save).
- Git-clone as a save-as target, or saving directly to a remote.
- Changing the per-surface gating of Workflows/Tools/Ship/Health (unchanged stubs).
