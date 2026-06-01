//! Tools view: a read-only catalog of tool packages (kind="tool") plus a
//! per-project `used_by`, computed from the project's agents + local skills.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::skills::Capability;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolUser {
    pub kind: String, // "agent" | "skill"
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolDetail {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub provides: String,
    pub plugin_kind: Option<String>,
    pub binary: Option<String>,
    pub capabilities: Vec<Capability>,
    pub used_by: Vec<ToolUser>,
}

/// Source of the tool catalog (used_by left empty; filled by `list_tools`).
pub trait ToolsSource: Send + Sync {
    fn catalog(&self) -> Vec<ToolDetail>;
}

pub struct MockTools;

impl ToolsSource for MockTools {
    fn catalog(&self) -> Vec<ToolDetail> {
        let cap = |kind: &str, param: &str, vals: &[&str]| Capability {
            kind: kind.into(),
            fields: BTreeMap::from([(
                param.to_string(),
                vals.iter().map(|s| s.to_string()).collect(),
            )]),
        };
        let tool = |name: &str, version: &str, c: Capability| ToolDetail {
            name: name.into(),
            version: Some(version.into()),
            source: format!("github.com/tau/{name}"),
            provides: "tool".into(),
            plugin_kind: Some("rust-cargo".into()),
            binary: Some(name.into()),
            capabilities: vec![c],
            used_by: vec![],
        };
        vec![
            tool("fs-read", "1.0.0", cap("fs.read", "paths", &["${WORKDIR}/**"])),
            tool("shell", "0.2.0", cap("process.spawn", "commands", &["sh"])),
            tool("web-search", "1.2.0", cap("net.http", "hosts", &["*"])),
        ]
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliTools;

impl ToolsSource for CliTools {
    fn catalog(&self) -> Vec<ToolDetail> {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_catalog_seeds_three_tools() {
        let cat = MockTools.catalog();
        let names: Vec<&str> = cat.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["fs-read", "shell", "web-search"]);
        let fsr = &cat[0];
        assert_eq!(fsr.provides, "tool");
        assert_eq!(fsr.plugin_kind.as_deref(), Some("rust-cargo"));
        assert_eq!(fsr.capabilities[0].kind, "fs.read");
        assert!(fsr.used_by.is_empty()); // filled by list_tools
        assert!(CliTools.catalog().is_empty());
    }
}
