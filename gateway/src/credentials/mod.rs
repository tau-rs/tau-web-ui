//! LLM-backend credentials: an ordered source **chain** (first-resolves-wins),
//! tau's "provider chain, never a vault" model with the gateway as the parent-app
//! resolver. CR-1 ships Env + Local; the rest are gated (CR-2/CR-3). The store is
//! global (per gateway `data_root`); secret values are write-only and never echoed.

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
