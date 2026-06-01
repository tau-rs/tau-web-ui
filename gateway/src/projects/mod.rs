//! Project registry: owns one AppState per tau project, persisted to
//! `<data_root>/projects.json`, each project's runs under
//! `<data_root>/projects/<id>/runs/`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{bail, Context, Result};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use ts_rs::TS;

use crate::projects::cloner::{GitCloner, MockCloner, ProjectCloner};
use crate::state::AppState;
use crate::store::RunStore;
use crate::trace::{Run, RunStatus};

pub mod cloner;

pub type ProjectId = String;

/// Reserved id of the always-present, auto-provisioned working environment.
pub const WORKSPACE_ID: &str = "workspace";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ProjectSource {
    Local,
    Git { url: String },
    Workspace,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectMeta {
    pub id: ProjectId,
    pub name: String,
    pub path: String,
    pub source: ProjectSource,
}

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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CrossProjectRun {
    pub project_id: ProjectId,
    pub project_name: String,
    pub run: Run,
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
        reg.ensure_workspace().await?;
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
        // The built-in workspace is re-ensured each start and must never be
        // persisted to projects.json.
        let metas: Vec<ProjectMeta> = self
            .0
            .projects
            .read()
            .await
            .values()
            .filter(|e| e.meta.id != WORKSPACE_ID)
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
        let store_dir = self
            .0
            .data_root
            .join("projects")
            .join(&meta.id)
            .join("runs");
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
        let base = if base.is_empty() {
            "project".into()
        } else {
            slug(base)
        };
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
            .or_else(|| path.file_name().map(|s| s.to_string_lossy().to_string()))
            .unwrap_or_else(|| "project".into());
        Ok(name)
    }

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

    /// Promote the workspace to a real project at `target`: copy its authoring
    /// files there, register it, then reset the workspace to a clean slate.
    pub async fn save_workspace_as(&self, target: &Path) -> Result<ProjectMeta> {
        let ws_path = {
            let map = self.0.projects.read().await;
            let e = map.get(WORKSPACE_ID).context("no workspace registered")?;
            PathBuf::from(&e.meta.path)
        };
        if target.join("tau.toml").exists() {
            bail!("target already contains a tau.toml: {}", target.display());
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
            source: ProjectSource::Git {
                url: url.to_string(),
            },
        };
        self.insert_entry(meta.clone()).await?;
        self.write_manifest().await?;
        Ok(meta)
    }

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
        self.0
            .projects
            .read()
            .await
            .get(id)
            .map(|e| e.state.clone())
    }

    /// All project metas in insertion order.
    pub async fn metas(&self) -> Vec<ProjectMeta> {
        self.0
            .projects
            .read()
            .await
            .values()
            .map(|e| e.meta.clone())
            .collect()
    }

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

    /// Compute a summary per project from persisted runs + config. `now` is an
    /// RFC3339 timestamp used for the 24h failure window (injected for testing).
    pub async fn list_summaries(&self, now: &str) -> Vec<ProjectListItem> {
        let now_dt = chrono::DateTime::parse_from_rfc3339(now).ok();
        let mut items = vec![];
        let ids: Vec<ProjectId> = self.0.projects.read().await.keys().cloned().collect();
        for id in ids {
            let entry = {
                let map = self.0.projects.read().await;
                map.get(&id).map(|e| (e.meta.clone(), e.state.clone()))
            };
            // Skip if the project was removed between the id snapshot and here.
            let Some((meta, state)) = entry else { continue };
            let runs = state.list_runs().await;
            let summary = summarize(&runs, now_dt, &state).await;
            items.push(ProjectListItem { meta, summary });
        }
        items
    }
}

async fn summarize(
    runs: &[Run],
    now: Option<chrono::DateTime<chrono::FixedOffset>>,
    state: &AppState,
) -> ProjectSummary {
    let total = runs.len() as u32;
    let running = runs
        .iter()
        .filter(|r| r.status == RunStatus::Running)
        .count() as u32;
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
    let agents = state
        .config_read()
        .map(|c| c.agents.len() as u32)
        .unwrap_or(0);
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

fn within_24h(ended_at: Option<&str>, now: Option<chrono::DateTime<chrono::FixedOffset>>) -> bool {
    match (
        ended_at.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()),
        now,
    ) {
        (Some(ended), Some(now)) => (now - ended).num_hours() < 24 && now >= ended,
        _ => false,
    }
}

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
