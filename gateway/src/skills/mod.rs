//! Skill authoring: local skills are real files under `<project>/skills/<name>/`
//! (SKILL.md + tau.toml kind="skill"); installed skills come from a seam.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Capability {
    pub kind: String,
    pub fields: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PackageDep {
    pub name: String,
    pub source: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SkillSummary {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub editable: bool,
    pub capability_kinds: Vec<String>,
    pub requires_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SkillDetail {
    pub name: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub source: String,
    pub editable: bool,
    pub content: String,
    pub capabilities: Vec<Capability>,
    pub requires_tools: Vec<PackageDep>,
    pub requires_skills: Vec<PackageDep>,
}

/// `^[a-z0-9-]+$` and non-empty.
pub fn valid_skill_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Parse SKILL.md: (name, description, body). Frontmatter is the YAML-ish block
/// between the first two `---` fences; only name/description are read.
fn parse_skill_md(text: &str) -> (Option<String>, Option<String>, String) {
    if !text.trim_start().starts_with("---") {
        return (None, None, text.to_string());
    }
    let mut parts = text.splitn(3, "---");
    let _before = parts.next();
    match (parts.next(), parts.next()) {
        (Some(front), Some(body)) => {
            let mut name = None;
            let mut description = None;
            for line in front.lines() {
                let l = line.trim();
                if let Some(v) = l.strip_prefix("name:") {
                    name = Some(v.trim().to_string());
                } else if let Some(v) = l.strip_prefix("description:") {
                    description = Some(v.trim().to_string());
                }
            }
            (name, description, body.trim_start_matches('\n').to_string())
        }
        _ => (None, None, text.to_string()),
    }
}

fn render_skill_md(name: &str, description: Option<&str>, body: &str) -> String {
    format!(
        "---\nname: {name}\ndescription: {desc}\n---\n{body}\n",
        desc = description.unwrap_or("")
    )
}

fn skills_dir(project: &Path) -> std::path::PathBuf {
    project.join("skills")
}

/// Read one local skill (None if its dir/SKILL.md is absent).
pub fn read_local(project: &Path, name: &str) -> Result<Option<SkillDetail>> {
    let dir = skills_dir(project).join(name);
    let md_path = dir.join("SKILL.md");
    if !md_path.exists() {
        return Ok(None);
    }
    let md = std::fs::read_to_string(&md_path)?;
    let (md_name, description, content) = parse_skill_md(&md);
    let toml_text = std::fs::read_to_string(dir.join("tau.toml")).unwrap_or_default();
    let doc: toml::Value = toml::from_str(&toml_text).unwrap_or(toml::Value::Table(Default::default()));

    let version = doc.get("version").and_then(|v| v.as_str()).map(String::from);
    let source = doc
        .get("source")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| format!("local://{name}"));

    let capabilities = doc
        .get("capabilities")
        .and_then(|c| c.as_array())
        .map(|arr| arr.iter().filter_map(cap_from_value).collect())
        .unwrap_or_default();

    let requires_tools = deps_from(doc.get("skill").and_then(|s| s.get("requires_tools")));
    let requires_skills = deps_from(doc.get("skill").and_then(|s| s.get("requires_skills")));

    Ok(Some(SkillDetail {
        name: md_name.unwrap_or_else(|| name.to_string()),
        description,
        version,
        source,
        editable: true,
        content,
        capabilities,
        requires_tools,
        requires_skills,
    }))
}

fn cap_from_value(v: &toml::Value) -> Option<Capability> {
    let kind = v.get("kind")?.as_str()?.to_string();
    let mut fields = BTreeMap::new();
    if let Some(tbl) = v.as_table() {
        for (k, val) in tbl {
            if k == "kind" {
                continue;
            }
            if let Some(arr) = val.as_array() {
                let list: Vec<String> = arr.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                fields.insert(k.clone(), list);
            }
        }
    }
    Some(Capability { kind, fields })
}

fn deps_from(v: Option<&toml::Value>) -> Vec<PackageDep> {
    v.and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|d| {
                    Some(PackageDep {
                        name: d.get("name")?.as_str()?.to_string(),
                        source: d.get("source").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                        version: d.get("version").and_then(|s| s.as_str()).map(String::from),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// List local skills (each dir under `<project>/skills/` with a SKILL.md).
pub fn list_local(project: &Path) -> Vec<SkillSummary> {
    let mut out = vec![];
    let dir = skills_dir(project);
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Ok(Some(d)) = read_local(project, &name) {
                out.push(summary_of(&d));
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn summary_of(d: &SkillDetail) -> SkillSummary {
    SkillSummary {
        name: d.name.clone(),
        version: d.version.clone(),
        source: d.source.clone(),
        editable: d.editable,
        capability_kinds: d.capabilities.iter().map(|c| c.kind.clone()).collect(),
        requires_count: (d.requires_tools.len() + d.requires_skills.len()) as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn demo() -> std::path::PathBuf {
        let mut p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.pop();
        p.push("fixtures/demo");
        p
    }

    #[test]
    fn reads_seeded_local_skills() {
        let p = demo();
        let critic = read_local(&p, "critic").unwrap().unwrap();
        assert_eq!(critic.name, "critic");
        assert!(critic.editable);
        assert!(critic.content.contains("writing critic"));
        assert_eq!(critic.requires_tools.len(), 1);
        assert_eq!(critic.requires_tools[0].name, "fs-read");

        let fc = read_local(&p, "fact-checker").unwrap().unwrap();
        assert_eq!(fc.capabilities.len(), 1);
        assert_eq!(fc.capabilities[0].kind, "fs.read");
        assert_eq!(fc.capabilities[0].fields["paths"], vec!["${SKILL_DIR}/references/**"]);

        let names: Vec<String> = list_local(&p).into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"critic".to_string()));
        assert!(names.contains(&"fact-checker".to_string()));

        assert!(read_local(&p, "ghost").unwrap().is_none());
    }

    #[test]
    fn frontmatter_roundtrips() {
        let (n, d, b) = parse_skill_md("---\nname: x\ndescription: d\n---\nbody line\n");
        assert_eq!(n.as_deref(), Some("x"));
        assert_eq!(d.as_deref(), Some("d"));
        assert_eq!(b.trim(), "body line");
        let rendered = render_skill_md("x", Some("d"), "body line");
        let (n2, _, _) = parse_skill_md(&rendered);
        assert_eq!(n2.as_deref(), Some("x"));
    }
}
