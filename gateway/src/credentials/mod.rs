//! LLM-backend credentials: an ordered source **chain** (first-resolves-wins),
//! tau's "provider chain, never a vault" model with the gateway as the parent-app
//! resolver. CR-1 ships Env + Local; the rest are gated (CR-2/CR-3). The store is
//! global (per gateway `data_root`); secret values are write-only and never echoed.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Env,
    Local,
    Vault,
    AwsKv,
    GcpKv,
    AzureKv,
    TokenBroker,
    WorkloadIdentity,
}

impl SourceKind {
    /// Not yet wired in CR-1 (everything except Env/Local).
    pub fn gated(self) -> bool {
        !matches!(self, SourceKind::Env | SourceKind::Local)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SourceConfig {
    pub kind: SourceKind,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    #[ts(rename = "ref")]
    pub reference: Option<String>, // Env: var name; CR-2/3: addr/path/url; Local: None
}

/// Per-source status — NEVER carries a secret value.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SourceStatus {
    pub kind: SourceKind,
    #[serde(rename = "ref")]
    #[ts(rename = "ref")]
    pub reference: Option<String>,
    pub configured: bool,
    pub gated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BackendCredentialStatus {
    pub backend: String,
    pub sources: Vec<SourceStatus>,
    pub resolved: bool,
    pub resolved_via: Option<SourceKind>,
}

/// Whether one source can resolve, given local-secret presence + an env lookup.
pub fn source_configured(
    s: &SourceConfig,
    has_local: bool,
    env_get: &dyn Fn(&str) -> Option<String>,
) -> bool {
    match s.kind {
        SourceKind::Local => has_local,
        SourceKind::Env => s
            .reference
            .as_deref()
            .and_then(env_get)
            .map(|v| !v.is_empty())
            .unwrap_or(false),
        _ => false, // gated kinds never resolve in CR-1
    }
}

/// Walk the chain; the first configured source wins.
pub fn resolve(
    sources: &[SourceConfig],
    has_local: bool,
    env_get: &dyn Fn(&str) -> Option<String>,
) -> (bool, Option<SourceKind>) {
    for s in sources {
        if source_configured(s, has_local, env_get) {
            return (true, Some(s.kind));
        }
    }
    (false, None)
}

// ---- store: global per-gateway, two 0600 files under `data_root` ----

#[derive(Default, Serialize, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    backends: BTreeMap<String, BackendConfig>,
}

#[derive(Default, Serialize, Deserialize)]
struct BackendConfig {
    #[serde(default)]
    sources: Vec<SourceConfig>,
}

/// Serializes credential writes process-wide (one gateway → one `data_root`).
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// The credential store, bound to a gateway `data_root`. Reads are lock-free;
/// writes take `WRITE_LOCK` to serialize the read-modify-write of both files.
pub struct Credentials {
    data_root: PathBuf,
}

impl Credentials {
    pub fn new(data_root: PathBuf) -> Self {
        Self { data_root }
    }

    fn config_path(&self) -> PathBuf {
        self.data_root.join("credentials.toml")
    }
    fn secrets_path(&self) -> PathBuf {
        self.data_root.join("credentials.secrets.json")
    }

    fn read_config(&self) -> ConfigFile {
        std::fs::read_to_string(self.config_path())
            .ok()
            .and_then(|t| toml::from_str(&t).ok())
            .unwrap_or_default()
    }
    fn read_secrets(&self) -> BTreeMap<String, String> {
        std::fs::read_to_string(self.secrets_path())
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }
    fn write_config(&self, c: &ConfigFile) -> std::io::Result<()> {
        std::fs::write(self.config_path(), toml::to_string_pretty(c).unwrap_or_default())?;
        set_0600(&self.config_path());
        Ok(())
    }
    fn write_secrets(&self, s: &BTreeMap<String, String>) -> std::io::Result<()> {
        std::fs::write(self.secrets_path(), serde_json::to_string_pretty(s).unwrap_or_default())?;
        set_0600(&self.secrets_path());
        Ok(())
    }

    fn status_for(
        &self,
        backend: &str,
        cfg: &BackendConfig,
        secrets: &BTreeMap<String, String>,
    ) -> BackendCredentialStatus {
        let has_local = secrets.contains_key(backend);
        let env_get = |k: &str| std::env::var(k).ok();
        let sources: Vec<SourceStatus> = cfg
            .sources
            .iter()
            .map(|s| SourceStatus {
                kind: s.kind,
                reference: s.reference.clone(),
                configured: source_configured(s, has_local, &env_get),
                gated: s.kind.gated(),
            })
            .collect();
        let (resolved, resolved_via) = resolve(&cfg.sources, has_local, &env_get);
        BackendCredentialStatus {
            backend: backend.to_string(),
            sources,
            resolved,
            resolved_via,
        }
    }

    /// Status for every configured backend (no secret values).
    pub fn status_all(&self) -> Vec<BackendCredentialStatus> {
        let cfg = self.read_config();
        let secrets = self.read_secrets();
        cfg.backends
            .iter()
            .map(|(name, bc)| self.status_for(name, bc, &secrets))
            .collect()
    }

    /// Set a backend's ordered sources (+ optional write-only Local value).
    /// `Err(msg)` → the caller maps to HTTP 422.
    pub fn put(
        &self,
        backend: &str,
        sources: Vec<SourceConfig>,
        local_value: Option<String>,
    ) -> Result<BackendCredentialStatus, String> {
        let mut seen = HashSet::new();
        for s in &sources {
            if s.kind.gated() {
                return Err(format!("source kind {:?} is gated in CR-1", s.kind));
            }
            if matches!(s.kind, SourceKind::Env)
                && s.reference.as_deref().unwrap_or("").is_empty()
            {
                return Err("env source requires a non-empty ref".to_string());
            }
            if !seen.insert(s.kind) {
                return Err("duplicate source kind".to_string());
            }
        }

        let _guard = WRITE_LOCK.lock().unwrap();
        let mut cfg = self.read_config();
        let mut secrets = self.read_secrets();
        let has_local_kind = sources.iter().any(|s| matches!(s.kind, SourceKind::Local));
        cfg.backends.insert(backend.to_string(), BackendConfig { sources });
        match (has_local_kind, local_value) {
            (true, Some(v)) => {
                secrets.insert(backend.to_string(), v);
            }
            (false, _) => {
                secrets.remove(backend);
            }
            (true, None) => {} // keep existing local value
        }
        self.write_config(&cfg).map_err(|e| e.to_string())?;
        self.write_secrets(&secrets).map_err(|e| e.to_string())?;
        Ok(self.status_for(backend, cfg.backends.get(backend).unwrap(), &secrets))
    }

    /// Remove a backend's config + secret.
    pub fn delete(&self, backend: &str) -> std::io::Result<()> {
        let _guard = WRITE_LOCK.lock().unwrap();
        let mut cfg = self.read_config();
        let mut secrets = self.read_secrets();
        cfg.backends.remove(backend);
        secrets.remove(backend);
        self.write_config(&cfg)?;
        self.write_secrets(&secrets)?;
        Ok(())
    }
}

#[cfg(unix)]
fn set_0600(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn set_0600(_path: &Path) {}

#[cfg(test)]
mod resolver_tests {
    use super::*;

    fn src(kind: SourceKind, r: Option<&str>) -> SourceConfig {
        SourceConfig { kind, reference: r.map(|s| s.to_string()) }
    }
    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn local_resolves_when_value_present() {
        let s = [src(SourceKind::Local, None)];
        assert_eq!(resolve(&s, true, &no_env), (true, Some(SourceKind::Local)));
        assert_eq!(resolve(&s, false, &no_env), (false, None));
    }

    #[test]
    fn env_resolves_when_var_set() {
        let s = [src(SourceKind::Env, Some("MY_KEY"))];
        let getter = |k: &str| (k == "MY_KEY").then(|| "secret".to_string());
        assert_eq!(resolve(&s, false, &getter), (true, Some(SourceKind::Env)));
        assert_eq!(resolve(&s, false, &no_env), (false, None));
    }

    #[test]
    fn first_match_wins() {
        let s = [src(SourceKind::Local, None), src(SourceKind::Env, Some("MY_KEY"))];
        let getter = |k: &str| (k == "MY_KEY").then(|| "x".to_string());
        assert_eq!(resolve(&s, true, &getter), (true, Some(SourceKind::Local)));
        assert_eq!(resolve(&s, false, &getter), (true, Some(SourceKind::Env)));
    }

    #[test]
    fn gated_never_resolves() {
        let s = [src(SourceKind::Vault, Some("secret/x"))];
        assert_eq!(resolve(&s, true, &no_env), (false, None));
        assert!(SourceKind::Vault.gated());
        assert!(!SourceKind::Env.gated());
        assert!(!SourceKind::Local.gated());
    }

    #[test]
    fn empty_chain_unresolved() {
        assert_eq!(resolve(&[], true, &no_env), (false, None));
    }
}

#[cfg(test)]
mod store_tests {
    use super::*;

    fn cfg(kind: SourceKind, r: Option<&str>) -> SourceConfig {
        SourceConfig { kind, reference: r.map(|s| s.to_string()) }
    }

    #[test]
    fn put_local_then_status_resolves_without_echoing_value() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        let st = c
            .put("anthropic", vec![cfg(SourceKind::Local, None)], Some("sk-secret".into()))
            .unwrap();
        assert!(st.resolved);
        assert_eq!(st.resolved_via, Some(SourceKind::Local));
        let json = serde_json::to_string(&st).unwrap();
        assert!(!json.contains("sk-secret"));
        let all = c.status_all();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].backend, "anthropic");
    }

    #[test]
    fn secrets_file_is_0600() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put("openai", vec![cfg(SourceKind::Local, None)], Some("v".into())).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("credentials.secrets.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn config_round_trips_and_delete_clears() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put(
            "anthropic",
            vec![cfg(SourceKind::Local, None), cfg(SourceKind::Env, Some("ANTHROPIC_API_KEY"))],
            Some("v".into()),
        )
        .unwrap();
        let c2 = Credentials::new(dir.path().to_path_buf());
        let st = &c2.status_all()[0];
        assert_eq!(st.sources.len(), 2);
        assert_eq!(st.sources[0].kind, SourceKind::Local);
        assert_eq!(st.sources[1].reference.as_deref(), Some("ANTHROPIC_API_KEY"));
        c2.delete("anthropic").unwrap();
        assert!(c2.status_all().is_empty());
    }

    #[test]
    fn put_rejects_gated_and_duplicate_kinds() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        assert!(c.put("x", vec![cfg(SourceKind::Vault, Some("p"))], None).is_err());
        assert!(c
            .put("x", vec![cfg(SourceKind::Env, Some("A")), cfg(SourceKind::Env, Some("B"))], None)
            .is_err());
        assert!(c.put("x", vec![cfg(SourceKind::Env, None)], None).is_err());
    }

    #[test]
    fn dropping_local_source_clears_the_secret() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put("anthropic", vec![cfg(SourceKind::Local, None)], Some("v".into())).unwrap();
        let st = c
            .put("anthropic", vec![cfg(SourceKind::Env, Some("DEFINITELY_UNSET_VAR_XZ"))], None)
            .unwrap();
        assert!(!st.resolved);
    }
}
