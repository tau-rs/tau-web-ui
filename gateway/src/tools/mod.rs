//! Tools view: a read-only catalog of tool packages (kind="tool") plus a
//! per-project `used_by`, computed from the project's agents + local skills.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::introspect::{Classified, PluginInfo, PluginIntrospector};
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolCatalog {
    pub tools: Vec<ToolDetail>,
    /// Count of plugins that failed to introspect; detail lives on the Plugins tab.
    pub error_count: u32,
}

/// Source of the tool catalog (used_by left empty; filled by `list_tools`).
pub trait ToolsSource: Send + Sync {
    fn catalog(&self) -> ToolCatalog;
}

pub struct MockTools;

impl ToolsSource for MockTools {
    fn catalog(&self) -> ToolCatalog {
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
        let tools = vec![
            tool(
                "fs-read",
                "1.0.0",
                cap("fs.read", "paths", &["${WORKDIR}/**"]),
            ),
            tool("shell", "0.2.0", cap("process.spawn", "commands", &["sh"])),
            tool("web-search", "1.2.0", cap("net.http", "hosts", &["*"])),
        ];
        ToolCatalog {
            tools,
            error_count: 0,
        }
    }
}

/// Build a `ToolDetail` from a Tool-port plugin. Capabilities are empty — describe
/// does not expose them. `used_by` is filled later by `list_tools`.
fn tool_detail_from(info: &PluginInfo) -> ToolDetail {
    ToolDetail {
        name: info.plugin_name.clone(),
        version: info.package_version.clone(),
        source: info.source.clone(),
        provides: "tool".into(),
        plugin_kind: Some(info.kind.clone()),
        binary: Some(info.binary_path.clone()),
        capabilities: vec![],
        used_by: vec![],
    }
}

/// Real-tau tool seam: Tool-port plugins from the shared describe sweep.
pub struct CliTools {
    introspector: Arc<PluginIntrospector>,
}

impl CliTools {
    pub fn new(introspector: Arc<PluginIntrospector>) -> Self {
        CliTools { introspector }
    }
}

impl ToolsSource for CliTools {
    fn catalog(&self) -> ToolCatalog {
        let mut tools = vec![];
        let mut error_count = 0u32;
        for c in self.introspector.sweep() {
            match c {
                Classified::Plugin(info) if info.port == "Tool" => {
                    tools.push(tool_detail_from(&info))
                }
                Classified::Plugin(_) => {} // non-Tool ports → Plugins tab only
                Classified::DataOnly => {}
                Classified::Failed(_) => error_count += 1,
            }
        }
        ToolCatalog { tools, error_count }
    }
}

/// Compose the catalog with per-project `used_by`: scan the project's agents
/// (`requires.tools`) + local skills (`requires_tools`) for each tool name.
pub fn list_tools(project: &Path, source: &dyn ToolsSource) -> ToolCatalog {
    let agents = crate::config::list_agents(project).unwrap_or_default();
    let skills: Vec<_> = crate::skills::list_local(project)
        .iter()
        .filter_map(|s| crate::skills::read_local(project, &s.name).ok().flatten())
        .collect();

    let mut cat = source.catalog();
    for t in &mut cat.tools {
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
    cat
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_catalog_seeds_three_tools() {
        let cat = MockTools.catalog().tools;
        let names: Vec<&str> = cat.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["fs-read", "shell", "web-search"]);
        let fsr = &cat[0];
        assert_eq!(fsr.provides, "tool");
        assert_eq!(fsr.plugin_kind.as_deref(), Some("rust-cargo"));
        assert_eq!(fsr.capabilities[0].kind, "fs.read");
        assert!(fsr.used_by.is_empty()); // filled by list_tools
    }

    fn demo() -> std::path::PathBuf {
        let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.pop();
        p.push("fixtures/demo");
        p
    }

    #[test]
    fn list_tools_computes_used_by_from_demo() {
        let cat = list_tools(&demo(), &MockTools);
        let fsr = cat.tools.iter().find(|t| t.name == "fs-read").unwrap();
        // the seeded `critic` skill requires fs-read
        assert!(fsr
            .used_by
            .iter()
            .any(|u| u.kind == "skill" && u.name == "critic"));
        let shell = cat.tools.iter().find(|t| t.name == "shell").unwrap();
        assert!(shell.used_by.is_empty());
    }

    #[test]
    fn list_tools_computes_used_by_from_agent() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("tau.toml"),
            r#"[project]
name = "t"

[agents.researcher]
display_name = "Researcher"

[[agents.researcher.requires.tools]]
name = "web-search"
source = "https://example.com/web-search.git"
"#,
        )
        .unwrap();
        let cat = list_tools(dir.path(), &MockTools);
        let ws = cat.tools.iter().find(|t| t.name == "web-search").unwrap();
        assert!(ws
            .used_by
            .iter()
            .any(|u| u.kind == "agent" && u.name == "researcher"));
    }
}
