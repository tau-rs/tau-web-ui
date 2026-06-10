//! LLM-backend credentials: an ordered source **chain** (first-resolves-wins),
//! tau's "provider chain, never a vault" model with the gateway as the parent-app
//! resolver. Env / Local resolve here; SecretManagers (Vault / AWS / GCP / Azure KV)
//! resolve by ambient-env presence; TokenBroker / WorkloadIdentity are configured
//! here but **resolved by tau at runtime** (UI-only). The store is global (per
//! gateway `data_root`); secret values are write-only and never echoed.

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
    pub detail: Option<String>, // non-secret hint; "resolved by tau at runtime" for broker/WI
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BackendCredentialStatus {
    pub backend: String,
    pub sources: Vec<SourceStatus>,
    pub resolved: bool,
    pub resolved_via: Option<SourceKind>,
}

/// The ambient env var(s) whose presence (any one) makes a SecretManager source
/// resolvable. The single source of truth shared by `source_configured` +
/// `source_detail`, so a new requisite is added in exactly one place. Empty for
/// non-manager kinds.
fn manager_env_vars(kind: SourceKind) -> &'static [&'static str] {
    match kind {
        SourceKind::Vault => &["VAULT_ADDR"],
        SourceKind::AwsKv => &["AWS_REGION", "AWS_DEFAULT_REGION"],
        SourceKind::GcpKv => &["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT"],
        SourceKind::AzureKv => &["AZURE_KEYVAULT_URL"],
        _ => &[],
    }
}

/// Whether one source can resolve, given local-secret presence + an env lookup.
/// CR-2: SecretManager kinds are "configured" when their `ref` is set AND the
/// manager's ambient-connection env is present (no secret is fetched).
pub fn source_configured(
    s: &SourceConfig,
    has_local: bool,
    env_get: &dyn Fn(&str) -> Option<String>,
) -> bool {
    let ref_present = s
        .reference
        .as_deref()
        .map(|r| !r.is_empty())
        .unwrap_or(false);
    let env_set = |k: &str| env_get(k).map(|v| !v.is_empty()).unwrap_or(false);
    match s.kind {
        SourceKind::Local => has_local,
        SourceKind::Env => s
            .reference
            .as_deref()
            .and_then(env_get)
            .map(|v| !v.is_empty())
            .unwrap_or(false),
        SourceKind::Vault | SourceKind::AwsKv | SourceKind::GcpKv | SourceKind::AzureKv => {
            ref_present && manager_env_vars(s.kind).iter().any(|v| env_set(v))
        }
        SourceKind::TokenBroker | SourceKind::WorkloadIdentity => false, // resolution deferred to tau at runtime
    }
}

/// A non-secret hint about why a source is (un)configured. `None` when configured.
pub fn source_detail(
    s: &SourceConfig,
    has_local: bool,
    env_get: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    if source_configured(s, has_local, env_get) {
        return None;
    }
    let ref_empty = s.reference.as_deref().map(|r| r.is_empty()).unwrap_or(true);
    match s.kind {
        SourceKind::Local => Some("no value stored".to_string()),
        // Always Some for these two — the gateway never resolves them, so this
        // doubles as the UI's "↗ resolved by tau at runtime" label.
        SourceKind::TokenBroker | SourceKind::WorkloadIdentity => {
            Some("resolved by tau at runtime".to_string())
        }
        SourceKind::Env if ref_empty => Some("ref is empty".to_string()),
        SourceKind::Env => Some(format!("{} not set", s.reference.as_deref().unwrap_or(""))),
        _ if ref_empty => Some("ref is empty".to_string()),
        // a SecretManager with a ref but no ambient connection env present:
        _ => Some(format!("{} not set", manager_env_vars(s.kind).join(" / "))),
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

/// Why a `put` failed — lets the API map validation to 422 and I/O to 500.
#[derive(Debug)]
pub enum PutError {
    /// Bad request (duplicate kind, or an empty ref on a ref-required kind) → HTTP 422.
    Invalid(String),
    /// A write to the data dir failed (disk full, permissions, …) → HTTP 500.
    Io(std::io::Error),
}

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
        // Propagate a serialization failure rather than truncating the file to "".
        let text = toml::to_string_pretty(c)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        write_secure(&self.config_path(), text.as_bytes())
    }
    fn write_secrets(&self, s: &BTreeMap<String, String>) -> std::io::Result<()> {
        let text = serde_json::to_string_pretty(s)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        write_secure(&self.secrets_path(), text.as_bytes())
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
                detail: source_detail(s, has_local, &env_get),
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
    /// `PutError::Invalid` → HTTP 422; `PutError::Io` → HTTP 500.
    pub fn put(
        &self,
        backend: &str,
        sources: Vec<SourceConfig>,
        local_value: Option<String>,
    ) -> Result<BackendCredentialStatus, PutError> {
        let mut seen = HashSet::new();
        for s in &sources {
            if !matches!(s.kind, SourceKind::Local | SourceKind::WorkloadIdentity)
                && s.reference.as_deref().unwrap_or("").is_empty()
            {
                return Err(PutError::Invalid(
                    "this source kind requires a non-empty ref".to_string(),
                ));
            }
            if !seen.insert(s.kind) {
                return Err(PutError::Invalid("duplicate source kind".to_string()));
            }
        }

        let _guard = WRITE_LOCK.lock().unwrap();
        let mut cfg = self.read_config();
        let mut secrets = self.read_secrets();
        let has_local_kind = sources.iter().any(|s| matches!(s.kind, SourceKind::Local));
        cfg.backends
            .insert(backend.to_string(), BackendConfig { sources });
        match (has_local_kind, local_value) {
            (true, Some(v)) => {
                secrets.insert(backend.to_string(), v);
            }
            (false, _) => {
                secrets.remove(backend);
            }
            (true, None) => {} // keep existing local value
        }
        self.write_config(&cfg).map_err(PutError::Io)?;
        self.write_secrets(&secrets).map_err(PutError::Io)?;
        Ok(self.status_for(backend, cfg.backends.get(backend).unwrap(), &secrets))
    }

    /// Remove a backend's config + secret. Idempotent: deleting an unconfigured
    /// backend succeeds (no-op), so the API returns 200 rather than 404.
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

/// Write `bytes` to `path` such that the file is never observable with looser
/// permissions than 0600: write to a sibling temp file created with mode 0600,
/// then atomically `rename` it into place. A reader of `path` sees either the old
/// file or the fully-written new one — never a partial or world-readable secret.
fn write_secure(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    {
        let mut f = open_0600(&tmp)?;
        f.write_all(bytes)?;
        let _ = f.sync_all(); // best-effort flush; rename below is the durability gate
    }
    std::fs::rename(&tmp, path)
}

#[cfg(unix)]
fn open_0600(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
}
#[cfg(not(unix))]
fn open_0600(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
}

#[cfg(test)]
mod resolver_tests {
    use super::*;

    fn src(kind: SourceKind, r: Option<&str>) -> SourceConfig {
        SourceConfig {
            kind,
            reference: r.map(|s| s.to_string()),
        }
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
        let s = [
            src(SourceKind::Local, None),
            src(SourceKind::Env, Some("MY_KEY")),
        ];
        let getter = |k: &str| (k == "MY_KEY").then(|| "x".to_string());
        assert_eq!(resolve(&s, true, &getter), (true, Some(SourceKind::Local)));
        assert_eq!(resolve(&s, false, &getter), (true, Some(SourceKind::Env)));
    }

    #[test]
    fn token_broker_and_workload_identity_defer_to_tau() {
        let tb = src(SourceKind::TokenBroker, Some("https://broker"));
        let wi = src(SourceKind::WorkloadIdentity, None);
        // the gateway never resolves these — resolution is tau's at runtime
        assert!(!source_configured(&tb, true, &no_env));
        assert!(!source_configured(&wi, true, &no_env));
        assert_eq!(
            source_detail(&tb, false, &no_env).as_deref(),
            Some("resolved by tau at runtime")
        );
        assert_eq!(
            source_detail(&wi, false, &no_env).as_deref(),
            Some("resolved by tau at runtime")
        );
        // a chain of only these resolves to nothing in the gateway
        assert_eq!(resolve(&[tb, wi], true, &no_env), (false, None));
    }

    #[test]
    fn managers_resolve_with_ref_and_ambient_env() {
        let vault = src(SourceKind::Vault, Some("secret/data/x"));
        let addr = |k: &str| (k == "VAULT_ADDR").then(|| "http://v:8200".to_string());
        assert!(source_configured(&vault, false, &addr));
        assert!(!source_configured(&vault, false, &no_env)); // VAULT_ADDR missing
        assert!(!source_configured(
            &src(SourceKind::Vault, None),
            false,
            &addr
        )); // ref missing

        let aws = src(SourceKind::AwsKv, Some("prod/key"));
        assert!(source_configured(&aws, false, &|k: &str| (k
            == "AWS_REGION")
            .then(|| "us-east-1".to_string())));
        assert!(source_configured(&aws, false, &|k: &str| (k
            == "AWS_DEFAULT_REGION")
            .then(|| "eu-west-1".to_string())));

        let gcp = src(SourceKind::GcpKv, Some("projects/p/secrets/x"));
        assert!(source_configured(&gcp, false, &|k: &str| (k
            == "GOOGLE_CLOUD_PROJECT")
            .then(|| "p".to_string())));

        let azure = src(SourceKind::AzureKv, Some("x"));
        assert!(source_configured(&azure, false, &|k: &str| (k
            == "AZURE_KEYVAULT_URL")
            .then(|| "https://v.vault.azure.net".to_string())));
    }

    #[test]
    fn source_detail_explains_status() {
        let vault = src(SourceKind::Vault, Some("secret/x"));
        assert_eq!(
            source_detail(&vault, false, &no_env).as_deref(),
            Some("VAULT_ADDR not set")
        );
        let addr = |k: &str| (k == "VAULT_ADDR").then(|| "http://v".to_string());
        assert_eq!(source_detail(&vault, false, &addr), None);
        assert_eq!(
            source_detail(&src(SourceKind::Vault, None), false, &addr).as_deref(),
            Some("ref is empty"),
        );
        assert_eq!(
            source_detail(&src(SourceKind::AwsKv, Some("k")), false, &no_env).as_deref(),
            Some("AWS_REGION / AWS_DEFAULT_REGION not set"),
        );
        assert_eq!(
            source_detail(
                &src(SourceKind::TokenBroker, Some("https://b")),
                false,
                &no_env
            )
            .as_deref(),
            Some("resolved by tau at runtime"),
        );
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
        SourceConfig {
            kind,
            reference: r.map(|s| s.to_string()),
        }
    }

    #[test]
    fn put_local_then_status_resolves_without_echoing_value() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        let st = c
            .put(
                "anthropic",
                vec![cfg(SourceKind::Local, None)],
                Some("sk-secret".into()),
            )
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
        c.put(
            "openai",
            vec![cfg(SourceKind::Local, None)],
            Some("v".into()),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for f in ["credentials.secrets.json", "credentials.toml"] {
                let mode = std::fs::metadata(dir.path().join(f))
                    .unwrap()
                    .permissions()
                    .mode();
                assert_eq!(mode & 0o777, 0o600, "{f} should be 0600");
            }
        }
    }

    #[test]
    fn config_round_trips_and_delete_clears() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put(
            "anthropic",
            vec![
                cfg(SourceKind::Local, None),
                cfg(SourceKind::Env, Some("ANTHROPIC_API_KEY")),
            ],
            Some("v".into()),
        )
        .unwrap();
        let c2 = Credentials::new(dir.path().to_path_buf());
        let st = &c2.status_all()[0];
        assert_eq!(st.sources.len(), 2);
        assert_eq!(st.sources[0].kind, SourceKind::Local);
        assert_eq!(
            st.sources[1].reference.as_deref(),
            Some("ANTHROPIC_API_KEY")
        );
        c2.delete("anthropic").unwrap();
        assert!(c2.status_all().is_empty());
    }

    #[test]
    fn put_validates_ref_and_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        // duplicate kind → rejected
        assert!(c
            .put(
                "x",
                vec![
                    cfg(SourceKind::Env, Some("A")),
                    cfg(SourceKind::Env, Some("B"))
                ],
                None
            )
            .is_err());
        // empty ref on a ref-required kind → rejected (Env, SecretManager, TokenBroker)
        assert!(c.put("x", vec![cfg(SourceKind::Env, None)], None).is_err());
        assert!(c
            .put("x", vec![cfg(SourceKind::Vault, None)], None)
            .is_err());
        assert!(c
            .put("x", vec![cfg(SourceKind::TokenBroker, None)], None)
            .is_err());
        // accepted: SecretManager with a ref, TokenBroker with a URL, ref-less WorkloadIdentity
        let v = c
            .put("a", vec![cfg(SourceKind::Vault, Some("secret/x"))], None)
            .unwrap();
        assert_eq!(v.sources[0].kind, SourceKind::Vault);
        assert!(!v.sources[0].configured);
        assert!(v.sources[0].detail.is_some());
        assert!(c
            .put(
                "b",
                vec![cfg(SourceKind::TokenBroker, Some("https://b"))],
                None
            )
            .is_ok());
        let wi = c
            .put("c", vec![cfg(SourceKind::WorkloadIdentity, None)], None)
            .unwrap();
        assert_eq!(
            wi.sources[0].detail.as_deref(),
            Some("resolved by tau at runtime")
        );
        // Local is also ref-exempt
        assert!(c.put("d", vec![cfg(SourceKind::Local, None)], None).is_ok());
    }

    #[test]
    fn dropping_local_source_clears_the_secret() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put(
            "anthropic",
            vec![cfg(SourceKind::Local, None)],
            Some("v".into()),
        )
        .unwrap();
        let st = c
            .put(
                "anthropic",
                vec![cfg(SourceKind::Env, Some("DEFINITELY_UNSET_VAR_XZ"))],
                None,
            )
            .unwrap();
        assert!(!st.resolved);
    }

    #[test]
    fn re_put_with_local_but_no_value_keeps_the_existing_secret() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        c.put(
            "anthropic",
            vec![cfg(SourceKind::Local, None)],
            Some("v".into()),
        )
        .unwrap();
        // re-order/edit sources keeping a Local source, but send no new value
        let st = c
            .put(
                "anthropic",
                vec![
                    cfg(SourceKind::Local, None),
                    cfg(SourceKind::Env, Some("X")),
                ],
                None,
            )
            .unwrap();
        // the existing local value is retained → still resolves via local
        assert!(st.resolved);
        assert_eq!(st.resolved_via, Some(SourceKind::Local));
    }
}
