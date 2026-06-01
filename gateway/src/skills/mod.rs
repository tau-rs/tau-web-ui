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
