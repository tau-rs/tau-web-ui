# Multi-project support — design

**Status:** approved (brainstorm 2026-06-01)
**Sub-project of:** [Product Information Architecture](2026-05-31-product-information-architecture.md)
**Decomposition:** two implementation plans — (1) gateway multi-project, (2) frontend multi-project. Plan 2 builds on plan 1's API. Each produces working, testable software on its own.

## 1. Goal

Let the tau-web-ui manage **multiple tau projects** instead of the single project passed via `--project`. Users land on a **global Projects home** (cross-project summary, per-project cards, and a cross-project runs/failures feed), switch projects from a navbar dropdown, and add projects by **local path or git clone**. Every existing surface (Dashboard, Runs, Workflows, Config, Packages, gated Ship/Health) becomes project-scoped.

Locked product decisions:
- **UX pattern B**: navbar project switcher **+** a dedicated Projects surface.
- The Projects surface is the **home page** (`/`) and is a **global cross-project view** that surfaces failures and runs.
- **Add project** supports **local path** and **git clone**.
- The mock-first / mark-gated convention is unchanged: real `tau serve` still does not exist; everything runs against `fake-tau-serve` in mock mode.

## 2. Architecture overview

Today `gateway/src/main.rs` builds one `AppState` from `--project` and hands it to `api::router`. Multi-project introduces a **`ProjectRegistry`** that owns many `AppState`s. The existing `AppState` internals are unchanged — it simply stops being a singleton and becomes per-project. The HTTP API gains a `/api/projects/:pid/…` prefix for everything project-scoped, plus a small set of unscoped global endpoints for the home and project management.

```
ProjectRegistry (RwLock<IndexMap<ProjectId, ProjectEntry>>)
  ProjectEntry { meta: ProjectMeta, state: AppState }   // AppState = today's per-project engine
  persisted to ~/.tau-web-ui/projects.json
  per-project run store at ~/.tau-web-ui/projects/<id>/runs/
```

## 3. Gateway: registry + scoping

### 3.1 Types

```rust
// gateway/src/projects/mod.rs (new module)

pub type ProjectId = String; // url-safe slug, e.g. "demo", "acme-bot", "acme-bot-2"

#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ProjectSource {
    Local,
    Git { url: String },
}

#[derive(Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectMeta {
    pub id: ProjectId,
    pub name: String,        // display name (defaults to dir name / tau.toml [project].name)
    pub path: String,        // absolute path on disk
    pub source: ProjectSource,
}

pub struct ProjectEntry {
    pub meta: ProjectMeta,
    pub state: AppState,
}

pub struct ProjectRegistry {
    inner: RwLock<IndexMap<ProjectId, ProjectEntry>>,
    bin: PathBuf,            // shared --tau-bin
    no_sandbox: bool,        // shared flag
    data_root: PathBuf,      // ~/.tau-web-ui
}
```

`IndexMap` preserves insertion order so the home and switcher list projects stably. `bin`/`no_sandbox`/`data_root` are process-wide and threaded into each `AppState` the registry builds.

### 3.2 Slugging

`slug(name)` lowercases, replaces non-`[a-z0-9-]` runs with `-`, trims leading/trailing `-`. On collision in the registry, append `-2`, `-3`, … The slug is computed once at registration and stored in `ProjectMeta.id`; it never changes afterward (so URLs stay stable even if another project with the same dir name is added later).

### 3.3 Per-project store

`RunStore::new` currently takes `~/.tau-web-ui/runs`. The registry builds each project's store at `~/.tau-web-ui/projects/<id>/runs/`, fully isolating run history per project. Serve children still spawn lazily on first run (unchanged `AppState` behavior), so registering N projects starts zero children.

### 3.4 Registry persistence

`~/.tau-web-ui/projects.json` holds `Vec<ProjectMeta>`. Loaded at startup; each entry rebuilt into a `ProjectEntry` (constructing its `AppState` + store). Saved (whole-file rewrite) on every add/remove. Missing/empty file → empty registry.

`--project <path>` at startup auto-registers (or updates, matched by absolute path) that project, so the existing single-project launch still lands the user on a usable project. If the registry is otherwise empty and `--project` is given, that project is the obvious first card.

### 3.5 Scoping: path-prefix

All of today's routes move under a `:pid` prefix. A `Path(pid)` extractor resolves the entry from the registry (returns `404 {"error":"unknown project"}` if absent) and yields its `AppState` to the handler. Handlers keep their current bodies — they receive an `AppState` exactly as before; only how it is obtained changes.

```
/api/projects/:pid/health
/api/projects/:pid/project                      (meta::project)
/api/projects/:pid/project/config   GET/PUT
/api/projects/:pid/runs             POST/GET
/api/projects/:pid/runs/:id         GET
/api/projects/:pid/runs/:id/cancel  POST
/api/projects/:pid/runs/:id/events  GET (WS)
/api/projects/:pid/workflows        GET
/api/projects/:pid/workflows/run    POST
/api/projects/:pid/packages …       (list/install/resolve/verify/:name delete/update)
/api/projects/:pid/agents/import    POST
```

Rationale for path-prefix over a `X-Tau-Project` header: the project ends up in the URL, so deep links and the cross-project Activity feed point straight at `/projects/acme-bot/runs/<id>`, and two browser tabs can view two projects without shared-state conflicts.

## 4. Gateway: global endpoints

Unscoped routes for the home and project management:

### 4.1 `GET /api/projects`

Returns `Vec<ProjectListItem>`:

```rust
#[derive(Serialize, TS)]
#[ts(export)]
pub struct ProjectSummary {
    pub runs: u32,
    pub running: u32,
    pub failed_24h: u32,
    pub success_rate: f32,   // 0..1
    pub tokens: u64,
    pub last_activity: Option<String>, // RFC3339
    pub agents: u32,
    pub engine_ok: bool,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct ProjectListItem {
    pub meta: ProjectMeta,
    pub summary: ProjectSummary,
}
```

`summary` is computed from each project's persisted runs + config **without starting a serve child**. `engine_ok` reflects whether the project's serve child (if any) is healthy; with no child yet it is `true` (nothing has failed). `failed_24h` counts runs with `status == error` ended within 24h — the gateway is given a `now` for testability (handler uses wall clock; tests inject a fixed time).

### 4.2 `GET /api/projects/runs?status=failed&limit=N`

Cross-project Activity feed. Returns recent runs across all projects, newest first, each annotated with its project:

```rust
#[derive(Serialize, TS)]
#[ts(export)]
pub struct CrossProjectRun {
    pub project_id: ProjectId,
    pub project_name: String,
    pub run: RunSummary,     // existing per-run summary shape used by /runs list
}
```

`status=failed` filters to failed runs (powers the **Failures** toggle); omitting `status` returns all (the **All runs** toggle). `limit` defaults to 50.

### 4.3 `POST /api/projects`

Register a project. Body is exactly one of:

```json
{ "path": "/abs/path/to/project" }
{ "git_url": "https://github.com/acme/bot.git" }
```

- **Local**: resolve to absolute path, verify a `tau.toml` exists, derive name (`[project].name` or dir basename), slug, build `AppState` + store, persist. Returns `201 { meta }`.
- **Git**: `git clone <url>` into `~/.tau-web-ui/workspaces/<slug>/`, then validate `tau.toml` as above. On clone failure or missing `tau.toml`, return `400 { "error": "<readable message>" }` and leave no partial registry entry.

The clone step is behind a `ProjectCloner` trait (`GitCloner` shells `git clone`; `MockCloner` short-circuits to a seeded path for tests/e2e). Add-by-path is honored against real dirs even in mock mode; the project still runs under `fake-tau-serve`, consistent with the mock-gated convention.

### 4.4 `DELETE /api/projects/:pid`

Unregister: remove from the in-memory registry and `projects.json`. **Non-destructive** — run history under `~/.tau-web-ui/projects/<id>/` and any cloned workspace under `~/.tau-web-ui/workspaces/<id>/` are left on disk. Returns `204`. Unknown pid → `404`.

## 5. Frontend

### 5.1 Routing

`/` becomes the **Projects home**. The per-project app moves under `/projects/:pid/…`:

```
/                                ProjectsHome (global)
/projects/:pid/dashboard
/projects/:pid/runs
/projects/:pid/runs/:rid
/projects/:pid/agents
/projects/:pid/workflows
/projects/:pid/config
/projects/:pid/packages
/projects/:pid/ship      (gated stub)
/projects/:pid/health    (gated stub)
```

`AppLayout` reads `:pid`; an unknown `:pid` renders a "project not found → back to home" state. Legacy paths (`/runs`, `/config`, …) redirect to the same sub-route under the active project (preserves muscle memory and any existing bookmarks).

### 5.2 Active project + API client

The Zustand store gains `activeProjectId` (synced from the route param) and `projects: ProjectListItem[]`. `web/src/api/client.ts` is the single chokepoint: every scoped fetch is built from `activeProjectId` → `/api/projects/:pid/…`, and the WS URL likewise. Per-surface components are otherwise unchanged — they call the same store actions; the client just prefixes the project. Global calls (`/api/projects`, `/api/projects/runs`, add/remove) live in a new `web/src/api/projects.ts`.

### 5.3 ProjectsHome

Implements the approved `projects-home-v2` mockup:
- **Global summary strip**: Projects / Runs (all) / Running / Failed (24h) / Tokens — folded from `GET /api/projects`.
- **Project cards** grid: status dot, name, `runs · failed · success%`, `agents · running`, last-activity, sparkline. Per-card numbers reuse `dashboard/metrics.ts` reductions where the frontend has the run data; the summary endpoint provides the rest. Card click → `/projects/:pid/dashboard`.
- **+ Add project** card → form with a local-path field and a git-url field (one submit each), POSTing to `/api/projects`; on success the new card appears and the switcher updates. Validation errors from the gateway are shown inline.
- **Activity panel** (right): cross-project feed with a **Failures / All runs** toggle backed by `GET /api/projects/runs`. Each row = project chip + agent/workflow name + status badge + age; click → `/projects/:pid/runs/:rid`.

### 5.4 Navbar switcher

The brand becomes a dropdown listing projects (active checked) + "Manage projects" → `/`. Reads `activeProjectId`; shows "All projects" on the home. Switching navigates to `/projects/:newPid/<current-sub-route>` so the user stays on the surface they were viewing.

## 6. Testing

**Gateway:**
- Slug derivation + collision dedupe (`acme-bot`, `acme-bot-2`).
- Registry CRUD: add-by-path (valid / missing `tau.toml`), add-by-git via `MockCloner`, delete, persistence round-trip through `projects.json`.
- Per-project store isolation: runs written under project A don't appear under project B.
- `GET /api/projects` summary reductions with an injected `now` for `failed_24h`.
- `GET /api/projects/runs` ordering, `status=failed` filter, `limit`.
- Scoped extractor returns 404 for unknown pid; resolves the right `AppState` for a known pid.

**Web (vitest):**
- ProjectsHome renders cards + summary + Activity from mocked `/api/projects` and `/api/projects/runs`.
- Activity Failures/All toggle re-fetches with/without `status=failed`.
- Switcher lists projects and navigates preserving the sub-route.
- `client.ts` prefixes scoped calls with the active pid; `projects.ts` hits global routes.

**E2e (Playwright):**
- Existing run / cancel / workflow / config+packages specs re-pointed under a seeded project (`/projects/demo/…`).
- New home spec: cards visible, Activity toggle works, click-through to a run trace.
- New add-project spec: add-by-path of a seeded fixture dir → new card appears.

## 7. ts-rs / CI

New exported types (`ProjectSource`, `ProjectMeta`, `ProjectSummary`, `ProjectListItem`, `CrossProjectRun`) land in `web/src/types` via the existing `#[ts(export)]` + `TS_RS_EXPORT_DIR` setup; the CI drift gate (`git diff web/src/types`) covers them. No CI job changes; the e2e job seeds a project for the re-pointed specs.

## 8. Out of scope (YAGNI)

- Renaming projects, reordering cards, project archiving.
- Destructive on-disk deletion from the UI.
- Concurrent multi-project serve health polling on the home (summaries are derived from persisted runs, not live children).
- Per-project auth / access control.
