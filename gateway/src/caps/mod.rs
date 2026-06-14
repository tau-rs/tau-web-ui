//! Effective capabilities: each agent's computed capability set, sourced live
//! from `tau list agents --capabilities --json`. `MockCaps` fabricates a
//! deterministic set; `CliCaps` shells tau and parses its JSON array.
//!
//! `effective` is `None` when tau omits the capability set for an agent
//! (package not installed) — distinct from `Some([])`, a fully-sandboxed agent.

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One capability row. Field names mirror tau's `tau list … --json` output and
/// the `tau.toml` schema: `allow_paths`/`deny_paths` for `fs.*`,
/// `allow_hosts`/`deny_hosts` for `net.http`, `allow_commands`/`deny_commands`
/// for `process.spawn`/`exec`, `max_bytes` for `fs.write`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CapabilityRow {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_paths: Option<Vec<String>>,
    #[serde(default)]
    pub deny_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_hosts: Option<Vec<String>>,
    #[serde(default)]
    pub deny_hosts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_commands: Option<Vec<String>>,
    #[serde(default)]
    pub deny_commands: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<u64>,
}

/// Per-agent effective capability set. `effective: None` => package not
/// installed; `Some([])` => agent sandboxed to nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentCapabilities {
    pub agent_id: String,
    pub display_name: String,
    pub llm_backend: String,
    pub effective: Option<Vec<CapabilityRow>>,
}

/// Source of effective capabilities: `MockCaps` (deterministic) or `CliCaps`
/// (shells `tau list agents --capabilities --json`).
///
/// Unlike `CheckSource` (infallible — folds spawn errors into a finding),
/// spawn/parse failures here propagate as `Err`; the HTTP handler maps them
/// to a 502 so the UI can surface the failure instead of showing empty data.
pub trait CapsSource: Send + Sync {
    fn agent_capabilities(&self) -> anyhow::Result<Vec<AgentCapabilities>>;
}

/// Deserialize-only mirror of one row of `tau list agents --json`. Renames the
/// agent-level fields to the gateway's wire names; `package` is ignored.
#[derive(Deserialize)]
struct RawAgentRow {
    id: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    llm_backend: String,
    #[serde(default)]
    effective_capabilities: Option<Vec<CapabilityRow>>,
}

/// Parse the JSON array emitted by `tau list agents --capabilities --json`.
fn parse_agents_json(stdout: &str) -> anyhow::Result<Vec<AgentCapabilities>> {
    let rows: Vec<RawAgentRow> = serde_json::from_str(stdout.trim())
        .map_err(|e| anyhow::anyhow!("parsing `tau list` JSON: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|r| AgentCapabilities {
            agent_id: r.id,
            display_name: r.display_name,
            llm_backend: r.llm_backend,
            effective: r.effective_capabilities,
        })
        .collect())
}

pub struct MockCaps;

impl CapsSource for MockCaps {
    fn agent_capabilities(&self) -> anyhow::Result<Vec<AgentCapabilities>> {
        let cap = |kind: &str| CapabilityRow {
            kind: kind.into(),
            allow_paths: None,
            deny_paths: vec![],
            allow_hosts: None,
            deny_hosts: vec![],
            allow_commands: None,
            deny_commands: vec![],
            max_bytes: None,
        };
        Ok(vec![
            AgentCapabilities {
                agent_id: "researcher".into(),
                display_name: "Researcher".into(),
                llm_backend: "anthropic".into(),
                effective: Some(vec![
                    CapabilityRow {
                        allow_paths: Some(vec!["./src/**".into()]),
                        ..cap("fs.read")
                    },
                    CapabilityRow {
                        allow_hosts: Some(vec!["api.weather.com".into()]),
                        ..cap("net.http")
                    },
                ]),
            },
            AgentCapabilities {
                agent_id: "writer".into(),
                display_name: "Writer".into(),
                llm_backend: "anthropic".into(),
                effective: Some(vec![CapabilityRow {
                    allow_paths: Some(vec!["out/**".into()]),
                    max_bytes: Some(1_048_576),
                    ..cap("fs.write")
                }]),
            },
            AgentCapabilities {
                agent_id: "greeter".into(),
                display_name: "Greeter".into(),
                llm_backend: "anthropic".into(),
                effective: Some(vec![]),
            },
            AgentCapabilities {
                agent_id: "archivist".into(),
                display_name: "Archivist".into(),
                llm_backend: "anthropic".into(),
                effective: None,
            },
        ])
    }
}

/// Shells `tau list agents --capabilities --json` in the project dir.
pub struct CliCaps {
    bin: PathBuf,
    project: PathBuf,
}

impl CliCaps {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        Self { bin, project }
    }
}

impl CapsSource for CliCaps {
    fn agent_capabilities(&self) -> anyhow::Result<Vec<AgentCapabilities>> {
        let out = Command::new(&self.bin)
            .current_dir(&self.project)
            .arg("list")
            .arg("agents")
            .arg("--capabilities")
            .arg("--json")
            .output()
            .map_err(|e| anyhow::anyhow!("could not run `tau list`: {e}"))?;
        // Unlike `tau check`, `tau list` exits non-zero only on real failure
        // (not as a data signal), so a non-zero status is an error.
        if !out.status.success() {
            anyhow::bail!(
                "`tau list agents --capabilities` failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        parse_agents_json(&String::from_utf8_lossy(&out.stdout))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_populated_absent_and_empty_rows() {
        let json = r#"[
          {"id":"researcher","display_name":"Researcher","package":"weather","llm_backend":"anthropic",
           "effective_capabilities":[
             {"kind":"fs.read","allow_paths":["./src/**"],"deny_paths":[]},
             {"kind":"fs.write","allow_paths":["out/**"],"deny_paths":[],"max_bytes":1048576}
           ]},
          {"id":"greeter","display_name":"Greeter","package":"g","llm_backend":"anthropic",
           "effective_capabilities":[]},
          {"id":"orphan","display_name":"Orphan","package":"x","llm_backend":"anthropic"}
        ]"#;
        let rows = parse_agents_json(json).unwrap();
        assert_eq!(rows.len(), 3);

        let r = &rows[0];
        assert_eq!(r.agent_id, "researcher");
        let caps = r.effective.as_ref().unwrap();
        assert_eq!(caps[0].kind, "fs.read");
        assert_eq!(
            caps[0].allow_paths.as_deref(),
            Some(&["./src/**".to_string()][..])
        );
        assert_eq!(caps[1].max_bytes, Some(1_048_576));

        assert_eq!(rows[1].effective, Some(vec![])); // sandboxed to nothing
        assert_eq!(rows[2].effective, None); // package not installed
    }

    #[test]
    fn rejects_non_array_json() {
        assert!(parse_agents_json("not json").is_err());
    }

    #[test]
    fn mock_is_deterministic_and_covers_three_states() {
        let a = MockCaps.agent_capabilities().unwrap();
        let b = MockCaps.agent_capabilities().unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 4);
        assert!(!a[0].effective.as_ref().unwrap().is_empty()); // populated
        assert_eq!(a[2].effective, Some(vec![])); // empty
        assert_eq!(a[3].effective, None); // package not installed
    }

    #[test]
    fn rejects_wrong_shape_json() {
        // valid JSON, wrong shape — `id` must be a string.
        assert!(parse_agents_json(r#"[{"id":42}]"#).is_err());
    }
}
