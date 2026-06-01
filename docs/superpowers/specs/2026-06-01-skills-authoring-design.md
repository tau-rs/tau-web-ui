# Skills authoring — design

**Status:** approved (brainstorm 2026-06-01)
**Sub-project of:** [Product Information Architecture](2026-05-31-product-information-architecture.md) — surface ⑥ "Tools & Skills".
**Part of a 3-slice surface:** "Tools & Skills" is built as three sequenced sub-projects — **(1) Skills authoring (this spec)**, (2) Tools view, (3) gated Plugins (describe + protocol-decode viewer). Each gets its own spec → plan → ship.
**Decomposition:** two implementation plans — (1) gateway skills, (2) frontend skills. Plan 2 builds on plan 1's API.

## 1. Goal

Make the **Tools & Skills** surface real for **skills**: list, show, create, edit, delete, import, and export `SKILL.md` skills. A skill is a tau skill package — a directory with `SKILL.md` (Anthropic-format prompt) + `tau.toml` (`kind="skill"`, capabilities, requires). This is a **now** surface (real `tau.toml`/`SKILL.md` read+write via `toml_edit` + frontmatter parsing), built mock-first behind the same seam as packages/workflows; only the engine side is mocked via `fake-tau-serve`.

Locked decisions (brainstorm):
- Scope of the whole "Tools & Skills" surface: **everything** (Skills full CRUD, Tools view, gated Plugins) — delivered as **3 sequenced sub-projects**; this spec is **#1, Skills authoring**.
- Skills support **in-UI create/edit** (not just read/import/export).
- Layout **mirrors Agents**: an index + a deep-linkable editor page (`/tools/skills/:name`).
- The surface shows a **tab bar** (Skills active; Tools/Plugins as gated "soon" placeholders).
- **local** skills (under `<project>/skills/<name>/`) are editable/deletable; **installed** skills (via Import = `tau install`) are view + export only.
- **Export** = a client-side download of the skill's files (no new gateway endpoint, no zip dependency).

## 2. Skill model (ground truth from tau)

A local skill directory `<project>/skills/<name>/`:

`SKILL.md`:
```
---
name: critic
description: Reviews drafts for clarity, completeness, and rhetoric.
---
You are a writing critic. …            ← body (Markdown)
```

`tau.toml`:
```toml
name = "critic"
version = "0.1.0"
description = "Reviews drafts for clarity, completeness, and rhetoric."
authors = []
source = "local://critic"
kind = "skill"
dependencies = []

[[capabilities]]
kind = "fs.read"
paths = ["${SKILL_DIR}/references/**"]

[[capabilities]]
kind = "net.http"
hosts = ["api.example.com"]
methods = ["GET"]

[[capabilities]]
kind = "process.spawn"
commands = ["git", "rg"]

[skill]
[[skill.requires_tools]]
name = "fs-read"
source = "https://github.com/tau/fs-read.git"
version = "^0.1"
[[skill.requires_skills]]
name = "fact-checker"
source = "local://fact-checker"
```

- The `name` in SKILL.md frontmatter and `tau.toml` MUST match.
- Capabilities are typed: each `[[capabilities]]` has a `kind` plus kind-specific **list** params — `paths` (`fs.read`/`fs.write`), `hosts` + `methods` (`net.http`), `commands` (`process.spawn`). Other kinds may exist; we model them generically.
- `[skill].requires_tools` / `[skill].requires_skills` are arrays of `{ name, source, version? }`.

## 3. Data model (ts-rs types)

```rust
// gateway/src/skills/mod.rs

#[derive(Serialize, Deserialize, TS)]   // generic typed capability
pub struct Capability {
    pub kind: String,                    // "fs.read" | "fs.write" | "net.http" | "process.spawn" | ...
    pub fields: std::collections::BTreeMap<String, Vec<String>>,
    // keyed by param name: {"paths": [...]} / {"hosts": [...], "methods": [...]} / {"commands": [...]}
}

#[derive(Serialize, Deserialize, TS)]
pub struct PackageDep { pub name: String, pub source: String, pub version: Option<String> }

#[derive(Serialize, Deserialize, TS)]
pub struct SkillSummary {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub editable: bool,                  // true = local (under skills/), false = installed
    pub capability_kinds: Vec<String>,
    pub requires_count: u32,             // tools + skills
}

#[derive(Serialize, Deserialize, TS)]
pub struct SkillDetail {
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub source: String,
    pub editable: bool,
    pub content: String,                 // SKILL.md body (after frontmatter)
    pub capabilities: Vec<Capability>,
    pub requires_tools: Vec<PackageDep>,
    pub requires_skills: Vec<PackageDep>,
}
```

`fields` as `BTreeMap<String, Vec<String>>` keeps capabilities faithful to any kind (the frontend knows which param names each kind uses) and round-trips cleanly through `toml_edit` (each entry → `key = [list]`).

## 4. Gateway

### 4.1 `skills` module (`gateway/src/skills/mod.rs`)

**Local skills are real file I/O** (like config/agents — no engine needed, so they work and persist even in mock mode); **installed skills + import** go through a mock seam (they need git/`tau install`).

- **Local skills (real, always):** free functions over `<project>/skills/<name>/` — `read_local(name)` (parse `SKILL.md` frontmatter+body + `tau.toml`), `list_local()` (scan `skills/*`), `write_local(detail, create)` (write `SKILL.md` + `tau.toml` via frontmatter + `toml_edit`), `delete_local(name)` (remove the dir). These mutate the real project tree, exactly as agent/config writes do.
- **Installed skills (seam):** an `InstalledSkills` trait with `MockInstalled` (seeds `web-search` as a read-only installed skill; `import` appends one) and a `CliInstalled` seam (future real path: tau `kind="skill"` packages + `tau install`). Selected by the `fake-tau-serve` bin name, mirroring `AppState::new`'s existing `is_mock` check.
- The module's public ops compose the two: `list` = local + installed; `read`/`write`/`delete` operate on local files (and refuse installed names); `import` delegates to the seam.

For the **demo fixture**, two local skills (`critic`, `fact-checker`) are seeded as real files under `fixtures/demo/skills/` so the surface isn't empty.

### 4.2 Read/write rules

- `list`: local + installed skills; `SkillSummary.editable` flags local.
- `read(name)`: parse SKILL.md (frontmatter `name`/`description`, body) + `tau.toml` (version, capabilities → `{kind, fields}`, requires). `None` if absent.
- `write(detail, create)`: **only local** skills. Validate `name` is `^[a-z0-9-]+$`. On `create`, error if the name already exists. Writes `SKILL.md` (frontmatter from name/description + body) and `tau.toml` (`kind="skill"`, version, `[[capabilities]]` from each `{kind, fields}`, `[skill]` requires_tools/skills) — `toml_edit`, preserving any other keys for an update.
- Writing/deleting an **installed** skill → error (the API maps to 409/400).
- `delete(name)`: removes a local skill; `false`/error for installed or absent.
- `import(git_url)`: installs a skill package; returns the skill name.

### 4.3 `AppState` wrappers

`AppState` gains `list_skills()`, `read_skill(name)`, `write_skill(detail, create)`, `delete_skill(name)`, `import_skill(git_url)` delegating to the chosen `SkillOps`, matching how packages/config are wired.

### 4.4 API (scoped routes under `/api/projects/:pid`)

| Method | Route | Body / result | Errors |
|---|---|---|---|
| GET | `/skills` | → `SkillSummary[]` | — |
| GET | `/skills/:name` | → `SkillDetail` | 404 unknown |
| PUT | `/skills/:name` | `SkillDetail` (URL name authoritative) → upsert local skill; `?create=1` must-not-exist | 400 invalid name; 409 create-exists; 400/409 if target is installed (read-only) |
| DELETE | `/skills/:name` | remove local skill | 404 unknown; 400 if installed |
| POST | `/skills/import` | `{ git_url }` → `{ skill: name }` | 400 |

New `#[ts(export)]` types (`Capability`, `PackageDep`, `SkillSummary`, `SkillDetail`) export to `web/src/types` via the existing ts-rs drift gate.

## 5. Frontend

### 5.1 API module `web/src/api/skills.ts`

Scoped via the `scopedPath` chokepoint: `listSkills()`, `getSkill(name)`, `putSkill(detail, {create?})`, `deleteSkill(name)`, `importSkill(git_url)`.

### 5.2 Components (new `web/src/tools/`)

- **`ToolsPage.tsx`** — the `/tools` surface: a tab bar (**Skills** active; **Tools** / **Plugins** as disabled "soon" chips) wrapping `SkillsIndex`.
- **`SkillsIndex.tsx`** — table of local + installed skills (badged), columns name/version/source/capabilities/requires; **+ New skill** → `/tools/skills/new`; an **Import skill** git-url form (like the agent import); rows → `/tools/skills/:name`.
- **`SkillEditorPage.tsx`** — reads `:name` (`"new"` route → create mode); loads via `getSkill` (skip in create). Renders the form. For **installed** (`editable === false`) skills the form is read-only (no Save/Delete; only **Export**). **Save** → `putSkill(detail, {create})` → navigate to `/tools/skills/:name`; **Delete** (local only) → back to `/tools`; **Export** → client-side download of `SKILL.md` (built from frontmatter + body) and `tau.toml`-equivalent from the loaded detail. Gateway 400/409 errors inline.
- **`CapabilitiesEditor.tsx`** — repeatable rows: a **kind** `<select>` (fs.read/fs.write/net.http/process.spawn) + the kind's typed list field(s) as add/remove chips, driven by a small client-side `CAP_FIELDS` map (`fs.read`→`["paths"]`, `net.http`→`["hosts","methods"]`, `process.spawn`→`["commands"]`, `fs.write`→`["paths"]`).
- **`PackageDepEditor.tsx`** — repeatable `{ name, source, version? }` rows; reused for **requires.tools** and **requires.skills**.
- The SKILL.md body is a plain textarea (no live markdown preview in v1 — YAGNI).

The sidebar **Tools & Skills** item already routes to `/projects/:pid/tools`; this replaces its gated `StubPage` with `ToolsPage` (the route gains `tools/skills/new` and `tools/skills/:name`).

### 5.3 Validation (client mirrors gateway)

- skill name: `^[a-z0-9-]+$`, non-empty (create only; immutable in edit).
- capability kind: from the known set; each row's list fields are free-text chips.
- `PackageDep` row: `name` + `source` required; `version` optional.
- Installed skills: UI hides Save/Delete (read-only); server also refuses.

## 6. Testing

**Gateway** (`skills/mod.rs` unit tests + an integration test via the registry/AppState):
- `write` then `read` round-trips name/description/version/body, capabilities (`fs.read` paths, `net.http` hosts+methods, `process.spawn` commands), and requires_tools/skills.
- `delete` removes a local skill; returns false/err for installed/absent.
- Writing or deleting an **installed** skill errors.
- `list` includes both local and installed, with `editable` set correctly.
- `import` appends an installed skill.
- API: 404 (unknown), 400 (invalid name), 409 (create existing), 400/409 (mutating installed).

**Web (vitest):**
- `SkillsIndex` renders local + installed rows badged; New/Import present; row link targets.
- `SkillEditorPage`: loads a skill and Save sends the exact `SkillDetail`; create flow PUTs with `create`; delete; installed → read-only (no Save/Delete, Export present).
- `CapabilitiesEditor`: switching kind swaps the field set; add/remove list values.
- `PackageDepEditor`: add/remove rows.
- Export triggers a client-side download.

**E2e (Playwright):**
- From `/projects/demo/tools`: **New skill** → fill name/description/body + one capability (fs.read path) + one required tool → Save → appears in the index → open → edit body → Save → Delete → gone.
- Import a git skill URL → appears as an **installed** row (view-only).
- Restores `fixtures/demo` afterward (the e2e writes under `fixtures/demo/skills/` for local skills; restore via `git checkout` / clean untracked).

## 7. ts-rs / CI

`Capability`, `PackageDep`, `SkillSummary`, `SkillDetail` land in `web/src/types` via the existing `#[ts(export)]` + drift gate. `BTreeMap<String, Vec<String>>` generates `{ [key: string]: Array<string> }`. No CI job changes.

## 8. Out of scope (YAGNI / later sub-projects)

- The **Tools** tab (tool packages + capability detail) — sub-project #2.
- **Plugins** describe + protocol-decode viewer — sub-project #3 (gated).
- Live Markdown **preview** of the SKILL.md body.
- Editing **installed** skills, or "ejecting" an installed skill into a local one.
- Bundling/`tau bundle` export (export is a client-side file download in v1).
- Capability **validation** against tau's full schema (free-text lists in v1; `tau check` covers real validation — Health/Checks sub-project).
- Editing reference files bundled in a skill dir (only `SKILL.md` + `tau.toml` are authored here).
