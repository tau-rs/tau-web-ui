//! PackageOps: mock-first package management. `MockOps` keeps an in-memory list and
//! mutates it; `CliOps` is the seam for real `tau install/list/verify --json`.

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Package {
    pub name: String,
    pub version: String,
    pub source: String,
    pub scope: String, // "project" | "global"
    pub version_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerifyResult {
    pub name: String,
    pub status: String,
}

/// Derive a package/agent id from a git URL: last path segment minus `.git`.
pub fn name_from_url(git_url: &str) -> String {
    git_url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("package")
        .trim_end_matches(".git")
        .to_string()
}

fn source_from_url(git_url: &str) -> String {
    git_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches(".git")
        .to_string()
}

pub trait PackageOps: Send + Sync {
    fn list(&self) -> Vec<Package>;
    fn install(&self, git_url: &str) -> Result<Package>;
    fn uninstall(&self, name: &str) -> Result<()>;
    fn update(&self, name: &str, to: Option<String>) -> Result<Package>;
    fn resolve(&self) -> Result<Vec<Package>>;
    fn verify(&self) -> Vec<VerifyResult>;
}

pub struct MockOps {
    pkgs: Mutex<Vec<Package>>,
}

impl MockOps {
    pub fn new() -> Self {
        let seed = |name: &str, version: &str| Package {
            name: name.into(),
            version: version.into(),
            source: format!("github.com/tau/{name}"),
            scope: "project".into(),
            version_count: 1,
        };
        MockOps {
            pkgs: Mutex::new(vec![
                seed("anthropic", "0.1.0"),
                seed("fs-read", "1.0.0"),
                seed("shell", "0.2.0"),
            ]),
        }
    }
}

impl Default for MockOps {
    fn default() -> Self {
        Self::new()
    }
}

impl PackageOps for MockOps {
    fn list(&self) -> Vec<Package> {
        self.pkgs.lock().unwrap().clone()
    }
    fn install(&self, git_url: &str) -> Result<Package> {
        let name = name_from_url(git_url);
        let pkg = Package {
            name: name.clone(),
            version: "1.0.0".into(),
            source: source_from_url(git_url),
            scope: "project".into(),
            version_count: 1,
        };
        let mut list = self.pkgs.lock().unwrap();
        if !list.iter().any(|p| p.name == name) {
            list.push(pkg.clone());
        }
        Ok(pkg)
    }
    fn uninstall(&self, name: &str) -> Result<()> {
        self.pkgs.lock().unwrap().retain(|p| p.name != name);
        Ok(())
    }
    fn update(&self, name: &str, to: Option<String>) -> Result<Package> {
        let mut list = self.pkgs.lock().unwrap();
        let p = list
            .iter_mut()
            .find(|p| p.name == name)
            .ok_or_else(|| anyhow!("no such package: {name}"))?;
        p.version = to.unwrap_or_else(|| "1.0.1".into());
        Ok(p.clone())
    }
    fn resolve(&self) -> Result<Vec<Package>> {
        Ok(self.list())
    }
    fn verify(&self) -> Vec<VerifyResult> {
        self.list()
            .into_iter()
            .map(|p| VerifyResult {
                name: p.name,
                status: "ok".into(),
            })
            .collect()
    }
}

fn parse_list_json(stdout: &str) -> Vec<Package> {
    serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim())
        .unwrap_or_default()
        .into_iter()
        .map(|v| Package {
            name: v["name"].as_str().unwrap_or("").to_string(),
            version: v["version"].as_str().unwrap_or("").to_string(),
            source: v["source"].as_str().unwrap_or("").to_string(),
            scope: v["scope"].as_str().unwrap_or("").to_string(),
            version_count: v["version_count"].as_u64().unwrap_or(0) as u32,
        })
        .collect()
}

fn parse_verify_jsonl(stdout: &str) -> Vec<VerifyResult> {
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v.get("event").and_then(|e| e.as_str()) == Some("verify_package"))
        .map(|v| VerifyResult {
            name: v["name"].as_str().unwrap_or("").to_string(),
            status: v["status"].as_str().unwrap_or("unverified").to_string(),
        })
        .collect()
}

/// Seam: shell real `tau install/list/verify --json`. Not wired in v1 (mock covers
/// fake-tau-serve). list/verify return empty; mutations return a graceful error.
pub struct CliOps {
    bin: PathBuf,
    project: PathBuf,
}

impl CliOps {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        CliOps { bin, project }
    }

    /// Run a tau subcommand in the project dir; returns (success, stdout, stderr).
    fn run(&self, args: &[&str]) -> (bool, String, String) {
        match Command::new(&self.bin).args(args).current_dir(&self.project).output() {
            Ok(o) => (
                o.status.success(),
                String::from_utf8_lossy(&o.stdout).into_owned(),
                String::from_utf8_lossy(&o.stderr).into_owned(),
            ),
            Err(e) => (false, String::new(), e.to_string()),
        }
    }
}

impl PackageOps for CliOps {
    fn list(&self) -> Vec<Package> {
        let (_, out, _) = self.run(&["list", "packages", "--json"]);
        parse_list_json(&out)
    }
    fn install(&self, _git_url: &str) -> Result<Package> {
        Err(anyhow!(
            "real-tau package install not wired yet (use the tau CLI)"
        ))
    }
    fn uninstall(&self, _name: &str) -> Result<()> {
        Err(anyhow!("real-tau uninstall not wired yet"))
    }
    fn update(&self, _name: &str, _to: Option<String>) -> Result<Package> {
        Err(anyhow!("real-tau update not wired yet"))
    }
    fn resolve(&self) -> Result<Vec<Package>> {
        let (ok, _, err) = self.run(&["resolve"]);
        if !ok {
            return Err(anyhow!("tau resolve failed: {}", err.trim()));
        }
        Ok(self.list())
    }
    fn verify(&self) -> Vec<VerifyResult> {
        // Exit code 2 (drift present) is data, not failure — parse stdout regardless.
        let (_, out, _) = self.run(&["verify", "--json"]);
        parse_verify_jsonl(&out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_from_url_strips_git() {
        assert_eq!(
            name_from_url("https://github.com/acme/researcher-pro.git"),
            "researcher-pro"
        );
    }

    #[test]
    fn parse_list_json_maps_packages() {
        let json = include_str!("../../tests/fixtures/tau-json/pkg-list.json");
        let pkgs = parse_list_json(json);
        assert_eq!(pkgs.len(), 1);
        assert_eq!(pkgs[0].name, "demo-skill");
        assert_eq!(pkgs[0].version, "0.1.0");
        assert_eq!(pkgs[0].scope, "global");
        assert_eq!(pkgs[0].version_count, 1);
    }

    #[test]
    fn parse_verify_jsonl_keeps_package_events() {
        let jsonl = include_str!("../../tests/fixtures/tau-json/pkg-verify.jsonl");
        let results = parse_verify_jsonl(jsonl);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "demo-skill");
        assert_eq!(results[0].status, "ok");
    }

    #[test]
    fn mock_list_install_uninstall_verify() {
        let ops = MockOps::new();
        assert_eq!(ops.list().len(), 3);
        let p = ops.install("https://github.com/acme/cooltool.git").unwrap();
        assert_eq!(p.name, "cooltool");
        assert_eq!(p.scope, "project");
        assert_eq!(p.version_count, 1);
        assert_eq!(ops.list().len(), 4);
        ops.uninstall("cooltool").unwrap();
        assert_eq!(ops.list().len(), 3);
        assert!(ops.verify().iter().all(|v| v.status == "ok"));
        let u = ops.update("anthropic", Some("0.2.0".into())).unwrap();
        assert_eq!(u.version, "0.2.0");
    }
}
