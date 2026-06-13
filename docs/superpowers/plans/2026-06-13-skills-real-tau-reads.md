# D2b — Real tau reads for the Skills inventory: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the installed-skills seam (`CliInstalled`) to the real `tau` CLI so the Skills tab shows real `tau skill list`/`skill show` data and imports via `tau install`, mirroring the D2a `CliOps` package seam.

**Architecture:** `CliInstalled` becomes a `{bin, project}` struct that shells `tau` with `current_dir(project)` (single cwd-resolved scope; `skill list` has no `--all`). Reads parse stdout tolerantly into the existing `SkillSummary`/`SkillDetail` types (no type changes); the index list stays cheap (one `skill list` call, installed rows get empty caps / 0 requires). The installed-skill detail gains a read-only capabilities/requires view (B′′ — no source links, since `tau skill show` drops `source`). Mock seams and the mock-tier API tests are untouched.

**Tech Stack:** Rust (anyhow, serde_json, std::process::Command, ts-rs types), React + TypeScript (Vitest, Testing Library), `just`/`pnpm`/`cargo` task verbs.

**Spec:** `docs/superpowers/specs/2026-06-13-skills-real-tau-reads-design.md`

---

## File Structure

- **Modify** `gateway/src/packages/mod.rs` — make `is_safe_pkg_url` + `is_safe_pkg_name` `pub(crate)` so the skills seam can reuse the arg-injection guards.
- **Modify** `gateway/src/skills/mod.rs` — add JSON parsers (`parse_skill_list_json`, `parse_skill_show_json`, `cap_from_json`, `deps_from_json`); replace the unit-struct `CliInstalled` stub with a real `{bin, project}` impl; extend the `#[cfg(test)] mod tests` with parser tests.
- **Modify** `gateway/src/state.rs:96` — construct `CliInstalled::new(bin.clone(), project.clone())` instead of the unit struct.
- **Create** `gateway/tests/fixtures/tau-json/skill-list.json` and `skill-show.json` — canned real-tau output for the parser tests.
- **Create** `gateway/tests/real_tau_skills.rs` — gated, HOME-isolated, offline round-trip against a real `tau`.
- **Modify** `web/src/tools/SkillEditorPage.tsx` — add a read-only capabilities/requires render branch when `readOnly`.
- **Modify** `web/src/tools/SkillEditorPage.test.tsx` — add a B′′ read-only-render test.

No `#[ts(export)]` types change, so no generated `web/src/types/*.ts` regeneration is needed. The API handlers and `AppState::{list_skills,read_skill,import_skill}` already delegate to the seam — no change.

---

## Task 1: Expose the package arg-injection guards

**Files:**
- Modify: `gateway/src/packages/mod.rs:134`, `gateway/src/packages/mod.rs:149`

- [ ] **Step 1: Widen visibility of both guards**

Change the two function signatures (bodies unchanged):

```rust
/// Accept only remote git URLs with a known scheme (or scp-like), plus local
/// `file://` (for offline fixtures). Never a leading `-` (flag smuggling).
pub(crate) fn is_safe_pkg_url(url: &str) -> bool {
```

```rust
/// A package name is a single token: `[A-Za-z0-9._-]+`, no leading `-`.
pub(crate) fn is_safe_pkg_name(name: &str) -> bool {
```

- [ ] **Step 2: Verify it builds (no other change yet)**

Run: `cargo build --workspace --locked`
Expected: builds clean. (A dead-code warning is acceptable here — the consumers land in Task 3; Task 3's build clears it.)

- [ ] **Step 3: Commit**

```bash
git add gateway/src/packages/mod.rs
git commit -m "refactor(gateway): expose pkg url/name guards for reuse"
```

---

## Task 2: JSON parsers for tau skill output (pure, TDD)

**Files:**
- Create: `gateway/tests/fixtures/tau-json/skill-list.json`
- Create: `gateway/tests/fixtures/tau-json/skill-show.json`
- Modify: `gateway/src/skills/mod.rs` (add parsers above the `InstalledSkills` trait, ~line 297; add tests in the existing `#[cfg(test)] mod tests` at line 402)

- [ ] **Step 1: Create the fixtures (real tau shapes)**

`gateway/tests/fixtures/tau-json/skill-list.json` — `tau skill list --json` emits `{ "skills": [...] }`:

```json
{
  "skills": [
    {
      "name": "web-search",
      "version": "1.2.0",
      "description": "Search the web over HTTP.",
      "source": "file:///tmp/web-search.git",
      "install_path": "/home/u/.tau/packages/web-search/1.2.0"
    }
  ]
}
```

`gateway/tests/fixtures/tau-json/skill-show.json` — `tau skill show <n> --json --body`; note `requires_tools` entries are `{name, version_req}` with **no** `source`:

```json
{
  "name": "demo-skill",
  "version": "0.1.0",
  "description": "A tiny demo skill.",
  "source": "file:///tmp/demo-skill.git",
  "install_path": "/home/u/.tau/packages/demo-skill/0.1.0",
  "capabilities": [
    { "kind": "fs.read", "paths": ["${SKILL_DIR}/**"] }
  ],
  "requires_tools": [
    { "name": "fs-read", "version_req": "^0.1" }
  ],
  "requires_skills": [],
  "body": "# Demo Skill\nHello.\n"
}
```

- [ ] **Step 2: Write failing parser tests**

Add to `gateway/src/skills/mod.rs` inside the existing `mod tests` block (after line 404, `use super::*;`):

```rust
const SKILL_LIST_JSON: &str = include_str!("../../tests/fixtures/tau-json/skill-list.json");
const SKILL_SHOW_JSON: &str = include_str!("../../tests/fixtures/tau-json/skill-show.json");

#[test]
fn parse_skill_list_maps_installed_rows() {
    let rows = parse_skill_list_json(SKILL_LIST_JSON);
    assert_eq!(rows.len(), 1);
    let s = &rows[0];
    assert_eq!(s.name, "web-search");
    assert_eq!(s.version.as_deref(), Some("1.2.0"));
    assert!(!s.editable);
    // decision A — cheap list leaves these empty for installed rows
    assert!(s.capability_kinds.is_empty());
    assert_eq!(s.requires_count, 0);
}

#[test]
fn parse_skill_show_maps_detail_caps_and_requires() {
    let d = parse_skill_show_json(SKILL_SHOW_JSON).expect("detail");
    assert_eq!(d.name, "demo-skill");
    assert!(!d.editable);
    assert_eq!(d.content, "# Demo Skill\nHello.\n");
    assert_eq!(d.capabilities.len(), 1);
    assert_eq!(d.capabilities[0].kind, "fs.read");
    assert_eq!(
        d.capabilities[0].fields.get("paths").unwrap(),
        &vec!["${SKILL_DIR}/**".to_string()]
    );
    assert_eq!(d.requires_tools.len(), 1);
    assert_eq!(d.requires_tools[0].name, "fs-read");
    assert_eq!(d.requires_tools[0].source, ""); // tau drops source
    assert_eq!(d.requires_tools[0].version.as_deref(), Some("^0.1"));
}

#[test]
fn skill_parsers_tolerate_garbage() {
    assert!(parse_skill_list_json("not json").is_empty());
    assert!(parse_skill_show_json("not json").is_none());
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cargo test -p tau-gateway skills::tests::parse_skill -- --nocapture`
Expected: FAIL — `cannot find function parse_skill_list_json` / `parse_skill_show_json` in this scope.

- [ ] **Step 4: Implement the parsers**

Insert into `gateway/src/skills/mod.rs` just before the `InstalledSkills` trait doc comment (above line 298). These mirror `packages::parse_list_json` (tolerant `serde_json::Value`) and the existing `cap_from_value`/`deps_from` helpers:

```rust
/// Map a `tau skill show` capability object → `Capability`. Mirrors
/// `cap_from_value` over serde_json: keeps only array-of-string fields
/// (scalar detail fields like `mode` are dropped — `fields` is `Vec<String>`).
fn cap_from_json(v: &serde_json::Value) -> Option<Capability> {
    let kind = v.get("kind")?.as_str()?.to_string();
    let mut fields = BTreeMap::new();
    if let Some(obj) = v.as_object() {
        for (k, val) in obj {
            if k == "kind" {
                continue;
            }
            if let Some(arr) = val.as_array() {
                let list: Vec<String> =
                    arr.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                fields.insert(k.clone(), list);
            }
        }
    }
    Some(Capability { kind, fields })
}

/// `tau skill show` requires entries are `{name, version_req}` — no `source`,
/// so `PackageDep.source` is left empty (the UI renders no link when empty).
fn deps_from_json(v: &serde_json::Value) -> Vec<PackageDep> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|d| {
                    Some(PackageDep {
                        name: d.get("name")?.as_str()?.to_string(),
                        source: String::new(),
                        version: d
                            .get("version_req")
                            .and_then(|s| s.as_str())
                            .map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parse `tau skill list --json` (`{ "skills": [...] }`) → installed summaries.
/// Cheap list (decision A): caps/requires are left empty for installed rows.
fn parse_skill_list_json(stdout: &str) -> Vec<SkillSummary> {
    let v: serde_json::Value =
        serde_json::from_str(stdout.trim()).unwrap_or(serde_json::Value::Null);
    v.get("skills")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    Some(SkillSummary {
                        name: s.get("name")?.as_str()?.to_string(),
                        version: s.get("version").and_then(|x| x.as_str()).map(String::from),
                        source: s
                            .get("source")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string(),
                        editable: false,
                        capability_kinds: vec![],
                        requires_count: 0,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parse `tau skill show <name> --json --body` → an installed `SkillDetail`.
fn parse_skill_show_json(stdout: &str) -> Option<SkillDetail> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    let name = v.get("name")?.as_str()?.to_string();
    let capabilities = v
        .get("capabilities")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().filter_map(cap_from_json).collect())
        .unwrap_or_default();
    Some(SkillDetail {
        name,
        description: v.get("description").and_then(|x| x.as_str()).map(String::from),
        version: v.get("version").and_then(|x| x.as_str()).map(String::from),
        source: v.get("source").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        editable: false,
        content: v.get("body").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        capabilities,
        requires_tools: v.get("requires_tools").map(deps_from_json).unwrap_or_default(),
        requires_skills: v.get("requires_skills").map(deps_from_json).unwrap_or_default(),
    })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p tau-gateway skills::tests::parse_skill skills::tests::skill_parsers`
Expected: PASS (3 tests). The parsers are currently only used by tests — a dead-code warning is fine; Task 3 wires them in.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/skills/mod.rs gateway/tests/fixtures/tau-json/skill-list.json gateway/tests/fixtures/tau-json/skill-show.json
git commit -m "feat(gateway): parse tau skill list/show JSON into skill types"
```

---

## Task 3: Real `CliInstalled` impl

**Files:**
- Modify: `gateway/src/skills/mod.rs:1-9` (imports), `gateway/src/skills/mod.rs:369-382` (replace the stub)

- [ ] **Step 1: Extend the module imports**

Replace the top imports (lines 4-9). Current:

```rust
use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
```

With:

```rust
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
```

- [ ] **Step 2: Replace the `CliInstalled` stub with the real impl**

Replace the whole block at `gateway/src/skills/mod.rs:369-382`:

```rust
/// Real-tau installed-skills seam: shells `tau skill list/show` and `tau install`
/// in the project dir (single cwd-resolved scope — `skill list` has no `--all`).
/// Reads return empty/None on failure; `import` is URL-guarded and surfaces stderr.
pub struct CliInstalled {
    bin: PathBuf,
    project: PathBuf,
}

impl CliInstalled {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        CliInstalled { bin, project }
    }

    /// Run a tau subcommand in the project dir; returns (success, stdout, stderr).
    fn run(&self, args: &[&str]) -> (bool, String, String) {
        match Command::new(&self.bin)
            .args(args)
            .current_dir(&self.project)
            .output()
        {
            Ok(o) => (
                o.status.success(),
                String::from_utf8_lossy(&o.stdout).into_owned(),
                String::from_utf8_lossy(&o.stderr).into_owned(),
            ),
            Err(e) => (false, String::new(), e.to_string()),
        }
    }
}

impl InstalledSkills for CliInstalled {
    fn list(&self) -> Vec<SkillSummary> {
        let (_, out, _) = self.run(&["skill", "list", "--json"]);
        parse_skill_list_json(&out)
    }
    fn read(&self, name: &str) -> Option<SkillDetail> {
        // Guard the arg before shelling out (reject leading `-` / odd tokens).
        if !crate::packages::is_safe_pkg_name(name) {
            return None;
        }
        let (ok, out, _) = self.run(&["skill", "show", name, "--json", "--body"]);
        if !ok {
            return None;
        }
        parse_skill_show_json(&out)
    }
    fn import(&self, git_url: &str) -> Result<String> {
        if !crate::packages::is_safe_pkg_url(git_url) {
            return Err(anyhow!("invalid package url: {git_url}"));
        }
        let (ok, out, err) = self.run(&["install", git_url, "--json"]);
        if !ok {
            return Err(anyhow!("tau install failed: {}", err.trim()));
        }
        let v: serde_json::Value =
            serde_json::from_str(out.trim()).unwrap_or(serde_json::Value::Null);
        let name = v["name"].as_str().unwrap_or("").to_string();
        if name.is_empty() {
            return Err(anyhow!("tau install returned no skill name"));
        }
        Ok(name)
    }
}
```

- [ ] **Step 3: Build + clippy (no dead code now)**

Run: `cargo build --workspace --locked && cargo clippy -p tau-gateway --all-targets -- -D warnings`
Expected: clean — parsers and guards are now used; no warnings.

- [ ] **Step 4: Run the gateway unit tests**

Run: `cargo test -p tau-gateway`
Expected: PASS (parser tests + existing skills unit tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/skills/mod.rs
git commit -m "feat(gateway): wire CliInstalled to real tau skill verbs (D2b)"
```

---

## Task 4: Select the real seam in non-mock mode

**Files:**
- Modify: `gateway/src/state.rs:93-97`

- [ ] **Step 1: Pass bin/project into the real seam**

Replace the `installed_skills` selection block (lines 93-97):

```rust
        let installed_skills: Box<dyn InstalledSkills> = if is_mock {
            Box::new(skills::MockInstalled::new())
        } else {
            Box::new(skills::CliInstalled::new(bin.clone(), project.clone()))
        };
```

- [ ] **Step 2: Build**

Run: `cargo build --workspace --locked`
Expected: builds clean.

- [ ] **Step 3: Confirm the mock-tier API tests are unaffected**

Run: `cargo test -p tau-gateway --test skills_api`
Expected: PASS — these run with `is_mock=true`, so they still hit `MockInstalled` and assert the unchanged wire shape.

- [ ] **Step 4: Commit**

```bash
git add gateway/src/state.rs
git commit -m "feat(gateway): select CliInstalled when running against real tau"
```

---

## Task 5: Gated real-tau round-trip test

**Files:**
- Create: `gateway/tests/real_tau_skills.rs`

- [ ] **Step 1: Write the gated test**

Create `gateway/tests/real_tau_skills.rs` (mirrors `real_tau_packages.rs`: skips unless `TAU_REAL_BIN` is set, isolates `HOME`, builds an offline `file://` skill package). Because `tau skill list`/`skill show` and `tau install` share cwd scope resolution, install → list → read are consistent without `--all`:

```rust
//! Offline installed-skill round-trip against a REAL `tau` binary. Skips unless
//! `TAU_REAL_BIN` points at a runnable tau. Mirrors real_tau_packages.rs: builds
//! a `file://` bare-git skill package and isolates HOME so install never touches
//! the dev's real `~/.tau`. `fake-tau-serve` has no skill verbs, so this needs a
//! real binary.

use std::path::{Path, PathBuf};
use std::process::Command;
use tau_gateway::skills::{CliInstalled, InstalledSkills};

fn real_bin() -> Option<PathBuf> {
    std::env::var("TAU_REAL_BIN")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())
}

fn git(args: &[&str], cwd: &Path) {
    let ok = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(ok, "git {:?} failed", args);
}

/// Author a skill package whose manifest `source` == the bare-repo url, commit,
/// tag, and bare-clone. Returns the `file://…demo-skill.git` url.
fn build_skill_package(root: &Path) -> String {
    let bare = root.join("demo-skill.git");
    let url = format!("file://{}", bare.display());
    let pkg = root.join("pkg");
    std::fs::create_dir_all(&pkg).unwrap();
    std::fs::write(
        pkg.join("tau.toml"),
        format!(
            "name = \"demo-skill\"\nversion = \"0.1.0\"\n\
             description = \"A tiny demo skill.\"\nauthors = []\n\
             source = \"{url}\"\nkind = \"skill\"\ndependencies = []\n\n\
             [[capabilities]]\nkind = \"fs.read\"\npaths = [\"${{SKILL_DIR}}/**\"]\n\n[skill]\n"
        ),
    )
    .unwrap();
    std::fs::write(
        pkg.join("SKILL.md"),
        "---\nname: demo-skill\ndescription: A tiny demo skill.\n---\n\n# Demo Skill\nHello.\n",
    )
    .unwrap();
    git(&["init", "-q"], &pkg);
    git(&["add", "-A"], &pkg);
    git(&["commit", "-qm", "v"], &pkg);
    git(&["tag", "v0.1.0"], &pkg);
    git(
        &["clone", "-q", "--bare", pkg.to_str().unwrap(), bare.to_str().unwrap()],
        root,
    );
    url
}

#[test]
fn real_tau_skill_round_trip_offline() {
    let Some(bin) = real_bin() else {
        eprintln!("skip: set TAU_REAL_BIN");
        return;
    };
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("skip: git not available");
        return;
    }

    let root = tempfile::tempdir().unwrap();
    // Isolate HOME so global-scope install writes under <tmp>/.tau, not ~/.tau.
    // SAFETY: single-threaded gated test; no other test reads HOME concurrently.
    std::env::set_var("HOME", root.path());

    let url = build_skill_package(root.path());

    let proj = root.path().join("proj");
    std::fs::create_dir_all(&proj).unwrap();
    std::fs::write(proj.join("tau.toml"), "[project]\nname = \"p\"\n").unwrap();

    let skills = CliInstalled::new(bin, proj.clone());

    // import
    let name = skills.import(&url).expect("import");
    assert_eq!(name, "demo-skill");

    // list shows it (installed, non-editable; caps empty per cheap list)
    let listed = skills.list();
    assert!(
        listed.iter().any(|s| s.name == "demo-skill" && !s.editable),
        "list: {listed:?}"
    );

    // read returns the rich detail (body + capabilities)
    let detail = skills.read("demo-skill").expect("read detail");
    assert!(detail.content.contains("Demo Skill"), "body: {:?}", detail.content);
    assert!(
        detail.capabilities.iter().any(|c| c.kind == "fs.read"),
        "caps: {:?}",
        detail.capabilities
    );
}
```

- [ ] **Step 2: Run it (will skip without a real tau)**

Run: `cargo test -p tau-gateway --test real_tau_skills -- --nocapture`
Expected: compiles and runs; prints `skip: set TAU_REAL_BIN` and passes (no real tau in this environment). If a real tau is available, run `TAU_REAL_BIN=$(which tau) cargo test -p tau-gateway --test real_tau_skills -- --nocapture --test-threads=1` and expect the round-trip to PASS.

- [ ] **Step 3: Commit**

```bash
git add gateway/tests/real_tau_skills.rs
git commit -m "test(gateway): gated offline real-tau skill round-trip (D2b)"
```

---

## Task 6: Read-only capabilities/requires view (B′′)

**Files:**
- Modify: `web/src/tools/SkillEditorPage.tsx` (after the `{!readOnly && (…)}` block, ~line 200)
- Modify: `web/src/tools/SkillEditorPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `web/src/tools/SkillEditorPage.test.tsx` inside the `describe("SkillEditorPage", …)` block:

```tsx
it("installed skill shows read-only capabilities and requires (B'')", async () => {
  const installed = {
    name: "web-search",
    description: "Search.",
    version: "1.2.0",
    source: "file:///tmp/web-search.git",
    editable: false,
    content: "search",
    capabilities: [{ kind: "net.http", fields: { hosts: ["api.example"] } }],
    requires_tools: [{ name: "fs-read", source: "", version: "^0.1" }],
    requires_skills: [],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => installed }));
  renderAt("/projects/demo/tools/skills/web-search");
  await waitFor(() => expect(screen.getByLabelText("skill name")).toHaveValue("web-search"));

  // capability + requirement shown read-only
  expect(screen.getByText(/net\.http/)).toBeInTheDocument();
  expect(screen.getByText("fs-read")).toBeInTheDocument();
  // editor affordances absent (read-only)
  expect(screen.queryByRole("button", { name: /add capability/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && pnpm vitest run src/tools/SkillEditorPage.test.tsx`
Expected: FAIL — `Unable to find an element with the text: /net\.http/` (no read-only render yet).

- [ ] **Step 3: Add the read-only render branch**

In `web/src/tools/SkillEditorPage.tsx`, immediately **after** the closing `)}` of the `{!readOnly && ( … )}` block (the editable capabilities/requires editors, ending ~line 200) and before the closing `</div>` of the card, insert:

```tsx
        {readOnly &&
          (s.capabilities.length > 0 ||
            s.requires_tools.length > 0 ||
            s.requires_skills.length > 0) && (
            <>
              {s.capabilities.length > 0 && (
                <div>
                  <label className={label}>capabilities</label>
                  <div className="flex flex-wrap gap-1.5">
                    {s.capabilities.map((c, i) => (
                      <span
                        key={i}
                        className="rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-muted"
                      >
                        {c.kind}
                        {Object.entries(c.fields)
                          .map(([k, vals]) => ` · ${k}: ${vals.join(", ")}`)
                          .join("")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(s.requires_tools.length > 0 || s.requires_skills.length > 0) && (
                <div>
                  <label className={label}>requires</label>
                  <div className="space-y-1">
                    {[...s.requires_tools, ...s.requires_skills].map((d, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs"
                      >
                        <span className="font-semibold text-fg">{d.name}</span>
                        <span className="ml-auto text-muted">{d.version ?? ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
```

(No source link — `tau skill show` drops `source`, so installed requires carry only name + version. This is decision B′′.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm vitest run src/tools/SkillEditorPage.test.tsx`
Expected: PASS (all SkillEditorPage tests).

- [ ] **Step 5: Lint, typecheck, format (per-task frontend gate)**

Run: `cd web && pnpm lint && pnpm typecheck && pnpm format`
Expected: no eslint errors, no TS errors; prettier rewrites in place (commit any reformat).

- [ ] **Step 6: Commit**

```bash
git add web/src/tools/SkillEditorPage.tsx web/src/tools/SkillEditorPage.test.tsx
git commit -m "feat(web): read-only caps/requires view for installed skills (D2b)"
```

---

## Final verification

- [ ] **Run the full local CI bundle**

Run: `just ci`
Expected: `ci-rust` (deny, fmt-check, clippy, build, test) and `ci-web` (deny, lint, fmt-check, test, build) all pass.

- [ ] **Manual smoke (optional, needs a real tau project)**

With `tau` on PATH and a project that has installed a skill: launch the gateway against the real binary, open the Skills tab, confirm installed skills list (caps `—`/0 in the index), click one to see the read-only detail with capability chips + requires rows, and import a skill by git URL.

---

## Plan self-review

- **Spec coverage:** scope (Skills only) — Tasks 3-4 wire only `CliInstalled`, mocks/`CliTools`/`CliPlugins` untouched ✓. list() cheap (Task 2 leaves caps/requires empty) ✓. single scope `current_dir(project)` (Task 3 `run`) ✓. read() `--body` no `--raw` (Task 3) ✓. import() `tau install --json` + reused `is_safe_pkg_url` (Tasks 1, 3) ✓. dedup local-wins — unchanged composition `skills::list` (local appended first) — no task needed ✓. errors silent-empty on reads, `anyhow!` on import (Task 3) ✓. UI B′′ (Task 6) ✓. tests: mock tier unchanged (Task 4 step 3), parser units (Task 2), gated round-trip (Task 5) ✓.
- **Placeholder scan:** no TBD/TODO; every code step shows full code; every command has expected output.
- **Type consistency:** `parse_skill_list_json`/`parse_skill_show_json`/`cap_from_json`/`deps_from_json`/`CliInstalled::new`/`is_safe_pkg_url`/`is_safe_pkg_name` names are used identically across Tasks 1-5. `SkillSummary`/`SkillDetail`/`Capability`/`PackageDep` field names match `gateway/src/skills/mod.rs:11-49`. Frontend uses `s.capabilities`/`s.requires_tools`/`s.requires_skills` matching `SkillDetail`.
