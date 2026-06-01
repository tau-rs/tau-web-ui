# Transparent Workspace — Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-present, auto-provisioned "workspace" project (reserved id `workspace`, `source: Workspace`) and a `save-as` operation that copies the workspace's authoring files to a chosen directory, registers it as a normal project, and resets the workspace.

**Architecture:** Extend `ProjectSource` with a `Workspace` variant; `ProjectRegistry::ensure_workspace()` runs first in `load()` and registers the workspace in-memory; `remove()` refuses it; `save_workspace_as(target)` recursively copies the workspace project dir, `add_local`s the copy, and resets the workspace (blank tau.toml + cleared runs). One global `POST /api/workspace/save-as` route.

**Tech Stack:** Rust, axum 0.7, serde, ts-rs, std::fs (recursive copy helper, no new dep), reqwest (dev).

This is **Plan 1 of 2** for the transparent workspace + nav shell (see `docs/superpowers/specs/2026-06-01-workspace-and-nav-shell-design.md`). Plan 2 (frontend) builds on this API.

---

## File Structure

**Modified:**
- `gateway/src/projects/mod.rs` — `Workspace` variant; `WORKSPACE_ID` const; `ensure_workspace`; `remove` guard; `save_workspace_as` + `reset_workspace` + `copy_dir_recursive` helper.
- `gateway/src/api/projects.rs` — `save_as` handler.
- `gateway/src/api/mod.rs` — `/api/workspace/save-as` route.
- `gateway/tests/projects_api.rs` — update the project-count assertion (workspace is now always present).

**New test file:**
- `gateway/tests/workspace.rs` — registry-level: ensure_workspace, remove guard, save_workspace_as.

---

## Task 1: `Workspace` source variant + `ensure_workspace`

**Files:**
- Modify: `gateway/src/projects/mod.rs`
- Modify: `gateway/tests/projects_api.rs`
- Test: `gateway/tests/workspace.rs`

- [ ] **Step 1: Add the variant + `WORKSPACE_ID` + `ensure_workspace`**

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

Add a module-level const near the top (after the `use` lines):

```rust
/// Reserved id of the always-present, auto-provisioned working environment.
pub const WORKSPACE_ID: &str = "workspace";
```

Add the method inside `impl ProjectRegistry` (place it just above `add_local`):

```rust
    /// Ensure the built-in workspace project exists on disk and is registered
    /// in-memory under the reserved id. Deterministic + re-ensured each start, so
    /// it is never written to `projects.json`.
    pub async fn ensure_workspace(&self) -> Result<()> {
        if self.0.projects.read().await.contains_key(WORKSPACE_ID) {
            return Ok(());
        }
        let dir = self.0.data_root.join("workspace");
        std::fs::create_dir_all(&dir).ok();
        let toml = dir.join("tau.toml");
        if !toml.exists() {
            std::fs::write(&toml, "[project]\nname = \"workspace\"\n")?;
        }
        let abs = std::fs::canonicalize(&dir).unwrap_or(dir);
        let meta = ProjectMeta {
            id: WORKSPACE_ID.to_string(),
            name: "workspace".to_string(),
            path: abs.to_string_lossy().to_string(),
            source: ProjectSource::Workspace,
        };
        self.insert_entry(meta).await
    }
```

- [ ] **Step 2: Call `ensure_workspace` first in `load`**

In `ProjectRegistry::load`, after building `reg` and **before** the manifest loop, add the ensure call:

```rust
        let reg = ProjectRegistry(Arc::new(Inner {
            projects: RwLock::new(IndexMap::new()),
            bin,
            no_sandbox,
            data_root,
            is_mock,
        }));
        reg.ensure_workspace().await?;
        for meta in reg.read_manifest()? {
            reg.insert_entry(meta).await?;
        }
        Ok(reg)
```

- [ ] **Step 3: Write the failing test**

Create `gateway/tests/workspace.rs`:

```rust
use std::path::PathBuf;
use tau_gateway::projects::{ProjectRegistry, ProjectSource, WORKSPACE_ID};

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
        format!("[project]\nname = \"{name}\"\n"),
    )
    .unwrap();
    d
}

#[tokio::test]
async fn workspace_is_auto_provisioned() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    // registered with the reserved id + Workspace source
    let metas = reg.metas().await;
    let ws = metas.iter().find(|m| m.id == WORKSPACE_ID).unwrap();
    assert_eq!(ws.source, ProjectSource::Workspace);
    assert!(reg.state(WORKSPACE_ID).await.is_some());
    // a real tau.toml exists on disk
    assert!(data.path().join("workspace/tau.toml").exists());
}

#[tokio::test]
async fn user_project_named_workspace_dedupes() {
    let data = tempfile::tempdir().unwrap();
    let proj = make_project("workspace");
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(proj.path()).await.unwrap();
    assert_eq!(meta.id, "workspace-2"); // reserved id is taken by the built-in
}
```

- [ ] **Step 4: Update the project-count assertion in `projects_api.rs`**

In `gateway/tests/projects_api.rs`, the `global_list_and_scoped_404` test asserts exactly one project. The workspace is now always present, so change the count assertion to ignore the workspace. Replace:

```rust
    assert_eq!(items.as_array().unwrap().len(), 1);
    assert_eq!(items[0]["meta"]["id"], "demo");
    assert!(items[0]["summary"]["agents"].as_u64().unwrap() >= 1);
```
with:
```rust
    let arr = items.as_array().unwrap();
    // workspace is always present; assert the demo project is there alongside it.
    let demo = arr
        .iter()
        .find(|p| p["meta"]["id"] == "demo")
        .expect("demo project present");
    assert!(demo["summary"]["agents"].as_u64().unwrap() >= 1);
    assert!(arr.iter().any(|p| p["meta"]["source"]["kind"] == "workspace"));
```

- [ ] **Step 5: Run tests**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test workspace --test projects_api`
Expected: PASS (workspace: 2, projects_api: 2).

- [ ] **Step 6: Commit**

```bash
git add gateway/src/projects/mod.rs gateway/tests/workspace.rs gateway/tests/projects_api.rs
git commit -m "feat(gateway): auto-provisioned workspace project (reserved id)"
```

---

## Task 2: `remove` guard

**Files:**
- Modify: `gateway/src/projects/mod.rs`
- Test: `gateway/tests/workspace.rs`

- [ ] **Step 1: Guard `remove`**

In `gateway/src/projects/mod.rs`, update `remove` to refuse the workspace:

```rust
    /// Unregister a project (non-destructive). The built-in workspace cannot be removed.
    pub async fn remove(&self, id: &str) -> Result<bool> {
        if id == WORKSPACE_ID {
            bail!("the workspace cannot be removed");
        }
        let removed = self.0.projects.write().await.shift_remove(id).is_some();
        if removed {
            self.write_manifest().await?;
        }
        Ok(removed)
    }
```

- [ ] **Step 2: Write the failing test**

Append to `gateway/tests/workspace.rs`:

```rust
#[tokio::test]
async fn workspace_cannot_be_removed() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    assert!(reg.remove(WORKSPACE_ID).await.is_err());
    assert!(reg.state(WORKSPACE_ID).await.is_some()); // still registered
}
```

- [ ] **Step 3: Run**

Run: `cargo test -p tau-gateway --test workspace`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add gateway/src/projects/mod.rs gateway/tests/workspace.rs
git commit -m "feat(gateway): protect the workspace from removal"
```

---

## Task 3: `save_workspace_as` (copy + register + reset)

**Files:**
- Modify: `gateway/src/projects/mod.rs`
- Test: `gateway/tests/workspace.rs`

- [ ] **Step 1: Add the recursive-copy helper + `save_workspace_as` + `reset_workspace`**

Add a module-level helper at the bottom of `gateway/src/projects/mod.rs`:

```rust
/// Recursively copy the contents of `src` into `dst` (files + subdirs).
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
```

Add the methods inside `impl ProjectRegistry`:

```rust
    /// Promote the workspace to a real project at `target`: copy its authoring
    /// files there, register it, then reset the workspace to a clean slate.
    pub async fn save_workspace_as(&self, target: &Path) -> Result<ProjectMeta> {
        let ws_path = {
            let map = self.0.projects.read().await;
            let e = map.get(WORKSPACE_ID).context("no workspace registered")?;
            PathBuf::from(&e.meta.path)
        };
        if target.join("tau.toml").exists() {
            bail!(
                "target already contains a tau.toml: {}",
                target.display()
            );
        }
        std::fs::create_dir_all(target)
            .with_context(|| format!("create {}", target.display()))?;
        copy_dir_recursive(&ws_path, target)?;
        let meta = self.add_local(target).await?;
        self.reset_workspace(&ws_path).await?;
        Ok(meta)
    }

    /// Blank the workspace's authoring files and clear its run store + in-memory runs.
    async fn reset_workspace(&self, ws_path: &Path) -> Result<()> {
        std::fs::write(ws_path.join("tau.toml"), "[project]\nname = \"workspace\"\n")?;
        for sub in ["agents", "workflows"] {
            let p = ws_path.join(sub);
            if p.exists() {
                std::fs::remove_dir_all(&p).ok();
            }
        }
        let runs_dir = self
            .0
            .data_root
            .join("projects")
            .join(WORKSPACE_ID)
            .join("runs");
        if runs_dir.exists() {
            std::fs::remove_dir_all(&runs_dir).ok();
        }
        std::fs::create_dir_all(&runs_dir).ok();
        // Rebuild the workspace entry so the in-memory run list is cleared too.
        let meta = ProjectMeta {
            id: WORKSPACE_ID.to_string(),
            name: "workspace".to_string(),
            path: ws_path.to_string_lossy().to_string(),
            source: ProjectSource::Workspace,
        };
        self.insert_entry(meta).await
    }
```

- [ ] **Step 2: Write the failing test**

Append to `gateway/tests/workspace.rs`:

```rust
#[tokio::test]
async fn save_workspace_as_copies_registers_and_resets() {
    use tau_gateway::config::{AgentDetail, AgentPrompt};
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();

    // author an agent in the workspace
    let ws = reg.state(WORKSPACE_ID).await.unwrap();
    ws.write_agent(&AgentDetail {
        id: "scratchy".into(),
        display_name: Some("Scratchy".into()),
        package: None,
        llm_backend: Some("anthropic".into()),
        prompt: AgentPrompt::default(),
        requires_tools: vec![],
    })
    .unwrap();

    // save-as into a fresh target dir
    let target = data.path().join("saved-proj");
    let meta = reg.save_workspace_as(&target).await.unwrap();

    // the new project is registered and carries the agent
    assert!(reg.state(&meta.id).await.is_some());
    let saved = reg.state(&meta.id).await.unwrap();
    assert!(saved.read_agent("scratchy").unwrap().is_some());

    // the workspace was reset (agent gone)
    let ws2 = reg.state(WORKSPACE_ID).await.unwrap();
    assert!(ws2.read_agent("scratchy").unwrap().is_none());

    // saving onto an occupied dir fails
    assert!(reg.save_workspace_as(&target).await.is_err());
}
```

- [ ] **Step 3: Run**

Run: `cargo test -p tau-gateway --test workspace`
Expected: PASS (4 tests). (`AgentState::write_agent`/`read_agent` exist from the agents-authoring work.)

- [ ] **Step 4: Commit**

```bash
git add gateway/src/projects/mod.rs gateway/tests/workspace.rs
git commit -m "feat(gateway): save_workspace_as (copy authoring files, register, reset)"
```

---

## Task 4: `save-as` API route

**Files:**
- Modify: `gateway/src/api/projects.rs`, `gateway/src/api/mod.rs`

- [ ] **Step 1: Add the handler**

In `gateway/src/api/projects.rs`, add (the file already imports `State`, `StatusCode`, `Json`, `Deserialize`, `ProjectMeta`, `ProjectRegistry`):

```rust
#[derive(Deserialize)]
pub struct SaveAsBody {
    pub path: String,
}

pub async fn save_as(
    State(reg): State<ProjectRegistry>,
    Json(b): Json<SaveAsBody>,
) -> Result<(StatusCode, Json<ProjectMeta>), (StatusCode, String)> {
    reg.save_workspace_as(std::path::Path::new(&b.path))
        .await
        .map(|m| (StatusCode::CREATED, Json(m)))
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}
```

- [ ] **Step 2: Wire the route**

In `gateway/src/api/mod.rs`, add the global route alongside the other `/api/projects…` globals (before `.nest(...)`):

```rust
        .route("/api/workspace/save-as", post(projects::save_as))
```

- [ ] **Step 3: Build**

Run: `cargo build -p tau-gateway`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add gateway/src/api/projects.rs gateway/src/api/mod.rs
git commit -m "feat(gateway): POST /api/workspace/save-as"
```

---

## Task 5: API integration test

**Files:**
- Modify: `gateway/tests/workspace.rs`

- [ ] **Step 1: Add a router-level test**

Append to `gateway/tests/workspace.rs` (add imports `use tau_gateway::api;` at the top if not present):

```rust
async fn serve(reg: ProjectRegistry) -> String {
    let app = tau_gateway::api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn save_as_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let target = data.path().join("http-saved");
    let created = http
        .post(format!("{base}/api/workspace/save-as"))
        .json(&serde_json::json!({ "path": target.to_string_lossy() }))
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), reqwest::StatusCode::CREATED);
    let meta: serde_json::Value = created.json().await.unwrap();
    assert_eq!(meta["source"]["kind"], "local");

    // second save onto the same dir → 400
    let dup = http
        .post(format!("{base}/api/workspace/save-as"))
        .json(&serde_json::json!({ "path": target.to_string_lossy() }))
        .send()
        .await
        .unwrap();
    assert_eq!(dup.status(), reqwest::StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 2: Run**

Run: `cargo test -p tau-gateway --test workspace`
Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add gateway/tests/workspace.rs
git commit -m "test(gateway): workspace save-as over HTTP"
```

---

## Task 6: ts-rs export + full rust gate

**Files:**
- Regenerated: `web/src/types/ProjectSource.ts`

- [ ] **Step 1: Regenerate bindings**

Run: `cargo test -p tau-gateway`
Expected: PASS; `web/src/types/ProjectSource.ts` updates to include the `{ "kind": "workspace" }` variant.

- [ ] **Step 2: Verify the variant**

Run: `cat web/src/types/ProjectSource.ts`
Expected: a union including `{ "kind": "workspace" }`.

- [ ] **Step 3: Full rust gate (mirror CI)**

Run: `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway`
Expected: all green. Fix any fmt/clippy minimally (`cargo fmt --all`).

- [ ] **Step 4: Commit**

```bash
git add web/src/types gateway/
git commit -m "chore(gateway): export Workspace ProjectSource variant + fmt/clippy"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-01-workspace-and-nav-shell-design.md`):
- §3.1 `Workspace` variant → Task 1. §3.2 `ensure_workspace` (first in load, in-memory, dedupe) → Task 1. §3.3 remove guard → Task 2. §3.4 `save_workspace_as` (validate occupied target, recursive copy authoring files, add_local, reset blank+clear runs) → Task 3. §3.5 API `POST /api/workspace/save-as` → Tasks 4-5. §6 ts-rs/CI → Task 6. The workspace-always-present consequence on `list_summaries` is handled by updating the `projects_api` count assertion (Task 1 Step 4). All covered.

**Placeholder scan:** none — every step has complete code.

**Type consistency:** `WORKSPACE_ID` const, `ProjectSource::Workspace`, `ensure_workspace`/`save_workspace_as`/`reset_workspace`/`copy_dir_recursive` signatures are consistent across the module, the API handler, and the tests. `save_workspace_as(&Path) -> Result<ProjectMeta>` matches the `save_as` handler and the integration test. The agent helper calls (`write_agent`/`read_agent` on `AppState`) match the agents-authoring API already in the codebase. `ProjectMeta`/`ProjectSource` serde shape (`source.kind == "workspace"|"local"`) matches the frontend contract Plan 2 consumes.

**Note for executor:** `fake-tau-serve` must be built before the registry integration tests. Every `ProjectRegistry::load` now provisions a workspace under its `data_root` (a tempdir in tests), so tests are isolated.
