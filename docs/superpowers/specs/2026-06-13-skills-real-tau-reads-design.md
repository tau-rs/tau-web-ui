# D2b — Wire real tau reads for the Skills inventory

**Date:** 2026-06-13
**Status:** design approved, pending spec review → implementation plan
**Precedent:** D2a (`CliOps`, `gateway/src/packages/mod.rs`) — this mirrors it.

## Summary

The Tools / Plugins / Skills inventory tabs render hardcoded mock data through three
sidecar seams (`ToolsSource`, `PluginsSource`, `InstalledSkills`), each with a `Mock*`
impl and a `Cli*` stub marked *"not wired in v1"*. D2b wires **only the Skills seam**
(`CliInstalled`) to real `tau`, mirroring how D2a wired `CliOps` to the package verbs.
Tools and Plugins stay on mocks.

### Why Skills only (scope decision)

The three tabs are not symmetric against the real `tau` CLI (verified against
`/Users/titouanlebocq/code/tau`):

| Tab | Real tau support | Verdict |
|---|---|---|
| **Skills** | `tau skill list --json` (flat rows) + `tau skill show <n> --json --body` (capabilities, requires_*, SKILL.md body) | First-class, rich → **wire it** |
| **Tools** | No `list tools`. "tool" is only a manifest *kind*-string / plugin port. No verb returns a tool list. | tau-web-ui invention → **stays mock** |
| **Plugins** | No `plugin list`. Only `tau plugin describe <pkg>` (live subprocess handshake, debug-tier). No enumeration. | **stays mock** |

Building Tools/Plugins on real data would mean inventing them on top of package
manifests read off disk — deferred until tau exposes real listing verbs.

## The seam being wired

`InstalledSkills` (`gateway/src/skills/mod.rs:300-304`). Local/editable skills are
already real (filesystem under `<project>/skills/<name>/`); only the *installed*
(non-editable) half is the stub. Three methods → three tau verbs:

| Method | tau verb | Notes |
|---|---|---|
| `list() -> Vec<SkillSummary>` | `tau skill list --json` | returns `{name, version, description, source, install_path}` — **no capabilities / requires** |
| `read(name) -> Option<SkillDetail>` | `tau skill show <name> --json --body` | returns capabilities, requires_tools, requires_skills, body (frontmatter-stripped) |
| `import(git_url) -> Result<String>` | `tau install <url> --json` | returns `{name, version, scope, path}`; we return `name`. Identical to D2a `CliOps::install`. |

`CliInstalled` gains `{bin: PathBuf, project: PathBuf}` fields and a `::new(bin, project)`
ctor (today it is a unit struct). The single selection line in
`AppState::with_options` (`gateway/src/state.rs:93-107`) changes from
`Box::new(CliInstalled)` to `Box::new(CliInstalled::new(bin.clone(), project.clone()))`.
`CliTools` / `CliPlugins` are untouched (remain empty stubs).

All three verbs run via a shared `run(&[&str]) -> (bool, String, String)` helper using
`Command::new(&bin).args(args).current_dir(&project).output()` — copied from
`CliOps::run` (`packages/mod.rs:208-222`).

## Decisions

### list() is cheap — one call, no enrichment

`tau skill list --json` does not return capabilities or requires. `SkillSummary` has
`capability_kinds: Vec<String>` and `requires_count: u32`, which the list cannot fill
for installed skills.

**Decision:** installed `SkillSummary` rows get `capability_kinds: []`, `requires_count: 0`.
Do **not** do N+1 `skill show` calls to enrich; do **not** drop the fields from the type
(local skills fill them for free from disk). Richness lives in the detail pane.

Consequence (intended): in the index, installed rows show `—` / `0` in those columns
while local rows show real values.

### Single-scope, project cwd — no project+global merge

`tau skill list`, `skill show`, and `install` all resolve scope identically via
`Scope::resolve(cwd)` (project scope if a `.tau/` ancestor exists, else global). Unlike
`tau list packages`, **`skill list` has no `--all` / `--global` flag** — it reads exactly
one scope.

**Decision:** run all verbs with `current_dir(project)`. The tab shows exactly the
project's scope. Because install and list share the resolver, the import → list → show
round-trip is consistent for free. Trade-off accepted: a skill installed *only* in global
scope will not appear in a project's tab. (No D2a-style `--all` merge is possible for
skills.)

### read() — `--body`, not `--raw`

`tau skill show <name> --json --body`. In JSON mode `--raw` is ignored (the body is always
the `parse_skill_md` body, frontmatter stripped), so we never pass `--raw`. Maps 1:1 onto
`SkillDetail` with `editable: false`.

We do **not** consume the emitted `install_path` (tau has a known project-scope path bug
there, and neither `SkillSummary` nor `SkillDetail` carries the field).

### import() — reuse the package guard

`tau install <url> --json`; return the `name`. Reuse `is_safe_pkg_url`
(`packages/mod.rs:132-146`, rejects empty / leading-`-` / unknown scheme) rather than
duplicating it. Make it `pub(crate)` if not already.

### Local vs installed dedup

If a skill name exists both as a local editable dir and a tau-installed package, the
**local** one wins (dedup by name in the `list()` composition, `skills/mod.rs:385-389`,
local appended first).

### Error handling

Mirror `CliOps`: read paths (`list`, `read`) are infallible at the port — on spawn
failure or malformed JSON they return `[]` / `None` (silent-empty, tolerant
`serde_json::Value` parsing). `import` returns `Err(anyhow!("tau install failed: {}",
stderr.trim()))` on non-zero exit. `anyhow` throughout (matches the existing seam and
D2a; no thiserror at this boundary).

## UI — B′ (read-only capabilities + linked requirements)

The installed-skill detail (`SkillEditorPage.tsx`) currently renders capabilities and
requires **only when editable** (`{!readOnly && (…)}`, line 179), so installed skills
would fetch rich data with nowhere to show it. B′ closes that gap with a read-only view,
reflecting tau's actual capability model:

- **capabilities** — the skill's *own* declared grants (from its `tau.toml`; often empty).
  Shown as read-only informational chips. **No outbound link** — this view *is* the
  definition site.
- **requires_tools / requires_skills** — delegation: the capability lives in the required
  *tool*. Shown as read-only rows displaying **`name  version_req`** only. **No link** —
  `tau skill show --json` emits requirements as `{name, version_req}` and **drops the
  `source`** (verified: `PackageDepJson`, tau `crates/tau-cli/src/cmd/skill/show.rs:92-95`),
  so there is nothing to link to. (Local/editable skills still carry `source` because they
  are read from `tau.toml` on disk — but those use the editable editor.)
- **effective capabilities** (the union of a skill's reach across its tools) and **in-app
  links to a tool's definition site** — **deferred** to the Tools work. tau computes the
  effective union only for agents (`list agents --capabilities`).

Because `tau skill show` drops `source`, the `PackageDep` rows for an installed skill will
have `source == ""`. The read-only render shows `name` + `version` and must **not** render
a link when `source` is empty.

Frontend change is confined to `SkillEditorPage.tsx`: add a read-only render branch for
capabilities (static chips) and requires (rows with source links) when `readOnly`. The
editable path (local skills) is unchanged. No new data plumbing — `getSkill` already
returns capabilities and requires.

## Testing

- **Mock tier stays the contract.** `gateway/tests/{tools,plugins,skills}_api.rs` continue
  to run against the in-process mocks (`is_mock=true`) and are unchanged — they pin the
  wire shape.
- **Parser unit tests (always-on).** Add checked-in fixtures under
  `gateway/tests/fixtures/tau-json/` for real `tau skill list --json` and
  `tau skill show --json --body`; unit-test the parse into `SkillSummary` / `SkillDetail`,
  including malformed-output → empty/None tolerance. Mirrors the D2a parser tests.
- **Gated real round-trip.** Add `gateway/tests/real_tau_skills.rs`: env-gated on
  `TAU_REAL_BIN` (skip if unset/missing, like `real_tau_packages.rs`), single-threaded,
  HOME-isolated (`set_var("HOME", tmp)`), offline `file://` git skill package (reuse
  `real_tau_packages.rs::build_skill_package`). Asserts import → list (sees it) → show
  (caps/requires/body present). Real `tau` required — `fake-tau-serve` has no skill verbs.

## Out of scope (named, not silently dropped)

- Tools and Plugins tabs (stay mock).
- Effective-capability synthesis (following requires_tools → tool caps).
- In-app tool detail pages / capability provenance links beyond the external source URL.
- Multi-scope (project + global) skill listing.
