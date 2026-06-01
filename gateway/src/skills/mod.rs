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

/// Create/update a local skill's files. `editable`/`source` on the detail are
/// ignored for writing (a written skill is always local). Validates the name.
pub fn write_local(project: &Path, detail: &SkillDetail) -> Result<()> {
    if !valid_skill_name(&detail.name) {
        bail!("invalid skill name: {}", detail.name);
    }
    let dir = skills_dir(project).join(&detail.name);
    std::fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;

    std::fs::write(
        dir.join("SKILL.md"),
        render_skill_md(&detail.name, detail.description.as_deref(), &detail.content),
    )?;

    let mut doc = toml_edit::DocumentMut::new();
    doc["name"] = toml_edit::value(detail.name.as_str());
    doc["version"] = toml_edit::value(detail.version.as_deref().unwrap_or("0.1.0"));
    if let Some(d) = detail.description.as_deref() {
        doc["description"] = toml_edit::value(d);
    }
    doc["authors"] = toml_edit::Item::Value(toml_edit::Array::new().into());
    doc["source"] = toml_edit::value(format!("local://{}", detail.name));
    doc["kind"] = toml_edit::value("skill");
    doc["dependencies"] = toml_edit::Item::Value(toml_edit::Array::new().into());

    // [[capabilities]]
    let mut caps = toml_edit::ArrayOfTables::new();
    for c in &detail.capabilities {
        let mut t = toml_edit::Table::new();
        t["kind"] = toml_edit::value(c.kind.as_str());
        for (param, list) in &c.fields {
            let mut arr = toml_edit::Array::new();
            for v in list {
                arr.push(v.as_str());
            }
            t[param] = toml_edit::Item::Value(arr.into());
        }
        caps.push(t);
    }
    doc["capabilities"] = toml_edit::Item::ArrayOfTables(caps);

    // [skill] with requires arrays
    let mut skill_tbl = toml_edit::Table::new();
    skill_tbl.set_implicit(true);
    if !detail.requires_tools.is_empty() {
        skill_tbl["requires_tools"] = toml_edit::Item::ArrayOfTables(deps_to_aot(&detail.requires_tools));
    }
    if !detail.requires_skills.is_empty() {
        skill_tbl["requires_skills"] = toml_edit::Item::ArrayOfTables(deps_to_aot(&detail.requires_skills));
    }
    doc["skill"] = toml_edit::Item::Table(skill_tbl);

    std::fs::write(dir.join("tau.toml"), doc.to_string())?;
    Ok(())
}

fn deps_to_aot(deps: &[PackageDep]) -> toml_edit::ArrayOfTables {
    let mut aot = toml_edit::ArrayOfTables::new();
    for d in deps {
        let mut t = toml_edit::Table::new();
        t["name"] = toml_edit::value(d.name.as_str());
        t["source"] = toml_edit::value(d.source.as_str());
        if let Some(v) = d.version.as_deref().filter(|s| !s.is_empty()) {
            t["version"] = toml_edit::value(v);
        }
        aot.push(t);
    }
    aot
}

/// Remove a local skill dir. Returns false if absent.
pub fn delete_local(project: &Path, name: &str) -> Result<bool> {
    let dir = skills_dir(project).join(name);
    if !dir.join("SKILL.md").exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&dir).with_context(|| format!("remove {}", dir.display()))?;
    Ok(true)
}

/// Installed (non-editable) skills: a seam over real `tau` (kind="skill" packages
/// + `tau install`). The mock seeds one; the CLI seam is not exercised in v1.
pub trait InstalledSkills: Send + Sync {
    fn list(&self) -> Vec<SkillSummary>;
    fn read(&self, name: &str) -> Option<SkillDetail>;
    fn import(&self, git_url: &str) -> Result<String>;
}

pub struct MockInstalled {
    skills: std::sync::Mutex<Vec<SkillDetail>>,
}

impl MockInstalled {
    pub fn new() -> Self {
        MockInstalled {
            skills: std::sync::Mutex::new(vec![SkillDetail {
                name: "web-search".into(),
                description: Some("Search the web.".into()),
                version: Some("1.2.0".into()),
                source: "github.com/tau/web-search".into(),
                editable: false,
                content: "You can search the web.".into(),
                capabilities: vec![Capability {
                    kind: "net.http".into(),
                    fields: BTreeMap::from([("hosts".to_string(), vec!["*".to_string()])]),
                }],
                requires_tools: vec![],
                requires_skills: vec![],
            }]),
        }
    }
}

impl Default for MockInstalled {
    fn default() -> Self {
        Self::new()
    }
}

impl InstalledSkills for MockInstalled {
    fn list(&self) -> Vec<SkillSummary> {
        self.skills.lock().unwrap().iter().map(summary_of).collect()
    }
    fn read(&self, name: &str) -> Option<SkillDetail> {
        self.skills.lock().unwrap().iter().find(|s| s.name == name).cloned()
    }
    fn import(&self, git_url: &str) -> Result<String> {
        let name = crate::packages::name_from_url(git_url);
        let mut list = self.skills.lock().unwrap();
        if !list.iter().any(|s| s.name == name) {
            list.push(SkillDetail {
                name: name.clone(),
                description: Some("Imported skill.".into()),
                version: Some("1.0.0".into()),
                source: git_url.to_string(),
                editable: false,
                content: String::new(),
                capabilities: vec![],
                requires_tools: vec![],
                requires_skills: vec![],
            });
        }
        Ok(name)
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliInstalled;

impl InstalledSkills for CliInstalled {
    fn list(&self) -> Vec<SkillSummary> {
        vec![]
    }
    fn read(&self, _name: &str) -> Option<SkillDetail> {
        None
    }
    fn import(&self, _git_url: &str) -> Result<String> {
        bail!("skill import requires a real tau binary")
    }
}

/// Compose local + installed for the public surface.
pub fn list(project: &Path, installed: &dyn InstalledSkills) -> Vec<SkillSummary> {
    let mut out = list_local(project);
    out.extend(installed.list());
    out
}

pub fn read(project: &Path, name: &str, installed: &dyn InstalledSkills) -> Result<Option<SkillDetail>> {
    if let Some(local) = read_local(project, name)? {
        return Ok(Some(local));
    }
    Ok(installed.read(name))
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

    #[test]
    fn write_then_read_roundtrips() {
        let d = tempfile::tempdir().unwrap();
        let detail = SkillDetail {
            name: "summariser".into(),
            description: Some("Summarises text.".into()),
            version: Some("0.2.0".into()),
            source: "ignored".into(),
            editable: true,
            content: "You summarise.".into(),
            capabilities: vec![Capability {
                kind: "net.http".into(),
                fields: BTreeMap::from([
                    ("hosts".to_string(), vec!["api.example.com".to_string()]),
                    ("methods".to_string(), vec!["GET".to_string()]),
                ]),
            }],
            requires_tools: vec![PackageDep {
                name: "web-search".into(),
                source: "https://x/web.git".into(),
                version: Some("^1".into()),
            }],
            requires_skills: vec![],
        };
        write_local(d.path(), &detail).unwrap();

        let back = read_local(d.path(), "summariser").unwrap().unwrap();
        assert_eq!(back.description.as_deref(), Some("Summarises text."));
        assert_eq!(back.version.as_deref(), Some("0.2.0"));
        assert_eq!(back.content.trim(), "You summarise.");
        assert_eq!(back.capabilities[0].kind, "net.http");
        assert_eq!(back.capabilities[0].fields["hosts"], vec!["api.example.com"]);
        assert_eq!(back.capabilities[0].fields["methods"], vec!["GET"]);
        assert_eq!(back.requires_tools[0].name, "web-search");

        assert!(delete_local(d.path(), "summariser").unwrap());
        assert!(read_local(d.path(), "summariser").unwrap().is_none());
        assert!(!delete_local(d.path(), "summariser").unwrap());

        let mut bad = detail.clone();
        bad.name = "Bad Name".into();
        assert!(write_local(d.path(), &bad).is_err());
    }

    #[test]
    fn compose_local_and_installed() {
        let inst = MockInstalled::new();
        let p = demo();
        let all = list(&p, &inst);
        let names: Vec<&str> = all.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"critic")); // local
        assert!(names.contains(&"web-search")); // installed
        let ws = all.iter().find(|s| s.name == "web-search").unwrap();
        assert!(!ws.editable);

        let r = read(&p, "web-search", &inst).unwrap().unwrap();
        assert!(!r.editable);
        let n = inst.import("https://github.com/acme/translator.git").unwrap();
        assert_eq!(n, "translator");
        assert!(inst.read("translator").is_some());
    }
}
