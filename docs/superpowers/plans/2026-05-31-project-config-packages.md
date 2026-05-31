# Project Config + Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Config and Packages surfaces — edit `tau.toml` `[project]`, import community agents (install package + register `[agents.<id>]`), and do full mock-backed package management — with a real-tau `cli-json` seam.

**Architecture:** A `ConfigStore` does real `tau.toml` read/write via `toml_edit` (preserving the file). A `PackageOps` trait (`MockOps` in-memory + `CliOps` seam) handles packages. `AppState` exposes config + package + `import_agent` methods over new REST endpoints. Two React pages (ConfigPage, PackagesPage) replace their stubs.

**Tech Stack:** Rust (toml, toml_edit, axum, ts-rs), React 18 + Tailwind + react-router, Vitest, Playwright.

**Source spec:** `docs/superpowers/specs/2026-05-31-project-config-packages-design.md` (+ §4b import addendum). Branch `impl/config-packages`. CI gate: rust (fmt/clippy/test + ts-rs drift) + web + e2e. End commits with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File structure
```
gateway/Cargo.toml                 # + toml, toml_edit
gateway/src/config/mod.rs          # ConfigStore + ProjectConfig/AgentInfo (ts-rs)
gateway/src/packages/mod.rs        # PackageOps + MockOps + CliOps + Package/VerifyResult (ts-rs) + name_from_url
gateway/src/lib.rs                 # + pub mod config; pub mod packages;
gateway/src/state.rs               # package_ops on Inner; config_*, package_*, import_agent
gateway/src/api/{config,packages,agents}.rs  # endpoints
gateway/src/api/mod.rs             # routes
web/src/api/config.ts              # client
web/src/config/ConfigPage.tsx(+test)
web/src/packages/PackagesPage.tsx(+test)
web/src/App.tsx                    # routes
web/src/types/*                    # generated
web/e2e/run.spec.ts                # config/packages case
```

---

### Task 1: Gateway — ConfigStore (tau.toml read/write/add-agent)

**Files:** `gateway/Cargo.toml`, create `gateway/src/config/mod.rs`, modify `gateway/src/lib.rs`

- [ ] **Step 1: Deps** — in `gateway/Cargo.toml` `[dependencies]` add:
```toml
toml = "0.8"
toml_edit = "0.22"
```

- [ ] **Step 2: Register module** — in `gateway/src/lib.rs` add `pub mod config;` with the other `pub mod` lines.

- [ ] **Step 3: Implement** `gateway/src/config/mod.rs`:
```rust
//! ConfigStore: real read/write of the project's `tau.toml`.
//! Reads the `[project]` + `[agents.*]` overview; writes `[project]` name/description
//! and new `[agents.<id>]` tables via toml_edit (preserving the rest of the file).

use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentInfo {
    pub id: String,
    pub llm_backend: Option<String>,
    pub package: Option<String>,
    pub source: String, // "local" or a git repo, derived from the package ref
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectConfig {
    pub name: String,
    pub description: Option<String>,
    pub agents: Vec<AgentInfo>,
}

fn source_of(package: Option<&str>) -> String {
    match package {
        Some(p) if p.contains('/') || p.contains("github") => {
            p.split('@').next().unwrap_or(p).to_string()
        }
        _ => "local".to_string(),
    }
}

pub fn read(project: &Path) -> Result<ProjectConfig> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).with_context(|| format!("read {path:?}"))?;
    let doc: toml::Value = toml::from_str(&text).context("parse tau.toml")?;
    let name = doc
        .get("project")
        .and_then(|p| p.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let description = doc
        .get("project")
        .and_then(|p| p.get("description"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let mut agents = vec![];
    if let Some(tbl) = doc.get("agents").and_then(|a| a.as_table()) {
        for (id, v) in tbl {
            let llm_backend = v.get("llm_backend").and_then(|x| x.as_str()).map(String::from);
            let package = v.get("package").and_then(|x| x.as_str()).map(String::from);
            let source = source_of(package.as_deref());
            agents.push(AgentInfo { id: id.clone(), llm_backend, package, source });
        }
        agents.sort_by(|a, b| a.id.cmp(&b.id));
    }
    Ok(ProjectConfig { name, description, agents })
}

pub fn write_project(project: &Path, name: &str, description: Option<&str>) -> Result<()> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml_edit::DocumentMut = text.parse().context("parse tau.toml")?;
    doc["project"]["name"] = toml_edit::value(name);
    match description {
        Some(d) => doc["project"]["description"] = toml_edit::value(d),
        None => {
            if let Some(t) = doc["project"].as_table_mut() {
                t.remove("description");
            }
        }
    }
    std::fs::write(&path, doc.to_string()).with_context(|| format!("write {path:?}"))?;
    Ok(())
}

pub fn add_agent(
    project: &Path,
    id: &str,
    display_name: &str,
    package: &str,
    llm_backend: &str,
) -> Result<()> {
    let path = project.join("tau.toml");
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let mut doc: toml_edit::DocumentMut = text.parse().context("parse tau.toml")?;
    doc["agents"][id]["display_name"] = toml_edit::value(display_name);
    doc["agents"][id]["package"] = toml_edit::value(package);
    doc["agents"][id]["llm_backend"] = toml_edit::value(llm_backend);
    std::fs::write(&path, doc.to_string()).with_context(|| format!("write {path:?}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_fixture(dir: &Path) {
        std::fs::write(
            dir.join("tau.toml"),
            r#"[project]
name = "demo"
description = "old"

[agents.greeter]
display_name = "Greeter"
package = "greeter@^0.1"
llm_backend = "anthropic"
"#,
        )
        .unwrap();
    }

    #[test]
    fn reads_project_and_agents() {
        let d = tempfile::tempdir().unwrap();
        write_fixture(d.path());
        let c = read(d.path()).unwrap();
        assert_eq!(c.name, "demo");
        assert_eq!(c.agents.len(), 1);
        assert_eq!(c.agents[0].id, "greeter");
        assert_eq!(c.agents[0].llm_backend.as_deref(), Some("anthropic"));
    }

    #[test]
    fn writes_project_preserving_agents() {
        let d = tempfile::tempdir().unwrap();
        write_fixture(d.path());
        write_project(d.path(), "renamed", Some("new desc")).unwrap();
        let c = read(d.path()).unwrap();
        assert_eq!(c.name, "renamed");
        assert_eq!(c.description.as_deref(), Some("new desc"));
        assert_eq!(c.agents.len(), 1); // agents table preserved
    }

    #[test]
    fn add_agent_registers_a_runnable_agent() {
        let d = tempfile::tempdir().unwrap();
        write_fixture(d.path());
        add_agent(d.path(), "researcher-pro", "researcher-pro", "researcher-pro@^1.0", "anthropic").unwrap();
        let c = read(d.path()).unwrap();
        let a = c.agents.iter().find(|a| a.id == "researcher-pro").unwrap();
        assert_eq!(a.package.as_deref(), Some("researcher-pro@^1.0"));
        assert_eq!(a.llm_backend.as_deref(), Some("anthropic"));
    }
}
```

- [ ] **Step 4: Verify + commit** — `cargo test -p tau-gateway config::` → 3 pass; `cargo build && cargo fmt --all && cargo clippy --all-targets -- -D warnings` clean. The ts-rs export writes `web/src/types/{ProjectConfig,AgentInfo}.ts`.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/Cargo.toml gateway/Cargo.lock gateway/src/config/mod.rs gateway/src/lib.rs web/src/types
git commit -m "feat(gateway): ConfigStore — tau.toml read/write/add-agent"
```

---

### Task 2: Gateway — PackageOps (mock + cli seam)

**Files:** create `gateway/src/packages/mod.rs`, modify `gateway/src/lib.rs`

- [ ] **Step 1: Register module** — in `gateway/src/lib.rs` add `pub mod packages;`.

- [ ] **Step 2: Implement** `gateway/src/packages/mod.rs`:
```rust
//! PackageOps: mock-first package management. `MockOps` keeps an in-memory list and
//! mutates it; `CliOps` is the seam for real `tau install/list/verify --json`.

use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Package {
    pub name: String,
    pub version: String,
    pub source: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerifyResult {
    pub name: String,
    pub status: String,
}

/// Derive a package/agent id from a git URL: last path segment minus `.git`.
pub fn name_from_url(git_url: &str) -> String {
    git_url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("package")
        .trim_end_matches(".git")
        .to_string()
}

fn source_from_url(git_url: &str) -> String {
    git_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches(".git")
        .to_string()
}

pub trait PackageOps: Send + Sync {
    fn list(&self) -> Vec<Package>;
    fn install(&self, git_url: &str) -> Result<Package>;
    fn uninstall(&self, name: &str) -> Result<()>;
    fn update(&self, name: &str, to: Option<String>) -> Result<Package>;
    fn resolve(&self) -> Result<Vec<Package>>;
    fn verify(&self) -> Vec<VerifyResult>;
}

pub struct MockOps {
    pkgs: Mutex<Vec<Package>>,
}

impl MockOps {
    pub fn new() -> Self {
        let seed = |name: &str, version: &str| Package {
            name: name.into(),
            version: version.into(),
            source: format!("github.com/tau/{name}"),
            status: "ok".into(),
        };
        MockOps {
            pkgs: Mutex::new(vec![
                seed("anthropic", "0.1.0"),
                seed("fs-read", "1.0.0"),
                seed("shell", "0.2.0"),
            ]),
        }
    }
}

impl Default for MockOps {
    fn default() -> Self {
        Self::new()
    }
}

impl PackageOps for MockOps {
    fn list(&self) -> Vec<Package> {
        self.pkgs.lock().unwrap().clone()
    }
    fn install(&self, git_url: &str) -> Result<Package> {
        let name = name_from_url(git_url);
        let pkg = Package {
            name: name.clone(),
            version: "1.0.0".into(),
            source: source_from_url(git_url),
            status: "ok".into(),
        };
        let mut list = self.pkgs.lock().unwrap();
        if !list.iter().any(|p| p.name == name) {
            list.push(pkg.clone());
        }
        Ok(pkg)
    }
    fn uninstall(&self, name: &str) -> Result<()> {
        self.pkgs.lock().unwrap().retain(|p| p.name != name);
        Ok(())
    }
    fn update(&self, name: &str, to: Option<String>) -> Result<Package> {
        let mut list = self.pkgs.lock().unwrap();
        let p = list
            .iter_mut()
            .find(|p| p.name == name)
            .ok_or_else(|| anyhow!("no such package: {name}"))?;
        p.version = to.unwrap_or_else(|| "1.0.1".into());
        Ok(p.clone())
    }
    fn resolve(&self) -> Result<Vec<Package>> {
        Ok(self.list())
    }
    fn verify(&self) -> Vec<VerifyResult> {
        self.list()
            .into_iter()
            .map(|p| VerifyResult { name: p.name, status: "ok".into() })
            .collect()
    }
}

/// Seam: shell real `tau install/list/verify --json`. Not wired in v1 (mock covers
/// fake-tau-serve). list/verify return empty; mutations return a graceful error.
pub struct CliOps {
    #[allow(dead_code)]
    bin: PathBuf,
    #[allow(dead_code)]
    project: PathBuf,
}

impl CliOps {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        CliOps { bin, project }
    }
}

impl PackageOps for CliOps {
    fn list(&self) -> Vec<Package> {
        Vec::new()
    }
    fn install(&self, _git_url: &str) -> Result<Package> {
        Err(anyhow!("real-tau package install not wired yet (use the tau CLI)"))
    }
    fn uninstall(&self, _name: &str) -> Result<()> {
        Err(anyhow!("real-tau uninstall not wired yet"))
    }
    fn update(&self, _name: &str, _to: Option<String>) -> Result<Package> {
        Err(anyhow!("real-tau update not wired yet"))
    }
    fn resolve(&self) -> Result<Vec<Package>> {
        Ok(Vec::new())
    }
    fn verify(&self) -> Vec<VerifyResult> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_from_url_strips_git() {
        assert_eq!(name_from_url("https://github.com/acme/researcher-pro.git"), "researcher-pro");
    }

    #[test]
    fn mock_list_install_uninstall_verify() {
        let ops = MockOps::new();
        assert_eq!(ops.list().len(), 3);
        let p = ops.install("https://github.com/acme/cooltool.git").unwrap();
        assert_eq!(p.name, "cooltool");
        assert_eq!(ops.list().len(), 4);
        ops.uninstall("cooltool").unwrap();
        assert_eq!(ops.list().len(), 3);
        assert!(ops.verify().iter().all(|v| v.status == "ok"));
        let u = ops.update("anthropic", Some("0.2.0".into())).unwrap();
        assert_eq!(u.version, "0.2.0");
    }
}
```

- [ ] **Step 3: Verify + commit** — `cargo test -p tau-gateway packages::` → 2 pass; `cargo build && cargo fmt --all && cargo clippy --all-targets -- -D warnings` clean. ts-rs writes `web/src/types/{Package,VerifyResult}.ts`.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/packages/mod.rs gateway/src/lib.rs web/src/types
git commit -m "feat(gateway): PackageOps (MockOps + CliOps seam) + name_from_url"
```

---

### Task 3: Gateway — AppState config/package/import wiring

**Files:** modify `gateway/src/state.rs`; Test: `gateway/tests/config_packages.rs`

- [ ] **Step 1: Wire into AppState** — in `gateway/src/state.rs`:
a) imports:
```rust
use crate::config;
use crate::packages::{name_from_url, CliOps, MockOps, Package, PackageOps, VerifyResult};
```
b) `Inner` field (after `workflow_runner`): `package_ops: Box<dyn PackageOps>,`
c) in `AppState::new`, build it from the same `is_mock` check used for the workflow runner and include `package_ops` in `Inner { … }`:
```rust
        let package_ops: Box<dyn PackageOps> = if is_mock {
            Box::new(MockOps::new())
        } else {
            Box::new(CliOps::new(bin.clone(), project.clone()))
        };
```
(Add `package_ops,` to the `Inner { … }` literal next to `workflow_runner`.)
d) methods in `impl AppState`:
```rust
    pub fn config_read(&self) -> Result<config::ProjectConfig> {
        config::read(&self.0.project)
    }
    pub fn config_write(&self, name: &str, description: Option<&str>) -> Result<()> {
        config::write_project(&self.0.project, name, description)
    }
    pub fn packages(&self) -> Vec<Package> {
        self.0.package_ops.list()
    }
    pub fn package_install(&self, git_url: &str) -> Result<Package> {
        self.0.package_ops.install(git_url)
    }
    pub fn package_uninstall(&self, name: &str) -> Result<()> {
        self.0.package_ops.uninstall(name)
    }
    pub fn package_update(&self, name: &str, to: Option<String>) -> Result<Package> {
        self.0.package_ops.update(name, to)
    }
    pub fn package_resolve(&self) -> Result<Vec<Package>> {
        self.0.package_ops.resolve()
    }
    pub fn package_verify(&self) -> Vec<VerifyResult> {
        self.0.package_ops.verify()
    }

    /// Import a community agent: install its package, then register `[agents.<id>]`.
    pub fn import_agent(&self, git_url: &str, llm_backend: &str) -> Result<String> {
        let id = name_from_url(git_url);
        let pkg = self.0.package_ops.install(git_url)?;
        config::add_agent(
            &self.0.project,
            &id,
            &id,
            &format!("{}@^{}", pkg.name, pkg.version),
            llm_backend,
        )?;
        Ok(id)
    }
```

- [ ] **Step 2: Integration test** — create `gateway/tests/config_packages.rs`:
```rust
use std::path::PathBuf;
use tau_gateway::{state::AppState, store::RunStore};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}

fn temp_project() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("tau.toml"),
        "[project]\nname = \"demo\"\n\n[agents.greeter]\ndisplay_name = \"Greeter\"\npackage = \"greeter@^0.1\"\nllm_backend = \"anthropic\"\n",
    )
    .unwrap();
    d
}

#[tokio::test]
async fn config_read_write_roundtrip() {
    let proj = temp_project();
    let store = RunStore::new(tempfile::tempdir().unwrap().path()).unwrap();
    let state = AppState::new(bin(), proj.path().to_path_buf(), true, store);
    assert_eq!(state.config_read().unwrap().name, "demo");
    state.config_write("renamed", Some("d")).unwrap();
    assert_eq!(state.config_read().unwrap().name, "renamed");
}

#[tokio::test]
async fn packages_mock_crud() {
    let proj = temp_project();
    let store = RunStore::new(tempfile::tempdir().unwrap().path()).unwrap();
    let state = AppState::new(bin(), proj.path().to_path_buf(), true, store);
    assert_eq!(state.packages().len(), 3);
    state.package_install("https://github.com/acme/x.git").unwrap();
    assert_eq!(state.packages().len(), 4);
}

#[tokio::test]
async fn import_agent_installs_and_registers() {
    let proj = temp_project();
    let store = RunStore::new(tempfile::tempdir().unwrap().path()).unwrap();
    let state = AppState::new(bin(), proj.path().to_path_buf(), true, store);
    let id = state.import_agent("https://github.com/acme/researcher-pro.git", "anthropic").unwrap();
    assert_eq!(id, "researcher-pro");
    let cfg = state.config_read().unwrap();
    assert!(cfg.agents.iter().any(|a| a.id == "researcher-pro"));
}
```

- [ ] **Step 3: Verify + commit** — `cargo build && cargo test -p tau-gateway --test config_packages` → 3 pass; `cargo test -p tau-gateway` no regressions; fmt/clippy clean.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/state.rs gateway/tests/config_packages.rs
git commit -m "feat(gateway): AppState config/package ops + import_agent"
```

---

### Task 4: Gateway — config/packages/agents API

**Files:** create `gateway/src/api/config.rs`, `gateway/src/api/packages.rs`, `gateway/src/api/agents.rs`; modify `gateway/src/api/mod.rs`

- [ ] **Step 1: config.rs**
```rust
use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::config::ProjectConfig;
use crate::state::AppState;

pub async fn get(State(state): State<AppState>) -> Result<Json<ProjectConfig>, (StatusCode, String)> {
    state.config_read().map(Json).map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[derive(Deserialize)]
pub struct PutBody {
    pub name: String,
    pub description: Option<String>,
}

pub async fn put(State(state): State<AppState>, Json(b): Json<PutBody>) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .config_write(&b.name, b.description.as_deref())
        .map(|_| Json(json!({ "ok": true })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
```

- [ ] **Step 2: packages.rs**
```rust
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn list(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "packages": state.packages() }))
}

#[derive(Deserialize)]
pub struct InstallBody {
    pub git_url: String,
}

pub async fn install(State(state): State<AppState>, Json(b): Json<InstallBody>) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_install(&b.git_url)
        .map(|p| Json(json!({ "package": p })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn uninstall(State(state): State<AppState>, Path(name): Path<String>) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_uninstall(&name)
        .map(|_| Json(json!({ "ok": true })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[derive(Deserialize)]
pub struct UpdateBody {
    pub to: Option<String>,
}

pub async fn update(State(state): State<AppState>, Path(name): Path<String>, Json(b): Json<UpdateBody>) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_update(&name, b.to)
        .map(|p| Json(json!({ "package": p })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn resolve(State(state): State<AppState>) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .package_resolve()
        .map(|pkgs| Json(json!({ "packages": pkgs })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

pub async fn verify(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "results": state.package_verify() }))
}
```

- [ ] **Step 3: agents.rs**
```rust
use axum::{extract::State, http::StatusCode, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

#[derive(Deserialize)]
pub struct ImportBody {
    pub git_url: String,
    pub llm_backend: String,
}

pub async fn import(State(state): State<AppState>, Json(b): Json<ImportBody>) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .import_agent(&b.git_url, &b.llm_backend)
        .map(|id| Json(json!({ "agent_id": id })))
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}
```

- [ ] **Step 4: routes** — in `gateway/src/api/mod.rs` add `pub mod config; pub mod packages; pub mod agents;` and these routes in `router` (use `delete`/`put` — add them to the axum `routing` import: `use axum::routing::{delete, get, post, put};`):
```rust
        .route("/api/project/config", get(config::get).put(config::put))
        .route("/api/packages", get(packages::list))
        .route("/api/packages/install", post(packages::install))
        .route("/api/packages/resolve", post(packages::resolve))
        .route("/api/packages/verify", post(packages::verify))
        .route("/api/packages/:name", delete(packages::uninstall))
        .route("/api/packages/:name/update", post(packages::update))
        .route("/api/agents/import", post(agents::import))
```

- [ ] **Step 5: Smoke + commit**
```bash
cargo build
cp fixtures/demo/tau.toml /tmp/tau-cfg-backup.toml   # config writes are real; restore after
./target/debug/tau-gateway --project ./fixtures/demo --tau-bin ./target/debug/fake-tau-serve --no-sandbox --port 4322 &
GW=$!; sleep 1
echo "--- config ---"; curl -s localhost:4322/api/project/config | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['name'],[a['id'] for a in d['agents']])"
echo "--- packages ---"; curl -s localhost:4322/api/packages | python3 -c "import sys,json;print([p['name'] for p in json.load(sys.stdin)['packages']])"
echo "--- import ---"; curl -s -X POST localhost:4322/api/agents/import -H 'content-type: application/json' -d '{"git_url":"https://github.com/acme/researcher-pro.git","llm_backend":"anthropic"}'
kill $GW
cp /tmp/tau-cfg-backup.toml fixtures/demo/tau.toml   # restore the fixture
```
Expected: config shows `demo` + agents; packages lists anthropic/fs-read/shell; import returns `{"agent_id":"researcher-pro"}`. `cargo fmt --all && cargo clippy --all-targets -- -D warnings` clean. **Confirm `git status` shows `fixtures/demo/tau.toml` unchanged after restore.**
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/api/config.rs gateway/src/api/packages.rs gateway/src/api/agents.rs gateway/src/api/mod.rs
git commit -m "feat(gateway): config + packages + agent-import API"
```

---

### Task 5: Frontend — API client

**Files:** create `web/src/api/config.ts`

- [ ] **Step 1: Implement** `web/src/api/config.ts`:
```ts
import type { ProjectConfig } from "../types/ProjectConfig";
import type { Package } from "../types/Package";
import type { VerifyResult } from "../types/VerifyResult";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getConfig = () => fetch("/api/project/config").then(json<ProjectConfig>);

export const putConfig = (name: string, description: string) =>
  fetch("/api/project/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description: description || null }),
  }).then(json<{ ok: boolean }>);

export const getPackages = () =>
  fetch("/api/packages").then(json<{ packages: Package[] }>).then((r) => r.packages);

export const installPackage = (git_url: string) =>
  fetch("/api/packages/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  }).then(json<{ package: Package }>).then((r) => r.package);

export const uninstallPackage = (name: string) =>
  fetch(`/api/packages/${name}`, { method: "DELETE" }).then(json<{ ok: boolean }>);

export const updatePackage = (name: string, to?: string) =>
  fetch(`/api/packages/${name}/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: to ?? null }),
  }).then(json<{ package: Package }>).then((r) => r.package);

export const resolvePackages = () =>
  fetch("/api/packages/resolve", { method: "POST" }).then(json<{ packages: Package[] }>).then((r) => r.packages);

export const verifyPackages = () =>
  fetch("/api/packages/verify", { method: "POST" }).then(json<{ results: VerifyResult[] }>).then((r) => r.results);

export const importAgent = (git_url: string, llm_backend: string) =>
  fetch("/api/agents/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url, llm_backend }),
  }).then(json<{ agent_id: string }>).then((r) => r.agent_id);
```
Run `cd web && pnpm typecheck && pnpm lint && pnpm build` clean (the generated `ProjectConfig`/`Package`/`VerifyResult` types exist from Tasks 1–2). Commit:
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/api/config.ts
git commit -m "feat(web): config/packages/import API client"
```

---

### Task 6: Frontend — ConfigPage

**Files:** create `web/src/config/ConfigPage.tsx`, `web/src/config/ConfigPage.test.tsx`; modify `web/src/App.tsx`

- [ ] **Step 1: Failing test** `web/src/config/ConfigPage.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfigPage } from "./ConfigPage";

beforeEach(() => vi.restoreAllMocks());

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve({ ok: true, json: async () => handler(url, init), text: async () => "" }),
    ),
  );
}

describe("ConfigPage", () => {
  it("loads config, edits the name, and saves", async () => {
    const calls: { url: string; body?: string }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, body: init?.body as string });
      if (url.endsWith("/api/project/config") && (!init || init.method !== "PUT"))
        return { name: "demo", description: "d", agents: [{ id: "greeter", llm_backend: "anthropic", package: "greeter@^0.1", source: "local" }] };
      return { ok: true };
    });
    render(<ConfigPage />);
    await waitFor(() => expect(screen.getByDisplayValue("demo")).toBeInTheDocument());
    expect(screen.getByText("greeter")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("project name"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/api/project/config") && c.body?.includes("renamed"))).toBe(true),
    );
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement** `web/src/config/ConfigPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { ProjectConfig } from "../types/ProjectConfig";
import { getConfig, putConfig, importAgent } from "../api/config";

export function ConfigPage() {
  const [cfg, setCfg] = useState<ProjectConfig | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importBackend, setImportBackend] = useState("anthropic");

  const reload = () =>
    getConfig()
      .then((c) => {
        setCfg(c);
        setName(c.name);
        setDescription(c.description ?? "");
      })
      .catch(() => {});

  useEffect(() => {
    reload();
  }, []);

  const backends = Array.from(
    new Set((cfg?.agents ?? []).map((a) => a.llm_backend).filter(Boolean) as string[]),
  );
  if (!backends.includes("anthropic")) backends.push("anthropic");

  async function onSave() {
    await putConfig(name, description).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    reload();
  }

  async function onImport() {
    if (!importUrl.trim()) return;
    await importAgent(importUrl, importBackend).catch(() => {});
    setImportUrl("");
    reload();
  }

  const card = "rounded-lg border border-border bg-surface p-3";
  const label = "mb-1 block text-[10px] uppercase tracking-wide text-muted";
  const input = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Config &amp; Capabilities</h2>

      <div className={card}>
        <h3 className="mb-2 text-xs font-semibold">Project</h3>
        <div className="mb-2">
          <label className={label}>name</label>
          <input aria-label="project name" className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="mb-2">
          <label className={label}>description</label>
          <input aria-label="project description" className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={onSave} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg">
            Save
          </button>
          {saved && <span className="text-xs text-st-ok">✓ saved to tau.toml</span>}
        </div>
      </div>

      <div className={card}>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-xs font-semibold">Agents</h3>
          <span className="text-[10px] text-muted">· read-only (edit in Agents)</span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-accent/40 bg-accent/5 p-2">
          <input
            aria-label="import git url"
            placeholder="https://github.com/org/agent.git"
            className={`flex-1 ${input}`}
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
          />
          <select aria-label="import llm backend" className={input.replace("w-full", "w-28")} value={importBackend} onChange={(e) => setImportBackend(e.target.value)}>
            {backends.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button onClick={onImport} className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg">
            Import
          </button>
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">agent</th>
              <th className="px-2 py-1 font-medium">llm_backend</th>
              <th className="px-2 py-1 font-medium">package</th>
              <th className="px-2 py-1 font-medium">source</th>
            </tr>
          </thead>
          <tbody>
            {(cfg?.agents ?? []).map((a) => (
              <tr key={a.id} className="border-b border-border/60 last:border-0">
                <td className="py-1 pr-2 font-medium">{a.id}</td>
                <td className="px-2 py-1 font-mono text-muted">{a.llm_backend ?? "—"}</td>
                <td className="px-2 py-1 font-mono text-muted">{a.package ?? "—"}</td>
                <td className="px-2 py-1 font-mono text-muted">{a.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={card}>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-xs font-semibold">Credentials</h3>
          <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">gated · β.5</span>
        </div>
        <p className="text-xs text-muted">Provider chain (Env · File · SecretMgr · TokenBroker) — lands when tau ships the credential provider chain.</p>
      </div>
    </div>
  );
}
```
Run `pnpm vitest run src/config/ConfigPage.test.tsx` → PASS.

- [ ] **Step 3: Route** — in `web/src/App.tsx`, import `ConfigPage` and replace the `/config` `StubPage` route element with `<ConfigPage />`.

- [ ] **Step 4: Verify + commit** — `pnpm vitest run && pnpm lint && pnpm format:check && pnpm build` clean.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/config/ConfigPage.tsx web/src/config/ConfigPage.test.tsx web/src/App.tsx
git commit -m "feat(web): ConfigPage — project form, agents overview, import agent, credentials stub"
```

---

### Task 7: Frontend — PackagesPage

**Files:** create `web/src/packages/PackagesPage.tsx`, `web/src/packages/PackagesPage.test.tsx`; modify `web/src/App.tsx`

- [ ] **Step 1: Failing test** `web/src/packages/PackagesPage.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PackagesPage } from "./PackagesPage";

beforeEach(() => vi.restoreAllMocks());

describe("PackagesPage", () => {
  it("lists packages and installs a new one", async () => {
    let list = [{ name: "anthropic", version: "0.1.0", source: "github.com/tau/anthropic", status: "ok" }];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith("/api/packages") && (!init || init.method !== "POST"))
          return Promise.resolve({ ok: true, json: async () => ({ packages: list }) });
        if (url.endsWith("/api/packages/install")) {
          list = [...list, { name: "cooltool", version: "1.0.0", source: "github.com/acme/cooltool", status: "ok" }];
          return Promise.resolve({ ok: true, json: async () => ({ package: list[1] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );
    render(<PackagesPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("install git url"), {
      target: { value: "https://github.com/acme/cooltool.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(screen.getByText("cooltool")).toBeInTheDocument());
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement** `web/src/packages/PackagesPage.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { Package } from "../types/Package";
import {
  getPackages,
  installPackage,
  uninstallPackage,
  updatePackage,
  resolvePackages,
  verifyPackages,
} from "../api/config";

export function PackagesPage() {
  const [pkgs, setPkgs] = useState<Package[]>([]);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});

  const reload = () => getPackages().then(setPkgs).catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  async function onInstall() {
    if (!url.trim()) return;
    await installPackage(url).catch(() => {});
    setUrl("");
    reload();
  }
  async function onVerify() {
    const results = await verifyPackages().catch(() => []);
    setStatus(Object.fromEntries(results.map((r) => [r.name, r.status])));
  }

  const btn = "rounded-md px-2.5 py-1 text-xs font-medium";
  const ghost = `${btn} border border-border text-muted hover:text-fg`;
  const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Packages</h2>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
        <input
          aria-label="install git url"
          placeholder="https://github.com/org/tool.git"
          className={`min-w-0 flex-1 ${input}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button onClick={onInstall} className={`${btn} bg-accent text-accent-fg`}>
          Install
        </button>
        <button onClick={() => resolvePackages().then(setPkgs).catch(() => {})} className={ghost}>
          Resolve
        </button>
        <button onClick={onVerify} className={ghost}>
          Verify
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="px-3 py-2 font-medium">package</th>
              <th className="px-3 py-2 font-medium">version</th>
              <th className="px-3 py-2 font-medium">source</th>
              <th className="px-3 py-2 font-medium">status</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {pkgs.map((p) => (
              <tr key={p.name} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 font-mono text-muted">{p.version}</td>
                <td className="px-3 py-2 font-mono text-muted">{p.source}</td>
                <td className="px-3 py-2">
                  <span className="rounded bg-st-ok-soft px-1.5 py-0.5 text-[10px] font-medium text-st-ok">
                    {status[p.name] ?? p.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex gap-2">
                    <button onClick={() => updatePackage(p.name).then(reload).catch(() => {})} className={ghost}>
                      update
                    </button>
                    <button onClick={() => uninstallPackage(p.name).then(reload).catch(() => {})} className={ghost}>
                      uninstall
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```
Run `pnpm vitest run src/packages/PackagesPage.test.tsx` → PASS.

- [ ] **Step 3: Route** — in `web/src/App.tsx`, import `PackagesPage` and replace the `/packages` `StubPage` route element with `<PackagesPage />`.

- [ ] **Step 4: Verify + commit** — `pnpm vitest run && pnpm lint && pnpm format:check && pnpm build` clean.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/packages/PackagesPage.tsx web/src/packages/PackagesPage.test.tsx web/src/App.tsx
git commit -m "feat(web): PackagesPage — list, install, update, uninstall, resolve, verify"
```

---

### Task 8: End-to-end verification

**Files:** modify `web/e2e/run.spec.ts`

- [ ] **Step 1: e2e case** — append to `web/e2e/run.spec.ts`:
```ts
test("config + packages surfaces work", async ({ page }) => {
  // Packages: install a new one
  await page.goto("/packages");
  await expect(page.getByText("anthropic")).toBeVisible({ timeout: 5000 });
  await page.getByLabel("install git url").fill("https://github.com/acme/cooltool.git");
  await page.getByRole("button", { name: "Install" }).click();
  await expect(page.getByText("cooltool")).toBeVisible({ timeout: 5000 });

  // Config: import a community agent → appears in the agents table
  await page.goto("/config");
  await expect(page.getByLabel("project name")).toBeVisible({ timeout: 5000 });
  await page.getByLabel("import git url").fill("https://github.com/acme/researcher-pro.git");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("researcher-pro")).toBeVisible({ timeout: 5000 });
});
```
> Note: this mutates `fixtures/demo/tau.toml` (adds `researcher-pro`) when run against the real gateway. That's acceptable for the e2e run; if it matters, `git checkout fixtures/demo/tau.toml` after a local run. CI checks out a fresh tree each run, so it's clean there.

- [ ] **Step 2: Full gate + e2e**
```bash
cd /Users/titouanlebocq/code/tau-ui && cargo build --workspace && cargo test -p tau-gateway 2>&1 | grep "test result"
cd web && pnpm vitest run && pnpm lint && pnpm format:check && pnpm typecheck && pnpm build
pnpm exec playwright install chromium && CI=1 pnpm e2e
```
Expected: all green (the new config/packages e2e + the existing run/workflow cases).

- [ ] **Step 3: Restore fixture + seams doc** — `git checkout fixtures/demo/tau.toml` (undo the e2e's import mutation). In `docs/seams.md`, update the ② Project/Config row:
```markdown
| ② Project/Config | `gateway/src/config/mod.rs` (tau.toml R/W) + `packages/mod.rs` (MockOps; CliOps seam) — IMPLEMENTED; credentials gated | tau δ.1 resolver / β.5 credentials (CliOps shells real tau later) |
```

- [ ] **Step 4: Push + open PR** (this is a fresh branch off main):
```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "test(e2e): config + packages surfaces; mark config/packages implemented"
git push -u origin impl/config-packages
gh pr create --title "Project config + Packages (+ community-agent import)" --body "Implements the Config & Packages surfaces per docs/superpowers/specs/2026-05-31-project-config-packages-design.md. Real tau.toml read/write (toml_edit); mock-backed package management with a CliOps seam; community-agent import (install package + register [agents.<id>]).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh run watch "$(gh run list --branch impl/config-packages --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status --interval 20
```
Expected: `rust`, `web`, `e2e` all green on the new PR.

---

## Self-review
1. **Spec coverage:** §1.1 ConfigStore → T1; §1.2 PackageOps (Mock+Cli) → T2; §1.3 API → T4; §2 client → T5, ConfigPage → T6, PackagesPage → T7, routes → T6/T7; §4b import (add_agent + import_agent + endpoint + UI) → T1/T3/T4/T6; §3 mock fixtures (MockOps in-memory; real fixtures/demo/tau.toml) → T2/T6; §4 testing → tests in T1–T7 + e2e in T8; seams doc → T8; non-goals respected. ✓
2. **Placeholder scan:** every file is full code; `CliOps` is a complete graceful-stub (not a TODO). ✓
3. **Type consistency:** `ProjectConfig`/`AgentInfo`/`Package`/`VerifyResult` defined in T1/T2 (ts-rs `#[ts(export)]`, matching the trace-types convention) and consumed by the client (T5) + pages (T6/T7); `import_agent`/`config_write`/`package_*` signatures match across state (T3), API (T4), client (T5); `name_from_url` shared (T2) used by `import_agent` (T3); routes use `delete`/`put` (added to the axum routing import in T4). ✓
4. **Real-mutation caution:** config writes + the e2e import mutate the real `fixtures/demo/tau.toml`; T4 smoke and T8 restore it (`git checkout`), and CI uses a fresh checkout. Noted. ✓
