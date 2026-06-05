//! LLM providers: a composer over real project data (agents' `llm_backend` +
//! installed package names) yielding the available providers and the recommended
//! one. Shared by the agent editor, the workflow graph nodes, and the Providers
//! screen. Credentials are gated (β.5).

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Provider {
    pub name: String,
    pub installed: bool,          // name is an installed package
    pub recommended: bool,        // name == the resolved recommended backend
    pub source: String,           // "in-use" | "well-known"
    pub credentials_gated: bool,  // true in v1 (β.5)
}

const WELL_KNOWN: &[&str] = &["anthropic", "openai", "local"];

/// The recommended backend: the modal (most frequent) backend across the
/// project's agents, tie-broken by first appearance; `"anthropic"` when none set.
pub fn recommended_backend(agent_backends: &[String]) -> String {
    let mut order: Vec<&str> = vec![];
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for b in agent_backends {
        if b.is_empty() {
            continue;
        }
        let c = counts.entry(b.as_str()).or_insert(0);
        if *c == 0 {
            order.push(b.as_str());
        }
        *c += 1;
    }
    if order.is_empty() {
        return "anthropic".to_string();
    }
    let mut best = order[0];
    let mut best_n = counts[best];
    for &name in &order[1..] {
        if counts[name] > best_n {
            best = name;
            best_n = counts[name];
        }
    }
    best.to_string()
}

/// Available providers = (recommended, then in-use, then well-known), deduped.
/// `installed` reflects package membership; `source` distinguishes in-use vs known.
pub fn list_providers(agent_backends: &[String], package_names: &[String]) -> Vec<Provider> {
    let recommended = recommended_backend(agent_backends);

    let mut in_use: Vec<&str> = vec![];
    let mut in_use_seen = HashSet::new();
    for b in agent_backends {
        if !b.is_empty() && in_use_seen.insert(b.as_str()) {
            in_use.push(b.as_str());
        }
    }

    let mut names: Vec<String> = vec![];
    let mut seen = HashSet::new();
    for n in std::iter::once(recommended.as_str())
        .chain(in_use.iter().copied())
        .chain(WELL_KNOWN.iter().copied())
    {
        if seen.insert(n.to_string()) {
            names.push(n.to_string());
        }
    }

    let pkg: HashSet<&str> = package_names.iter().map(|s| s.as_str()).collect();
    let in_use_set: HashSet<&str> = in_use.iter().copied().collect();
    names
        .into_iter()
        .map(|name| Provider {
            installed: pkg.contains(name.as_str()),
            recommended: name == recommended,
            source: if in_use_set.contains(name.as_str()) {
                "in-use".into()
            } else {
                "well-known".into()
            },
            credentials_gated: true,
            name,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn recommended_is_modal_else_anthropic() {
        assert_eq!(recommended_backend(&[]), "anthropic");
        assert_eq!(
            recommended_backend(&s(&["anthropic", "anthropic", "openai"])),
            "anthropic"
        );
        // tie → first appearance
        assert_eq!(
            recommended_backend(&s(&["openai", "anthropic", "openai", "anthropic"])),
            "openai"
        );
    }

    #[test]
    fn list_marks_installed_recommended_source() {
        let ps = list_providers(&s(&["anthropic", "openai"]), &s(&["anthropic"]));
        let by = |n: &str| ps.iter().find(|p| p.name == n).cloned().unwrap();
        let anthropic = by("anthropic");
        assert!(anthropic.recommended);
        assert!(anthropic.installed);
        assert_eq!(anthropic.source, "in-use");
        assert!(anthropic.credentials_gated);
        let openai = by("openai");
        assert!(!openai.recommended);
        assert!(!openai.installed);
        assert_eq!(openai.source, "in-use");
        let local = by("local");
        assert_eq!(local.source, "well-known");
        // dedup: anthropic/openai counted once
        assert_eq!(ps.iter().filter(|p| p.name == "anthropic").count(), 1);
    }

    #[test]
    fn empty_agents_yields_well_known_with_anthropic_recommended() {
        let ps = list_providers(&[], &s(&["anthropic"]));
        let names: Vec<&str> = ps.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["anthropic", "openai", "local"]);
        assert!(ps[0].recommended); // anthropic
        assert!(ps[0].installed);
    }
}
