# Agents authoring — design

**Status:** approved (brainstorm 2026-06-01)
**Sub-project of:** [Product Information Architecture](2026-05-31-product-information-architecture.md) (decomposition item #4, "Agents authoring")
**Decomposition:** two implementation plans — (1) gateway agent read/upsert/delete + API + types, (2) frontend index/editor + e2e. Plan 2 builds on plan 1's API.

## 1. Goal

Make the **Agents** surface a real editor over `[agents.<id>]` tables in the project's `tau.toml`: list, create, edit, and delete agents through a form. This is a **now** (real, not gated) surface — config read/write already operates on the real `tau.toml` via `toml_edit`, even in mock mode. It supersedes the current gated `StubPage` at `/agents` and complements the read-only agents table + community-import already on the Config surface.

Locked decisions (from brainstorm):
- **Full CRUD, all fields** — create / edit / delete; fields `display_name`, `package`, `llm_backend`, system prompt, and `requires.tools`.
- **Layout B** — an index list + a deep-linkable per-agent editor page (`/agents/:id`), consistent with the app's run/trace routing.

## 2. Agent schema (ground truth from tau)

A full agent table in `tau.toml`:

```toml
[agents.researcher]
display_name = "Researcher"
package      = "fs-read@^0.1"
llm_backend  = "anthropic"

[agents.researcher.prompt]
system = "you are a researcher"        # XOR system_file = "agents/researcher.md"

[[agents.researcher.requires.tools]]
name    = "fs-read"
source  = "https://example.com/fs-read.git"
version = "^0.1"                        # optional, defaults to "*"
```

- `prompt` is a sub-table with `system` **xor** `system_file` (mutually exclusive).
- `requires.tools` is an **array-of-tables**; each entry is `{ name, source, version? }`.
- `display_name`, `package`, `llm_backend` are optional (the demo fixture's agents carry only `display_name`).

## 3. Data model (ts-rs types)

New `#[ts(export)]` types in the gateway, consumed by the frontend:

```rust
#[derive(Serialize, Deserialize, TS)]
pub struct AgentPrompt {
    pub system: Option<String>,
    pub system_file: Option<String>,   // path as string
}

#[derive(Serialize, Deserialize, TS)]
pub struct RequiredToolSpec {
    pub name: String,
    pub source: String,
    pub version: Option<String>,
}

#[derive(Serialize, Deserialize, TS)]
pub struct AgentDetail {
    pub id: String,
    pub display_name: Option<String>,
    pub package: Option<String>,
    pub llm_backend: Option<String>,
    pub prompt: AgentPrompt,
    pub requires_tools: Vec<RequiredToolSpec>,
}
```

`AgentDetail` supersedes the *read* side of the existing `AgentInfo` for this surface. The Config page's read-only agents table keeps using `ProjectConfig.agents` (`AgentInfo`) unchanged.

## 4. Gateway — config module + API

### 4.1 `gateway/src/config/mod.rs` (extend)

All operations use `toml_edit` and preserve everything else in the file.

- **`read_agent(project: &Path, id: &str) -> Result<Option<AgentDetail>>`** — parse the `[agents.<id>]` table, its `prompt` sub-table (`system`/`system_file`), and the `[[agents.<id>.requires.tools]]` array. `None` if the agent table is absent.
- **`list_agents(project: &Path) -> Result<Vec<AgentDetail>>`** — all agents, sorted by id (full detail; the index renders a subset).
- **`write_agent(project: &Path, agent: &AgentDetail) -> Result<()>`** — upsert:
  - set `display_name`/`package`/`llm_backend` when `Some` and non-empty; remove the key when `None`/empty.
  - write the `[agents.<id>.prompt]` sub-table with exactly one of `system`/`system_file`, removing the other key; if both are `None`, omit/clear the `prompt` sub-table.
  - replace the `requires.tools` array-of-tables with the provided list (each `{ name, source, version? }`; omit `version` when `None`); if the list is empty, remove the `requires` sub-table.
  - idempotent; unrelated tables/keys/comments preserved (toml_edit).
- **`delete_agent(project: &Path, id: &str) -> Result<bool>`** — remove the `[agents.<id>]` table (and its sub-tables); returns `false` if it was absent.

`config::write_agent` is a raw upsert with **no** existence check — the create-time duplicate guard (409) lives one layer up (the `AppState`/handler does a `read_agent` first when create-intent is signalled, then delegates). The existing narrow `add_agent` is **replaced** by `write_agent`. `AppState::import_agent` is re-pointed to construct an `AgentDetail` (id, package `=<pkg>@^<ver>`, llm_backend) and call `write_agent`, so there is a single agent writer. Existing import behavior/tests are preserved (same resulting `tau.toml`).

### 4.2 API (scoped routes, extend `gateway/src/api/agents.rs` + router)

| Method | Route | Body / result | Errors |
|---|---|---|---|
| GET | `/api/projects/:pid/agents` | → `AgentDetail[]` | — |
| GET | `/api/projects/:pid/agents/:id` | → `AgentDetail` | 404 if absent |
| PUT | `/api/projects/:pid/agents/:id` | `AgentDetail` → upsert | 400 invalid id / `prompt` with both fields set; 409 if creating an id that already exists |
| DELETE | `/api/projects/:pid/agents/:id` | — | 204 / 404 |
| POST | `/api/projects/:pid/agents/import` | unchanged (kept) | — |

- "Invalid id" = does not match `^[A-Za-z0-9_-]+$` or is empty.
- PUT is create-or-update; to distinguish 409, the handler checks existence when the body's `id` differs from… simpler: PUT to `/agents/:id` upserts that id; a separate **create** uses PUT and the handler returns 409 only when the caller signals create-intent. To keep it simple: the frontend create flow PUTs to the new id and the gateway returns **409 if the id already exists on a create** — implemented by a `?create=1` query flag (PUT without the flag = update/idempotent upsert; PUT with `create=1` = must-not-exist). This keeps one route while giving create-time duplicate protection.
- The `AppState` gains thin wrappers `list_agents()`, `read_agent(id)`, `write_agent(detail, create)`, `delete_agent(id)` delegating to `config::*`.

### 4.3 ts-rs / CI

`AgentDetail`, `AgentPrompt`, `RequiredToolSpec` export to `web/src/types/` via the existing `#[ts(export)]` + drift gate (`git diff web/src/types`). No CI job changes.

## 5. Frontend

### 5.1 API module `web/src/api/agents.ts`

Scoped via the existing `scopedPath` chokepoint:
- `listAgents(): Promise<AgentDetail[]>` → GET `/agents`
- `getAgent(id): Promise<AgentDetail>` → GET `/agents/:id`
- `putAgent(detail, opts?: {create?: boolean}): Promise<void>` → PUT `/agents/:id(?create=1)`
- `deleteAgent(id): Promise<void>` → DELETE `/agents/:id`

### 5.2 Components (new `web/src/agents/`)

- **`AgentsIndexPage.tsx`** — fetches `listAgents()`; renders a table (id · display_name · llm_backend · package · # tools) + **New agent** link to `/projects/:pid/agents/new`; row click → `/agents/:id`. Replaces the `StubPage` for `/agents` in `App.tsx`.
- **`AgentEditorPage.tsx`** — reads `:agentId` param; `"new"` → create mode (blank form, editable id), else load via `getAgent`. **Save** → `putAgent(detail, {create})` then navigate to `/agents/:id`; **Delete** (edit mode only) → `deleteAgent` then back to `/agents`. Gateway 400/409 errors shown inline.
- **`PromptField.tsx`** — Inline/File mode toggle: textarea bound to `prompt.system`, or a path input bound to `prompt.system_file`. File *contents* are not edited here (v1) — only the path.
- **`RequiresToolsEditor.tsx`** — repeatable rows of `{ name, source, version }` with **+ Add tool** / remove.

Pages hold local component state (like `ConfigPage`/`PackagesPage`); no Zustand store changes. The sidebar **Agents** item already routes to `/projects/:pid/agents` — no sidebar change beyond it now resolving to the real page.

### 5.3 Validation (client mirrors gateway)

- id: `^[A-Za-z0-9_-]+$`, non-empty (create mode only; immutable in edit mode).
- prompt: at most one of inline/file (enforced by the toggle).
- requires.tools row: `name` and `source` required; `version` optional.
- The server remains the source of truth (409 on duplicate id, 400 on invalid shape).

## 6. Testing

**Gateway** (`config/mod.rs` unit tests + an integration test using the registry/AppState):
- `write_agent` round-trips every field; `read_agent` parses the `requires.tools` array-of-tables and both prompt variants.
- Toggling `system` ↔ `system_file` clears the other key.
- Empty `requires.tools` removes the `requires` sub-table; empty optional scalars remove their keys.
- `write_agent` **preserves** unrelated tables/keys (e.g. `[project]`, other agents) and comments.
- `delete_agent` removes the table and returns false when absent.
- `import_agent` still produces the same `tau.toml` as before (regression).
- API: 404 (unknown id), 400 (invalid id / both prompt fields), 409 (create existing), 204 (delete).

**Web** (vitest):
- index renders rows from a mocked `listAgents`.
- editor loads an agent and Save sends the exact `AgentDetail`.
- create flow PUTs with `create` to the typed id.
- delete calls `deleteAgent` and navigates back.
- `RequiresToolsEditor` add/remove; `PromptField` toggle clears the other field; id validation blocks invalid ids.

**E2e** (Playwright, under `/projects/demo/agents`):
- New agent → fill id/display_name/llm_backend + inline prompt + one required tool → Save → appears in the index → open → edit prompt → Save → Delete → gone.
- Restores `fixtures/demo/tau.toml` afterward (same discipline as the config/packages e2e).

## 7. Out of scope (YAGNI)

- Editing system-prompt **file contents** (only the path is editable; a file editor is future work).
- A tool **picker** sourced from installed packages / a Tools surface (requires.tools entries are typed by hand in v1; autocomplete lands with the Tools & Skills sub-project).
- Reordering agents, renaming an agent id in place (delete + recreate instead), capabilities/sandbox tables, workflow wiring.
- Live validation against `tau check` (covered by the Health/Checks sub-project).
