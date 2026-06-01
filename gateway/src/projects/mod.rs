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
