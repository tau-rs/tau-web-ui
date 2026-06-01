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

/// Compose the catalog with per-project `used_by`: scan the project's agents
/// (`requires.tools`) + local skills (`requires_tools`) for each tool name.
pub fn list_tools(project: &Path, source: &dyn ToolsSource) -> Vec<ToolDetail> {
    let agents = crate::config::list_agents(project).unwrap_or_default();
    let skills: Vec<_> = crate::skills::list_local(project)
        .iter()
        .filter_map(|s| crate::skills::read_local(project, &s.name).ok().flatten())
        .collect();

    let mut tools = source.catalog();
    for t in &mut tools {
        let mut users = vec![];
        for a in &agents {
            if a.requires_tools.iter().any(|r| r.name == t.name) {
                users.push(ToolUser {
                    kind: "agent".into(),
                    name: a.id.clone(),
                });
            }
        }
        for s in &skills {
            if s.requires_tools.iter().any(|r| r.name == t.name) {
                users.push(ToolUser {
                    kind: "skill".into(),
                    name: s.name.clone(),
                });
            }
        }
        t.used_by = users;
    }
    tools
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

    fn demo() -> std::path::PathBuf {
        let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.pop();
        p.push("fixtures/demo");
        p
    }

    #[test]
    fn list_tools_computes_used_by_from_demo() {
        let tools = list_tools(&demo(), &MockTools);
        let fsr = tools.iter().find(|t| t.name == "fs-read").unwrap();
        // the seeded `critic` skill requires fs-read
        assert!(fsr.used_by.iter().any(|u| u.kind == "skill" && u.name == "critic"));
        let shell = tools.iter().find(|t| t.name == "shell").unwrap();
        assert!(shell.used_by.is_empty());
    }
}
