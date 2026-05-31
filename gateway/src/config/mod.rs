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
    pub source: String,
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
            let llm_backend = v
                .get("llm_backend")
                .and_then(|x| x.as_str())
                .map(String::from);
            let package = v.get("package").and_then(|x| x.as_str()).map(String::from);
            let source = source_of(package.as_deref());
            agents.push(AgentInfo {
                id: id.clone(),
                llm_backend,
                package,
                source,
            });
        }
        agents.sort_by(|a, b| a.id.cmp(&b.id));
    }
    Ok(ProjectConfig {
        name,
        description,
        agents,
    })
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
        assert_eq!(c.agents.len(), 1);
    }

    #[test]
    fn add_agent_registers_a_runnable_agent() {
        let d = tempfile::tempdir().unwrap();
        write_fixture(d.path());
        add_agent(
            d.path(),
            "researcher-pro",
            "researcher-pro",
            "researcher-pro@^1.0",
            "anthropic",
        )
        .unwrap();
        let c = read(d.path()).unwrap();
        let a = c.agents.iter().find(|a| a.id == "researcher-pro").unwrap();
        assert_eq!(a.package.as_deref(), Some("researcher-pro@^1.0"));
        assert_eq!(a.llm_backend.as_deref(), Some("anthropic"));
    }
}
