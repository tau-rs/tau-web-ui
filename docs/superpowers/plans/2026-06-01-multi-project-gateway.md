# Multi-project Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-project gateway into a project registry that owns many projects, scopes every existing route under `/api/projects/:pid/…`, and adds global endpoints for the Projects home (list+summaries, cross-project runs feed, add by path/git, remove).

**Architecture:** A new `ProjectRegistry` (Arc + RwLock<IndexMap>) owns one `AppState` per project, each with its own `RunStore` at `~/.tau-web-ui/projects/<id>/runs/`. The registry persists project metadata to `~/.tau-web-ui/projects.json`. A `Scoped` axum extractor resolves `:pid` → that project's `AppState` (404 if unknown), so existing handlers keep their bodies and only swap `State<AppState>` for `Scoped`. New global handlers operate on the registry directly.

**Tech Stack:** Rust, tokio, axum 0.7, serde, ts-rs, chrono, indexmap (new dep). Mock mode keyed off the `--tau-bin` basename containing `fake-tau-serve`, exactly as today.

This is **Plan 1 of 2** for multi-project support (see `docs/superpowers/specs/2026-06-01-multi-project-design.md`). Plan 2 (frontend) builds on the API delivered here.

---

## File Structure

**New files:**
- `gateway/src/projects/mod.rs` — `ProjectId`, `ProjectSource`, `ProjectMeta`, `ProjectSummary`, `ProjectListItem`, `CrossProjectRun`, `slug()`, and the `ProjectRegistry` (construction, persistence, add/remove/state/summaries/cross-runs).
- `gateway/src/projects/cloner.rs` — `ProjectCloner` trait, `GitCloner` (shells `git clone`), `MockCloner` (seeds a `tau.toml` for tests/mock mode).
- `gateway/src/api/scope.rs` — `Scoped` extractor resolving `:pid` → `AppState`.
- `gateway/src/api/projects.rs` — global handlers: `list`, `cross_runs`, `add`, `remove`.

**Modified files:**
- `gateway/src/lib.rs` — add `pub mod projects;`.
- `gateway/src/state.rs` — add `engine_alive_cached()` helper.
- `gateway/src/api/mod.rs` — new router: global routes + nested scoped router with state `ProjectRegistry`.
- `gateway/src/api/{meta,runs,ws,config,packages,agents,workflows}.rs` — swap `State<AppState>` → `Scoped`; path-param handlers read `(pid, id)`.
- `gateway/src/main.rs` — build the registry, auto-register `--project`, rehydrate all.
- `gateway/Cargo.toml` (+ workspace `Cargo.toml`) — add `indexmap`; add `reqwest` dev-dependency for HTTP integration tests.

**New test files:**
- `gateway/tests/projects_registry.rs` — registry CRUD, slug dedupe, store isolation, summaries, cross-runs.
- `gateway/tests/projects_api.rs` — router-level: global GET, scoped 404, scoped WS path.

---

## Task 1: Slug helper + project metadata types

**Files:**
- Create: `gateway/src/projects/mod.rs`
- Modify: `gateway/src/lib.rs`

- [ ] **Step 1: Add the module to lib.rs**

In `gateway/src/lib.rs`, add the module declaration after `pub mod packages;`:

```rust
pub mod packages;
pub mod projects;
```

- [ ] **Step 2: Write the failing test (slug rules)**

Create `gateway/src/projects/mod.rs` with only the types + `slug` + a unit test module:

```rust
//! Project registry: owns one AppState per tau project, persisted to
//! `<data_root>/projects.json`, each project's runs under
//! `<data_root>/projects/<id>/runs/`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub mod cloner;

pub type ProjectId = String;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProjectSource {
    Local,
    Git { url: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectMeta {
    pub id: ProjectId,
    pub name: String,
    pub path: String,
    pub source: ProjectSource,
}

/// Lowercase, collapse non-[a-z0-9-] runs to a single '-', trim leading/trailing '-'.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_normalizes() {
        assert_eq!(slug("Acme Bot"), "acme-bot");
        assert_eq!(slug("research_kit!!"), "research-kit");
        assert_eq!(slug("  --demo--  "), "demo");
    }
}
```

This will not compile yet because `pub mod cloner;` references a missing file. Create an empty placeholder so the crate builds:

```bash
mkdir -p gateway/src/projects
printf '//! Cloner placeholder (filled in Task 2).\n' > gateway/src/projects/cloner.rs
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cargo test -p tau-gateway projects::tests::slug_normalizes`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add gateway/src/lib.rs gateway/src/projects/
git commit -m "feat(gateway): project metadata types + slug helper"
```

---

## Task 2: ProjectCloner trait + Git/Mock cloners

**Files:**
- Modify: `gateway/src/projects/cloner.rs`

- [ ] **Step 1: Write the failing test**

Replace `gateway/src/projects/cloner.rs` with:

```rust
//! Cloning a project from a git URL into a workspace dir. `GitCloner` shells
//! `git clone`; `MockCloner` seeds a minimal `tau.toml` so mock/e2e runs need no
//! network. Selected by the gateway based on the configured tau binary.

use std::path::Path;
use std::process::Command;

use anyhow::{bail, Result};

pub trait ProjectCloner: Send + Sync {
    /// Clone `url` into `dest` (which must not already exist).
    fn clone(&self, url: &str, dest: &Path) -> Result<()>;
}

pub struct GitCloner;

impl ProjectCloner for GitCloner {
    fn clone(&self, url: &str, dest: &Path) -> Result<()> {
        let out = Command::new("git")
            .arg("clone")
            .arg("--depth")
            .arg("1")
            .arg(url)
            .arg(dest)
            .output()?;
        if !out.status.success() {
            bail!(
                "git clone failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        Ok(())
    }
}

/// Test/mock cloner: creates `dest` with a minimal `tau.toml` named after the
/// repo's last path segment, so registration validation succeeds offline.
pub struct MockCloner;

impl ProjectCloner for MockCloner {
    fn clone(&self, url: &str, dest: &Path) -> Result<()> {
        std::fs::create_dir_all(dest)?;
        let name = crate::packages::name_from_url(url);
        std::fs::write(
            dest.join("tau.toml"),
            format!("[project]\nname = \"{name}\"\n"),
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_cloner_seeds_tau_toml() {
        let d = tempfile::tempdir().unwrap();
        let dest = d.path().join("repo");
        MockCloner
            .clone("https://github.com/acme/cool-bot.git", &dest)
            .unwrap();
        let toml = std::fs::read_to_string(dest.join("tau.toml")).unwrap();
        assert!(toml.contains("name = \"cool-bot\""));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails, then passes**

Run: `cargo test -p tau-gateway cloner::tests::mock_cloner_seeds_tau_toml`
Expected: PASS. (If `name_from_url` is not `pub` in `packages`, make it `pub` — it already is, per `state.rs` importing it.)

- [ ] **Step 3: Commit**

```bash
git add gateway/src/projects/cloner.rs
git commit -m "feat(gateway): ProjectCloner trait with Git and Mock cloners"
```

---

## Task 3: ProjectRegistry — construction, add_local, state, list, persistence

**Files:**
- Modify: `gateway/src/projects/mod.rs`
- Modify: `gateway/Cargo.toml`, `Cargo.toml` (workspace)
- Test: `gateway/tests/projects_registry.rs`

- [ ] **Step 1: Add the `indexmap` dependency**

In the workspace `Cargo.toml` under `[workspace.dependencies]`, add:

```toml
indexmap = { version = "2", features = ["serde"] }
```

In `gateway/Cargo.toml` under `[dependencies]`, add:

```toml
indexmap.workspace = true
```

- [ ] **Step 2: Write the registry core in `projects/mod.rs`**

Add these imports at the top of `gateway/src/projects/mod.rs` (below the existing `use` lines):

```rust
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use indexmap::IndexMap;
use tokio::sync::RwLock;

use crate::projects::cloner::{GitCloner, MockCloner, ProjectCloner};
use crate::state::AppState;
use crate::store::RunStore;
```

Then append the registry implementation:

```rust
pub struct ProjectEntry {
    pub meta: ProjectMeta,
    pub state: AppState,
}

struct Inner {
    projects: RwLock<IndexMap<ProjectId, ProjectEntry>>,
    bin: PathBuf,
    no_sandbox: bool,
    data_root: PathBuf,
    is_mock: bool,
}

#[derive(Clone)]
pub struct ProjectRegistry(Arc<Inner>);

impl ProjectRegistry {
    /// Build an empty registry, then load any persisted projects from
    /// `<data_root>/projects.json`. Each loaded project is rehydrated from disk.
    pub async fn load(bin: PathBuf, no_sandbox: bool, data_root: PathBuf) -> Result<Self> {
        let is_mock = bin
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.contains("fake-tau-serve"))
            .unwrap_or(false);
        std::fs::create_dir_all(&data_root).ok();
        let reg = ProjectRegistry(Arc::new(Inner {
            projects: RwLock::new(IndexMap::new()),
            bin,
            no_sandbox,
            data_root,
            is_mock,
        }));
        for meta in reg.read_manifest()? {
            reg.insert_entry(meta).await?;
        }
        Ok(reg)
    }

    fn manifest_path(&self) -> PathBuf {
        self.0.data_root.join("projects.json")
    }

    fn read_manifest(&self) -> Result<Vec<ProjectMeta>> {
        let path = self.manifest_path();
        if !path.exists() {
            return Ok(vec![]);
        }
        let text = std::fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&text).unwrap_or_default())
    }

    async fn write_manifest(&self) -> Result<()> {
        let metas: Vec<ProjectMeta> = self
            .0
            .projects
            .read()
            .await
            .values()
            .map(|e| e.meta.clone())
            .collect();
        let text = serde_json::to_string_pretty(&metas)?;
        std::fs::write(self.manifest_path(), text)?;
        Ok(())
    }

    fn cloner(&self) -> Box<dyn ProjectCloner> {
        if self.0.is_mock {
            Box::new(MockCloner)
        } else {
            Box::new(GitCloner)
        }
    }

    /// Build the AppState for a project path under a per-project store dir and
    /// rehydrate it, then insert under its (already-final) id.
    async fn insert_entry(&self, meta: ProjectMeta) -> Result<()> {
        let store_dir = self.0.data_root.join("projects").join(&meta.id).join("runs");
        let store = RunStore::new(&store_dir)?;
        let state = AppState::new(
            self.0.bin.clone(),
            PathBuf::from(&meta.path),
            self.0.no_sandbox,
            store,
        );
        state.rehydrate().await?;
        self.0
            .projects
            .write()
            .await
            .insert(meta.id.clone(), ProjectEntry { meta, state });
        Ok(())
    }

    /// Allocate a collision-free id for `base` (slugged display name).
    async fn unique_id(&self, base: &str) -> ProjectId {
        let base = if base.is_empty() { "project".into() } else { slug(base) };
        let map = self.0.projects.read().await;
        if !map.contains_key(&base) {
            return base;
        }
        let mut n = 2;
        loop {
            let candidate = format!("{base}-{n}");
            if !map.contains_key(&candidate) {
                return candidate;
            }
            n += 1;
        }
    }

    /// Resolve a project's display name + validate it has a tau.toml.
    fn project_name(path: &Path) -> Result<String> {
        if !path.join("tau.toml").exists() {
            bail!("no tau.toml found at {}", path.display());
        }
        // Prefer [project].name, fall back to dir basename.
        let name = crate::config::read(path)
            .ok()
            .map(|c| c.name)
            .filter(|n| !n.is_empty())
            .or_else(|| {
                path.file_name()
                    .map(|s| s.to_string_lossy().to_string())
            })
            .unwrap_or_else(|| "project".into());
        Ok(name)
    }

    /// Register a project already on disk at `path`. Idempotent on absolute path:
    /// if a project with the same canonical path exists, return its meta unchanged.
    pub async fn add_local(&self, path: &Path) -> Result<ProjectMeta> {
        let abs = std::fs::canonicalize(path)
            .with_context(|| format!("path not found: {}", path.display()))?;
        if let Some(existing) = self.find_by_path(&abs).await {
            return Ok(existing);
        }
        let name = Self::project_name(&abs)?;
        let id = self.unique_id(&name).await;
        let meta = ProjectMeta {
            id,
            name,
            path: abs.to_string_lossy().to_string(),
            source: ProjectSource::Local,
        };
        self.insert_entry(meta.clone()).await?;
        self.write_manifest().await?;
        Ok(meta)
    }

    async fn find_by_path(&self, abs: &Path) -> Option<ProjectMeta> {
        let want = abs.to_string_lossy().to_string();
        self.0
            .projects
            .read()
            .await
            .values()
            .find(|e| e.meta.path == want)
            .map(|e| e.meta.clone())
    }

    /// Resolve a project's AppState by id (None if unknown).
    pub async fn state(&self, id: &str) -> Option<AppState> {
        self.0.projects.read().await.get(id).map(|e| e.state.clone())
    }

    /// All project metas in insertion order.
    pub async fn metas(&self) -> Vec<ProjectMeta> {
        self.0.projects.read().await.values().map(|e| e.meta.clone()).collect()
    }
}
```

- [ ] **Step 3: Write the failing integration test**

Create `gateway/tests/projects_registry.rs`:

```rust
use std::path::PathBuf;
use tau_gateway::projects::{ProjectRegistry, ProjectSource};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

fn make_project(name: &str) -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("tau.toml"),
        format!("[project]\nname = \"{name}\"\n\n[agents.greeter]\ndisplay_name = \"Greeter\"\nllm_backend = \"anthropic\"\n"),
    )
    .unwrap();
    d
}

#[tokio::test]
async fn add_local_registers_and_persists() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(proj.path()).await.unwrap();
    assert_eq!(meta.id, "demo");
    assert_eq!(meta.source, ProjectSource::Local);
    assert!(reg.state("demo").await.is_some());

    // persisted: a fresh registry over the same data_root sees it
    let reg2 = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    assert!(reg2.state("demo").await.is_some());
}

#[tokio::test]
async fn add_local_dedupes_id_on_name_collision() {
    let data = tempfile::tempdir().unwrap();
    let a = make_project("demo");
    let b = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let ma = reg.add_local(a.path()).await.unwrap();
    let mb = reg.add_local(b.path()).await.unwrap();
    assert_eq!(ma.id, "demo");
    assert_eq!(mb.id, "demo-2");
}

#[tokio::test]
async fn add_local_rejects_dir_without_tau_toml() {
    let data = tempfile::tempdir().unwrap();
    let empty = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    assert!(reg.add_local(empty.path()).await.is_err());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p tau-gateway --test projects_registry`
Expected: PASS (3 tests). (Requires `fake-tau-serve` built: `cargo build -p fake-tau-serve` if missing.)

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml gateway/Cargo.toml gateway/src/projects/mod.rs gateway/tests/projects_registry.rs
git commit -m "feat(gateway): ProjectRegistry add_local + persistence + id dedupe"
```

---

## Task 4: add_git + remove

**Files:**
- Modify: `gateway/src/projects/mod.rs`
- Test: `gateway/tests/projects_registry.rs`

- [ ] **Step 1: Add `add_git` and `remove` to the registry**

Append these methods inside `impl ProjectRegistry` in `gateway/src/projects/mod.rs`:

```rust
    /// Clone `url` into `<data_root>/workspaces/<slug>/`, validate, and register.
    pub async fn add_git(&self, url: &str) -> Result<ProjectMeta> {
        let base = crate::packages::name_from_url(url);
        let id = self.unique_id(&base).await;
        let dest = self.0.data_root.join("workspaces").join(&id);
        if dest.exists() {
            bail!("workspace already exists: {}", dest.display());
        }
        std::fs::create_dir_all(dest.parent().unwrap()).ok();
        self.cloner().clone(url, &dest)?;
        let name = Self::project_name(&dest)?;
        let meta = ProjectMeta {
            id,
            name,
            path: dest.to_string_lossy().to_string(),
            source: ProjectSource::Git { url: url.to_string() },
        };
        self.insert_entry(meta.clone()).await?;
        self.write_manifest().await?;
        Ok(meta)
    }

    /// Unregister a project (non-destructive: leaves run history + workspace on disk).
    pub async fn remove(&self, id: &str) -> Result<bool> {
        let removed = self.0.projects.write().await.shift_remove(id).is_some();
        if removed {
            self.write_manifest().await?;
        }
        Ok(removed)
    }
```

- [ ] **Step 2: Write the failing test**

Append to `gateway/tests/projects_registry.rs`:

```rust
#[tokio::test]
async fn add_git_clones_via_mock_then_remove() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    // bin() is fake-tau-serve -> MockCloner seeds a tau.toml, no network.
    let meta = reg
        .add_git("https://github.com/acme/cool-bot.git")
        .await
        .unwrap();
    assert_eq!(meta.id, "cool-bot");
    match meta.source {
        ProjectSource::Git { ref url } => assert!(url.contains("cool-bot")),
        _ => panic!("expected Git source"),
    }
    assert!(reg.state("cool-bot").await.is_some());

    assert!(reg.remove("cool-bot").await.unwrap());
    assert!(reg.state("cool-bot").await.is_none());
    assert!(!reg.remove("cool-bot").await.unwrap()); // already gone
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cargo test -p tau-gateway --test projects_registry`
Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
git add gateway/src/projects/mod.rs gateway/tests/projects_registry.rs
git commit -m "feat(gateway): add_git via cloner + non-destructive remove"
```

---

## Task 5: Per-project summaries

**Files:**
- Modify: `gateway/src/projects/mod.rs`
- Modify: `gateway/src/state.rs`
- Test: `gateway/tests/projects_registry.rs`

- [ ] **Step 1: Add `engine_alive_cached` to AppState**

In `gateway/src/state.rs`, add this method inside `impl AppState` (e.g. after `cancel`):

```rust
    /// Engine health WITHOUT spawning a child: true if no child started yet
    /// (nothing has failed) or the existing child is alive.
    pub async fn engine_alive_cached(&self) -> bool {
        match self.0.client.lock().await.as_ref() {
            Some(c) => c.is_alive().await,
            None => true,
        }
    }
```

- [ ] **Step 2: Add summary types + `list_summaries` to the registry**

In `gateway/src/projects/mod.rs`, add `use crate::trace::{Run, RunStatus};` to the imports, then append the types (near the other `#[ts(export)]` structs) and the method:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectSummary {
    pub runs: u32,
    pub running: u32,
    pub failed_24h: u32,
    pub success_rate: f32,
    pub tokens: u64,
    pub last_activity: Option<String>,
    pub agents: u32,
    pub engine_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectListItem {
    pub meta: ProjectMeta,
    pub summary: ProjectSummary,
}
```

Add the method inside `impl ProjectRegistry`:

```rust
    /// Compute a summary per project from persisted runs + config. `now` is an
    /// RFC3339 timestamp used for the 24h failure window (injected for testing).
    pub async fn list_summaries(&self, now: &str) -> Vec<ProjectListItem> {
        let now_dt = chrono::DateTime::parse_from_rfc3339(now).ok();
        let mut items = vec![];
        let ids: Vec<ProjectId> = self.0.projects.read().await.keys().cloned().collect();
        for id in ids {
            let (meta, state) = {
                let map = self.0.projects.read().await;
                let e = map.get(&id).unwrap();
                (e.meta.clone(), e.state.clone())
            };
            let runs = state.list_runs().await;
            let summary = summarize(&runs, now_dt, &state).await;
            items.push(ProjectListItem { meta, summary });
        }
        items
    }
```

And add this free function at the bottom of the file:

```rust
async fn summarize(
    runs: &[Run],
    now: Option<chrono::DateTime<chrono::FixedOffset>>,
    state: &AppState,
) -> ProjectSummary {
    let total = runs.len() as u32;
    let running = runs.iter().filter(|r| r.status == RunStatus::Running).count() as u32;
    let terminal: Vec<&Run> = runs
        .iter()
        .filter(|r| r.status != RunStatus::Running)
        .collect();
    let completed = terminal
        .iter()
        .filter(|r| r.status == RunStatus::Completed)
        .count();
    let success_rate = if terminal.is_empty() {
        0.0
    } else {
        completed as f32 / terminal.len() as f32
    };
    let failed_24h = runs
        .iter()
        .filter(|r| r.status == RunStatus::Failed)
        .filter(|r| within_24h(r.ended_at.as_deref(), now))
        .count() as u32;
    let tokens: u64 = runs
        .iter()
        .filter_map(|r| r.token_usage.as_ref())
        .map(|u| u.input_tokens as u64 + u.output_tokens as u64)
        .sum();
    let last_activity = runs.iter().map(|r| r.started_at.clone()).max();
    let agents = state.config_read().map(|c| c.agents.len() as u32).unwrap_or(0);
    let engine_ok = state.engine_alive_cached().await;
    ProjectSummary {
        runs: total,
        running,
        failed_24h,
        success_rate,
        tokens,
        last_activity,
        agents,
        engine_ok,
    }
}

fn within_24h(
    ended_at: Option<&str>,
    now: Option<chrono::DateTime<chrono::FixedOffset>>,
) -> bool {
    match (ended_at.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()), now) {
        (Some(ended), Some(now)) => (now - ended).num_hours() < 24 && now >= ended,
        _ => false,
    }
}
```

- [ ] **Step 3: Write the failing test**

Append to `gateway/tests/projects_registry.rs`:

```rust
#[tokio::test]
async fn summaries_reflect_runs() {
    use tau_gateway::trace::RunStatus;
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    reg.add_local(proj.path()).await.unwrap();
    let state = reg.state("demo").await.unwrap();

    // drive a real run to completion via fake-tau-serve
    let id = state.launch("greeter".into(), "hi".into()).await.unwrap();
    for _ in 0..200 {
        if let Some(r) = state.get_run(&id).await {
            if r.status != RunStatus::Running {
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }

    let items = reg.list_summaries("2999-01-01T00:00:00Z").await;
    let demo = items.iter().find(|i| i.meta.id == "demo").unwrap();
    assert_eq!(demo.summary.runs, 1);
    assert!(demo.summary.agents >= 1);
    assert!(demo.summary.success_rate > 0.0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p tau-gateway --test projects_registry summaries_reflect_runs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/projects/mod.rs gateway/src/state.rs gateway/tests/projects_registry.rs
git commit -m "feat(gateway): per-project summaries with injectable now"
```

---

## Task 6: Cross-project runs feed

**Files:**
- Modify: `gateway/src/projects/mod.rs`
- Test: `gateway/tests/projects_registry.rs`

- [ ] **Step 1: Add `CrossProjectRun` + `cross_runs`**

In `gateway/src/projects/mod.rs`, add the type near the other `#[ts(export)]` structs:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CrossProjectRun {
    pub project_id: ProjectId,
    pub project_name: String,
    pub run: Run,
}
```

Add the method inside `impl ProjectRegistry`:

```rust
    /// Recent runs across all projects, newest first. `status` (if set) filters
    /// by RunStatus serde value ("failed", "running", "completed", "cancelled").
    pub async fn cross_runs(&self, status: Option<&str>, limit: usize) -> Vec<CrossProjectRun> {
        let entries: Vec<(ProjectId, String, AppState)> = {
            let map = self.0.projects.read().await;
            map.values()
                .map(|e| (e.meta.id.clone(), e.meta.name.clone(), e.state.clone()))
                .collect()
        };
        let mut out: Vec<CrossProjectRun> = vec![];
        for (pid, pname, state) in entries {
            for run in state.list_runs().await {
                if let Some(s) = status {
                    let matches = serde_json::to_value(&run.status)
                        .ok()
                        .and_then(|v| v.as_str().map(|x| x == s))
                        .unwrap_or(false);
                    if !matches {
                        continue;
                    }
                }
                out.push(CrossProjectRun {
                    project_id: pid.clone(),
                    project_name: pname.clone(),
                    run,
                });
            }
        }
        out.sort_by(|a, b| b.run.started_at.cmp(&a.run.started_at));
        out.truncate(limit);
        out
    }
```

- [ ] **Step 2: Write the failing test**

Append to `gateway/tests/projects_registry.rs`:

```rust
#[tokio::test]
async fn cross_runs_aggregates_and_filters() {
    let data = tempfile::tempdir().unwrap();
    let a = make_project("alpha");
    let b = make_project("beta");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    reg.add_local(a.path()).await.unwrap();
    reg.add_local(b.path()).await.unwrap();
    reg.state("alpha")
        .await
        .unwrap()
        .launch("greeter".into(), "hi".into())
        .await
        .unwrap();
    reg.state("beta")
        .await
        .unwrap()
        .launch("greeter".into(), "hi".into())
        .await
        .unwrap();

    let all = reg.cross_runs(None, 50).await;
    assert_eq!(all.len(), 2);
    let ids: Vec<&str> = all.iter().map(|r| r.project_id.as_str()).collect();
    assert!(ids.contains(&"alpha") && ids.contains(&"beta"));

    // limit is respected
    assert_eq!(reg.cross_runs(None, 1).await.len(), 1);
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cargo test -p tau-gateway --test projects_registry cross_runs_aggregates_and_filters`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add gateway/src/projects/mod.rs gateway/tests/projects_registry.rs
git commit -m "feat(gateway): cross-project runs feed with status filter + limit"
```

---

## Task 7: `Scoped` extractor

**Files:**
- Create: `gateway/src/api/scope.rs`
- Modify: `gateway/src/api/mod.rs` (add `pub mod scope;`)

- [ ] **Step 1: Write the extractor**

Create `gateway/src/api/scope.rs`:

```rust
//! `Scoped` extractor: resolves the `:pid` path param against the
//! `ProjectRegistry` router state into that project's `AppState` (404 if unknown).

use std::collections::HashMap;

use axum::{
    async_trait,
    extract::{FromRequestParts, Path},
    http::{request::Parts, StatusCode},
};

use crate::projects::ProjectRegistry;
use crate::state::AppState;

pub struct Scoped(pub AppState);

#[async_trait]
impl FromRequestParts<ProjectRegistry> for Scoped {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        reg: &ProjectRegistry,
    ) -> Result<Self, Self::Rejection> {
        let params = Path::<HashMap<String, String>>::from_request_parts(parts, reg)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        let pid = params
            .get("pid")
            .ok_or((StatusCode::BAD_REQUEST, "missing project id".to_string()))?;
        match reg.state(pid).await {
            Some(state) => Ok(Scoped(state)),
            None => Err((StatusCode::NOT_FOUND, format!("unknown project: {pid}"))),
        }
    }
}
```

In `gateway/src/api/mod.rs`, add `pub mod scope;` to the module list at the top.

- [ ] **Step 2: Verify it compiles**

Run: `cargo build -p tau-gateway`
Expected: compiles (handlers not yet refactored — `mod.rs` router still references old `State<AppState>` and will be rewritten in Task 8; this step only confirms the extractor itself compiles. If `mod.rs` already fails to build because the router type mismatches, proceed to Task 8 before running tests — they are committed together).

Note: to keep the build green at each commit, Tasks 7 and 8 are committed together. Do Step 1 here, then complete Task 8, then run the full build/test and commit once.

---

## Task 8: Refactor router + handlers; add global handlers

**Files:**
- Create: `gateway/src/api/projects.rs`
- Modify: `gateway/src/api/mod.rs`
- Modify: `gateway/src/api/{meta,runs,ws,config,packages,agents,workflows}.rs`
- Test: `gateway/tests/projects_api.rs`

- [ ] **Step 1: Write the global handlers**

Create `gateway/src/api/projects.rs`:

```rust
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::projects::{CrossProjectRun, ProjectListItem, ProjectMeta, ProjectRegistry};
use crate::state::now;

pub async fn list(State(reg): State<ProjectRegistry>) -> Json<Vec<ProjectListItem>> {
    Json(reg.list_summaries(&now()).await)
}

#[derive(Deserialize)]
pub struct CrossQuery {
    pub status: Option<String>,
    pub limit: Option<usize>,
}

pub async fn cross_runs(
    State(reg): State<ProjectRegistry>,
    Query(q): Query<CrossQuery>,
) -> Json<Vec<CrossProjectRun>> {
    Json(reg.cross_runs(q.status.as_deref(), q.limit.unwrap_or(50)).await)
}

#[derive(Deserialize)]
pub struct AddBody {
    pub path: Option<String>,
    pub git_url: Option<String>,
}

pub async fn add(
    State(reg): State<ProjectRegistry>,
    Json(b): Json<AddBody>,
) -> Result<(StatusCode, Json<ProjectMeta>), (StatusCode, String)> {
    let meta = match (b.path, b.git_url) {
        (Some(p), None) => reg
            .add_local(std::path::Path::new(&p))
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
        (None, Some(url)) => reg
            .add_git(&url)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                "provide exactly one of `path` or `git_url`".to_string(),
            ))
        }
    };
    Ok((StatusCode::CREATED, Json(meta)))
}

pub async fn remove(
    State(reg): State<ProjectRegistry>,
    Path(pid): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    match reg.remove(&pid).await {
        Ok(true) => Ok(StatusCode::NO_CONTENT),
        Ok(false) => Err((StatusCode::NOT_FOUND, format!("unknown project: {pid}"))),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

/// Global gateway health (no project needed).
pub async fn health() -> Json<Value> {
    Json(json!({ "gateway_ok": true }))
}
```

- [ ] **Step 2: Rewrite the router**

Replace the body of `gateway/src/api/mod.rs` with:

```rust
//! HTTP/WS API surface. Per-project routes are nested under `/api/projects/:pid`
//! and resolve their `AppState` via the `Scoped` extractor; global routes operate
//! on the `ProjectRegistry` directly.
pub mod agents;
pub mod config;
pub mod meta;
pub mod packages;
pub mod projects;
pub mod runs;
pub mod scope;
pub mod workflows;
pub mod ws;

use crate::projects::ProjectRegistry;
use axum::{
    routing::{delete, get, post},
    Router,
};

pub fn router(reg: ProjectRegistry) -> Router {
    let scoped = Router::new()
        .route("/", delete(projects::remove))
        .route("/health", get(meta::health))
        .route("/project", get(meta::project))
        .route("/project/config", get(config::get).put(config::put))
        .route("/runs", post(runs::launch).get(runs::list))
        .route("/runs/:id", get(runs::get_one))
        .route("/runs/:id/cancel", post(runs::cancel))
        .route("/runs/:id/events", get(ws::ws_handler))
        .route("/workflows", get(workflows::list))
        .route("/workflows/run", post(workflows::run))
        .route("/packages", get(packages::list))
        .route("/packages/install", post(packages::install))
        .route("/packages/resolve", post(packages::resolve))
        .route("/packages/verify", post(packages::verify))
        .route("/packages/:name", delete(packages::uninstall))
        .route("/packages/:name/update", post(packages::update))
        .route("/agents/import", post(agents::import));

    Router::new()
        .route("/api/health", get(projects::health))
        .route("/api/projects", get(projects::list).post(projects::add))
        .route("/api/projects/runs", get(projects::cross_runs))
        .nest("/api/projects/:pid", scoped)
        .with_state(reg)
}
```

- [ ] **Step 3: Refactor the no-path handlers (swap `State<AppState>` → `Scoped`)**

In each of these handlers, change the state extractor. The handler **bodies are unchanged**.

`gateway/src/api/meta.rs` — replace both `State(state): State<AppState>` with `Scoped(state): Scoped`, and update the import line `use crate::state::AppState;` → `use crate::api::scope::Scoped;`:

```rust
use axum::Json;
use serde_json::{json, Value};

use crate::api::scope::Scoped;

pub async fn project(Scoped(state): Scoped) -> Json<Value> {
    match state.handshake().await {
        Ok(hs) => Json(json!({
            "project_path": hs.project_path, "agents": hs.agents,
            "tau_version": hs.server_version,
        })),
        Err(e) => Json(json!({ "error": e.to_string() })),
    }
}

pub async fn health(Scoped(state): Scoped) -> Json<Value> {
    let (ok, ver) = match state.handshake().await {
        Ok(hs) => (true, hs.server_version),
        Err(_) => (false, String::new()),
    };
    Json(json!({
        "gateway_ok": true,
        "tau_bin": state.0.bin.to_string_lossy(),
        "tau_version": ver,
        "engine_ok": ok,
    }))
}
```

`gateway/src/api/config.rs` — change the two handler signatures and import:

```rust
use axum::{http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;
use crate::config::ProjectConfig;

pub async fn get(Scoped(state): Scoped) -> Result<Json<ProjectConfig>, (StatusCode, String)> {
    state
        .config_read()
        .map(Json)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[derive(Deserialize)]
pub struct PutBody {
    pub name: String,
    pub description: Option<String>,
}

pub async fn put(
    Scoped(state): Scoped,
    Json(b): Json<PutBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .config_write(&b.name, b.description.as_deref())
        .map(|_| Json(json!({ "ok": true })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
```

`gateway/src/api/workflows.rs` — change import + both signatures (`State(state): State<AppState>` → `Scoped(state): Scoped`):

```rust
use axum::{http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;

pub async fn list(Scoped(state): Scoped) -> Json<Value> {
    Json(json!({ "workflows": state.list_workflows() }))
}

#[derive(Deserialize)]
pub struct RunBody {
    pub workflow: String,
    pub input: String,
}

pub async fn run(
    Scoped(state): Scoped,
    Json(body): Json<RunBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let run_id = state
        .launch_workflow(body.workflow, body.input)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    Ok(Json(json!({ "run_id": run_id })))
}
```

`gateway/src/api/agents.rs` — change import + signature:

```rust
use axum::{http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;

#[derive(Deserialize)]
pub struct ImportBody {
    pub git_url: String,
    pub llm_backend: String,
}

pub async fn import(
    Scoped(state): Scoped,
    Json(b): Json<ImportBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .import_agent(&b.git_url, &b.llm_backend)
        .map(|id| Json(json!({ "agent_id": id })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
```

`gateway/src/api/packages.rs` — change import to `use crate::api::scope::Scoped;` and the `extract` import to only `Path`; swap every `State(state): State<AppState>` → `Scoped(state): Scoped`. The `:name` handlers keep `Path(name): Path<String>` **but** the route is now `/api/projects/:pid/packages/:name`, so the param order is `(pid, name)` — change those two to `Path((_pid, name)): Path<(String, String)>`:

```rust
use axum::{
    extract::Path,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;

pub async fn list(Scoped(state): Scoped) -> Json<Value> {
    Json(json!({ "packages": state.packages() }))
}

#[derive(Deserialize)]
pub struct InstallBody {
    pub git_url: String,
}

pub async fn install(
    Scoped(state): Scoped,
    Json(b): Json<InstallBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_install(&b.git_url)
        .map(|p| Json(json!({ "package": p })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn uninstall(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_uninstall(&name)
        .map(|_| Json(json!({ "ok": true })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[derive(Deserialize)]
pub struct UpdateBody {
    pub to: Option<String>,
}

pub async fn update(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
    Json(b): Json<UpdateBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_update(&name, b.to)
        .map(|p| Json(json!({ "package": p })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn resolve(Scoped(state): Scoped) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_resolve()
        .map(|pkgs| Json(json!({ "packages": pkgs })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn verify(Scoped(state): Scoped) -> Json<Value> {
    Json(json!({ "results": state.package_verify() }))
}
```

- [ ] **Step 4: Refactor the run handlers (path now carries `(pid, id)`)**

`gateway/src/api/runs.rs` — swap state extractor and update the `:id` handlers to `Path<(String, String)>`:

```rust
use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::scope::Scoped;
use crate::trace::Run;

#[derive(Deserialize)]
pub struct LaunchBody {
    pub agent_id: String,
    pub prompt: String,
}

pub async fn launch(
    Scoped(state): Scoped,
    Json(body): Json<LaunchBody>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let run_id = state
        .launch(body.agent_id, body.prompt)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    Ok(Json(json!({ "run_id": run_id })))
}

#[derive(Deserialize)]
pub struct ListQuery {
    pub status: Option<String>,
    pub agent: Option<String>,
}

pub async fn list(Scoped(state): Scoped, Query(q): Query<ListQuery>) -> Json<Vec<Run>> {
    let mut runs = state.list_runs().await;
    if let Some(s) = q.status.as_deref() {
        runs.retain(|r| {
            serde_json::to_value(&r.status)
                .ok()
                .and_then(|v| v.as_str().map(|x| x == s))
                .unwrap_or(false)
        });
    }
    if let Some(a) = q.agent.as_deref() {
        runs.retain(|r| r.agent_id == a);
    }
    Json(runs)
}

pub async fn get_one(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Result<Json<Value>, StatusCode> {
    match state.load_trace(&id) {
        Some((run, spans, events)) => Ok(Json(
            json!({ "run": run, "spans": spans, "events": events }),
        )),
        None => Err(StatusCode::NOT_FOUND),
    }
}

pub async fn cancel(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Json<Value> {
    let cancelled = state.cancel(&id).await.unwrap_or(false);
    Json(json!({ "cancelled": cancelled }))
}
```

`gateway/src/api/ws.rs` — swap state extractor and read `(pid, run_id)`:

```rust
//! WS /api/projects/:pid/runs/:id/events — replay snapshot, then stream live
//! WsMessages; close when the run reaches a terminal status.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Path;
use axum::response::IntoResponse;
use futures::StreamExt;

use crate::api::scope::Scoped;
use crate::state::AppState;
use crate::trace::{RunStatus, WsMessage};

pub async fn ws_handler(
    Scoped(state): Scoped,
    Path((_pid, run_id)): Path<(String, String)>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle(socket, state, run_id))
}

async fn handle(mut socket: WebSocket, state: AppState, run_id: String) {
    let mut rx = state.subscribe(&run_id).await;

    if let Some((run, spans, events)) = state.load_trace(&run_id) {
        let terminal = run.status != RunStatus::Running;
        let snap = WsMessage::Snapshot { run, spans, events };
        if send(&mut socket, &snap).await.is_err() {
            return;
        }
        if terminal {
            let _ = socket.close().await;
            return;
        }
    }

    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(m) => {
                    let terminal = matches!(&m,
                        WsMessage::RunUpdate { run } if run.status != RunStatus::Running);
                    if send(&mut socket, &m).await.is_err() { break; }
                    if terminal { let _ = socket.close().await; break; }
                }
                Err(_) => break,
            },
            client = socket.next() => match client {
                Some(Ok(Message::Close(_))) | None => break,
                _ => {}
            }
        }
    }
}

async fn send(socket: &mut WebSocket, m: &WsMessage) -> Result<(), axum::Error> {
    let txt = serde_json::to_string(m).unwrap();
    socket.send(Message::Text(txt)).await
}
```

- [ ] **Step 5: Add `reqwest` dev-dependency**

In `gateway/Cargo.toml` under `[dev-dependencies]`, add:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

- [ ] **Step 6: Write the router-level integration test**

Create `gateway/tests/projects_api.rs`:

```rust
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

fn make_project(name: &str) -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("tau.toml"),
        format!("[project]\nname = \"{name}\"\n\n[agents.greeter]\ndisplay_name = \"Greeter\"\nllm_backend = \"anthropic\"\n"),
    )
    .unwrap();
    d
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn global_list_and_scoped_404() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    reg.add_local(proj.path()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // global list returns the project with a summary
    let items: serde_json::Value = http
        .get(format!("{base}/api/projects"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["meta"]["id"], "demo");
    assert!(items[0]["summary"]["agents"].as_u64().unwrap() >= 1);

    // scoped route on a known project works
    let cfg = http
        .get(format!("{base}/api/projects/demo/project/config"))
        .send()
        .await
        .unwrap();
    assert!(cfg.status().is_success());

    // scoped route on an unknown project is 404
    let missing = http
        .get(format!("{base}/api/projects/nope/project/config"))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn add_and_remove_over_http() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("demo");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let created = http
        .post(format!("{base}/api/projects"))
        .json(&serde_json::json!({ "path": proj.path().to_string_lossy() }))
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), reqwest::StatusCode::CREATED);
    let meta: serde_json::Value = created.json().await.unwrap();
    assert_eq!(meta["id"], "demo");

    let del = http
        .delete(format!("{base}/api/projects/demo"))
        .send()
        .await
        .unwrap();
    assert_eq!(del.status(), reqwest::StatusCode::NO_CONTENT);
}
```

- [ ] **Step 7: Build and run all gateway tests**

Run: `cargo build -p tau-gateway && cargo test -p tau-gateway --test projects_api --test projects_registry`
Expected: PASS. Then run the existing suites that still use the OLD `api::router`/`AppState` signature — they live in `tests/ws_e2e.rs`, `tests/run_orchestration.rs`, `tests/acceptance.rs`, `tests/workflow_run.rs`, `tests/serve_client_e2e.rs`. The ones that call `api::router(state)` with a single `AppState` (e.g. `ws_e2e.rs`) **will not compile** against the new signature and must be updated in Task 9's step. Run `cargo test -p tau-gateway` after Task 9.

- [ ] **Step 8: Commit (Tasks 7 + 8 together)**

```bash
git add gateway/src/api/ gateway/Cargo.toml gateway/tests/projects_api.rs
git commit -m "feat(gateway): scope routes under /api/projects/:pid + global project endpoints"
```

---

## Task 9: Wire `main.rs` + fix existing router-based tests

**Files:**
- Modify: `gateway/src/main.rs`
- Modify: `gateway/tests/ws_e2e.rs` (and any other test calling `api::router`)

- [ ] **Step 1: Rewrite `main.rs` to build a registry**

Replace `gateway/src/main.rs` with:

```rust
use std::path::PathBuf;

use tau_gateway::{api, projects::ProjectRegistry};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let args: Vec<String> = std::env::args().collect();
    let project = flag(&args, "--project").map(PathBuf::from);
    let bin = flag(&args, "--tau-bin")
        .map(PathBuf::from)
        .or_else(|| std::env::var("TAU_BIN").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("tau"));
    let no_sandbox = args.iter().any(|a| a == "--no-sandbox");
    let port: u16 = flag(&args, "--port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(4317);

    let data_root = data_root();
    let reg = ProjectRegistry::load(bin, no_sandbox, data_root).await?;

    // Auto-register the --project path (or the cwd if none given) so the existing
    // single-project launch still lands on a usable project.
    let initial = project.unwrap_or_else(|| std::env::current_dir().unwrap());
    if let Err(e) = reg.add_local(&initial).await {
        tracing::warn!("could not auto-register {}: {e}", initial.display());
    }

    let app = api::router(reg);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("tau-gateway listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn data_root() -> PathBuf {
    match std::env::var("HOME") {
        Ok(home) => PathBuf::from(home).join(".tau-web-ui"),
        Err(_) => {
            tracing::warn!("$HOME unset; storing data under ./.tau-web-ui (relative to cwd)");
            PathBuf::from(".tau-web-ui")
        }
    }
}
```

- [ ] **Step 2: Fix `ws_e2e.rs` to use the registry router + scoped URL**

Replace the top of `gateway/tests/ws_e2e.rs` (imports + the `ws_streams_live_then_closes` test) so it builds a `ProjectRegistry`, registers a project, and connects to the scoped WS path. Replace the `state`/`app` setup and URL:

```rust
use futures_util::StreamExt;
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};
use tokio_tungstenite::tungstenite::Message;

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}
fn project() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

#[tokio::test]
async fn ws_streams_live_then_closes() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let state = reg.state(&meta.id).await.unwrap();
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let run_id = state.launch("greeter".into(), "hi".into()).await.unwrap();
    let url = format!("ws://{addr}/api/projects/{}/runs/{run_id}/events", meta.id);
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();

    let mut saw_snapshot = false;
    let mut saw_terminal = false;
    while let Some(Ok(msg)) = ws.next().await {
        if let Message::Text(ref t) = msg {
            if t.contains("\"type\":\"snapshot\"") {
                saw_snapshot = true;
            }
            if t.contains("\"status\":\"completed\"") {
                saw_terminal = true;
            }
        }
        if let Message::Close(_) = msg {
            break;
        }
    }
    assert!(saw_snapshot, "expected a snapshot message");
    assert!(saw_terminal, "expected a terminal run update");
}
```

- [ ] **Step 3: Confirm no other test calls `api::router`**

Run: `grep -rn "api::router" gateway/tests`
Expected: only `ws_e2e.rs` and `projects_api.rs`. If any other file calls it, apply the same registry-based fix (the `tests/acceptance.rs`, `run_orchestration.rs`, `workflow_run.rs`, `serve_client_e2e.rs` files use `AppState` directly and do **not** call `api::router`, so they are unaffected by the router change).

- [ ] **Step 4: Run the full gateway suite**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/main.rs gateway/tests/ws_e2e.rs
git commit -m "feat(gateway): registry-backed main + scoped WS e2e"
```

---

## Task 10: ts-rs export + drift gate

**Files:**
- Regenerated: `web/src/types/*.ts`

- [ ] **Step 1: Regenerate the TS bindings**

The new `#[ts(export)]` types (`ProjectSource`, `ProjectMeta`, `ProjectSummary`, `ProjectListItem`, `CrossProjectRun`) are emitted during `cargo test`. Run:

Run: `cargo test -p tau-gateway`
Expected: PASS, and new files appear under `web/src/types/` (one per type, per the existing `TS_RS_EXPORT_DIR` config).

- [ ] **Step 2: Verify the drift gate is satisfied**

Run: `git status --porcelain web/src/types`
Expected: the new `ProjectSource.ts`, `ProjectMeta.ts`, `ProjectSummary.ts`, `ProjectListItem.ts`, `CrossProjectRun.ts` files are listed as added. (CI's rust job fails if these are uncommitted, so they must be committed.)

- [ ] **Step 3: Commit the generated types**

```bash
git add web/src/types
git commit -m "chore(gateway): export multi-project TS bindings"
```

- [ ] **Step 4: Full workspace check (mirror CI rust job)**

Run: `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway`
Expected: all green. Fix any `fmt`/`clippy` findings inline (e.g. `clippy::large_enum_variant` is not expected here; `ProjectSource::Git { url }` is small).

- [ ] **Step 5: Commit any fmt/clippy fixes**

```bash
git add -A
git commit -m "chore(gateway): fmt + clippy for multi-project"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-multi-project-design.md`):
- §3.1 types → Task 1, 5, 6. §3.2 slug/dedupe → Task 1, 3. §3.3 per-project store → Task 3 (`insert_entry` store dir). §3.4 persistence + `--project` auto-register → Task 3, 9. §3.5 path-prefix scoping + 404 → Task 7, 8. §4.1 `GET /api/projects` → Task 5, 8. §4.2 cross-runs → Task 6, 8. §4.3 add path/git → Task 3, 4, 8. §4.4 delete (non-destructive) → Task 4, 8. §6 gateway tests → Tasks 3–8. §7 ts-rs/CI → Task 10. All covered.

**Placeholder scan:** none — every code step is complete and copy-pasteable.

**Type consistency:** `ProjectRegistry::{load, add_local, add_git, remove, state, metas, list_summaries, cross_runs}` are used consistently across handlers (Task 8) and `main.rs` (Task 9). `Scoped(AppState)` signature matches every refactored handler. `ProjectListItem{meta,summary}` / `ProjectSummary` fields match the test assertions and the frontend contract Plan 2 will consume. `CrossProjectRun{project_id,project_name,run}` matches Task 6 + the API test.

**Note for executor:** `fake-tau-serve` must be built before the gateway integration tests (`cargo build -p fake-tau-serve`). Engine-backed summary/cross-runs tests drive real mock runs, so allow the 25ms poll loops to settle.
