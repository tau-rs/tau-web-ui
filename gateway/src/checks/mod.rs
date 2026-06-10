//! Verify / Health checks: a `tau check` report (findings over categories +
//! sandbox diagnostics). `MockChecks` fabricates a deterministic report;
//! `CliChecks` shells `tau check --json` and parses its JSONL.

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FindingLocation {
    pub path: String,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckFinding {
    pub category: String, // config|lockfile|packages|sandbox|plugins|skills
    pub severity: String, // error | needs-setup | warning
    pub rule: String,     // tau's rule_id
    pub summary: String,
    pub detail: Option<String>,
    pub remediation: Option<String>,
    pub location: Option<FindingLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CategoryStatus {
    pub name: String,
    pub errors: u32,
    pub warnings: u32,
    pub needs_setup: u32, // pass = all zero
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SandboxDiag {
    pub tier: String,
    pub status: String,
    pub no_sandbox: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckReport {
    pub categories: Vec<CategoryStatus>,
    pub findings: Vec<CheckFinding>,
    pub sandbox: SandboxDiag,
}

/// Source of the check report: `MockChecks` (deterministic) or `CliChecks`
/// (shells `tau check --json`).
pub trait CheckSource: Send + Sync {
    fn report(&self) -> CheckReport;
}

fn cat(name: &str, errors: u32, warnings: u32, needs_setup: u32) -> CategoryStatus {
    CategoryStatus {
        name: name.into(),
        errors,
        warnings,
        needs_setup,
    }
}

fn finding(
    category: &str,
    severity: &str,
    rule: &str,
    summary: &str,
    remediation: Option<&str>,
    location: Option<(&str, Option<u32>)>,
) -> CheckFinding {
    CheckFinding {
        category: category.into(),
        severity: severity.into(),
        rule: rule.into(),
        summary: summary.into(),
        detail: None,
        remediation: remediation.map(|s| s.to_string()),
        location: location.map(|(p, l)| FindingLocation {
            path: p.into(),
            line: l,
        }),
    }
}

pub struct MockChecks;

impl CheckSource for MockChecks {
    fn report(&self) -> CheckReport {
        CheckReport {
            categories: vec![
                cat("config", 1, 0, 0),
                cat("lockfile", 0, 0, 1),
                cat("packages", 0, 0, 0),
                cat("sandbox", 0, 0, 0),
                cat("plugins", 0, 0, 0),
                cat("skills", 0, 0, 0),
            ],
            findings: vec![
                finding(
                    "config",
                    "error",
                    "tau.config.endpoint",
                    "inference.endpoint not set",
                    Some("set inference.endpoint in tau.toml"),
                    Some(("tau.toml", Some(3))),
                ),
                finding(
                    "lockfile",
                    "needs-setup",
                    "tau.lockfile.missing",
                    "no lockfile — packages not installed",
                    Some("run `tau install`"),
                    None,
                ),
            ],
            sandbox: SandboxDiag {
                tier: "seatbelt".into(),
                status: "ready".into(),
                no_sandbox: false,
            },
        }
    }
}

/// Parse the JSONL emitted by `tau check --json` into a CheckReport.
/// `no_sandbox` is the gateway's own flag (tau check does not report it).
fn parse_check_jsonl(stdout: &str, no_sandbox: bool) -> CheckReport {
    let mut categories: Vec<CategoryStatus> = Vec::new();
    let mut findings: Vec<CheckFinding> = Vec::new();
    let mut sandbox = SandboxDiag {
        tier: "unknown".into(),
        status: "unknown".into(),
        no_sandbox,
    };
    for line in stdout.lines().filter(|l| !l.trim().is_empty()) {
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("check_finished") {
            continue;
        }
        let name = v["category"].as_str().unwrap_or("").to_string();
        let (mut errors, mut warnings, mut needs_setup) = (0u32, 0u32, 0u32);
        for fv in v["findings"].as_array().into_iter().flatten() {
            let severity = fv["severity"].as_str().unwrap_or("warning").to_string();
            match severity.as_str() {
                "error" => errors += 1,
                "needs-setup" => needs_setup += 1,
                _ => warnings += 1,
            }
            let location =
                fv.get("location")
                    .and_then(|l| l.as_object())
                    .map(|l| FindingLocation {
                        path: l
                            .get("path")
                            .and_then(|p| p.as_str())
                            .unwrap_or("")
                            .to_string(),
                        line: l.get("line").and_then(|n| n.as_u64()).map(|n| n as u32),
                    });
            findings.push(CheckFinding {
                category: name.clone(),
                severity,
                rule: fv["rule_id"].as_str().unwrap_or("").to_string(),
                summary: fv["summary"].as_str().unwrap_or("").to_string(),
                detail: fv.get("detail").and_then(|d| d.as_str()).map(String::from),
                remediation: fv
                    .get("remediation")
                    .and_then(|r| r.as_str())
                    .map(String::from),
                location,
            });
        }
        if name == "sandbox" {
            sandbox.status = match &v["status"] {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Object(_) => "skipped".to_string(),
                _ => "unknown".to_string(),
            };
            if let Some(t) = v["findings"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|f| f["structured"].get("tier"))
                .and_then(|t| t.as_str())
            {
                sandbox.tier = t.to_string();
            }
        }
        categories.push(CategoryStatus {
            name,
            errors,
            warnings,
            needs_setup,
        });
    }
    CheckReport {
        categories,
        findings,
        sandbox,
    }
}

/// Shells `tau check --json` and parses the result. Non-zero exit (findings) is data.
pub struct CliChecks {
    bin: PathBuf,
    project: PathBuf,
    no_sandbox: bool,
}

impl CliChecks {
    pub fn new(bin: PathBuf, project: PathBuf, no_sandbox: bool) -> Self {
        Self {
            bin,
            project,
            no_sandbox,
        }
    }
}

impl CheckSource for CliChecks {
    fn report(&self) -> CheckReport {
        let out = Command::new(&self.bin)
            .arg("check")
            .arg("--json")
            .arg("--project")
            .arg(&self.project)
            .output();
        match out {
            Ok(out) => parse_check_jsonl(&String::from_utf8_lossy(&out.stdout), self.no_sandbox),
            Err(e) => CheckReport {
                categories: vec![],
                findings: vec![CheckFinding {
                    category: "config".into(),
                    severity: "error".into(),
                    rule: "gateway.tau.spawn".into(),
                    summary: format!("could not run `tau check`: {e}"),
                    detail: None,
                    remediation: Some("check the tau binary path".into()),
                    location: None,
                }],
                sandbox: SandboxDiag {
                    tier: "unknown".into(),
                    status: "unknown".into(),
                    no_sandbox: self.no_sandbox,
                },
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_report_seeds_categories_and_findings() {
        let r = MockChecks.report();
        let names: Vec<&str> = r.categories.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["config", "lockfile", "packages", "sandbox", "plugins", "skills"]
        );
        let config = r.categories.iter().find(|c| c.name == "config").unwrap();
        assert_eq!(config.errors, 1);
        let lock = r.categories.iter().find(|c| c.name == "lockfile").unwrap();
        assert_eq!((lock.errors, lock.warnings, lock.needs_setup), (0, 0, 1));
        let err = r.findings.iter().find(|f| f.severity == "error").unwrap();
        assert_eq!(err.rule, "tau.config.endpoint");
        assert_eq!(err.location.as_ref().unwrap().path, "tau.toml");
        assert!(r.findings.iter().any(|f| f.severity == "needs-setup"));
        assert!(err.remediation.is_some());
        assert_eq!(r.sandbox.tier, "seatbelt");
    }

    // cli_checks_is_empty removed: CliChecks now requires constructor args + shells out.
    // Parser behaviour is covered by parse_check_jsonl_maps_findings_and_categories below.

    #[test]
    fn parse_check_jsonl_maps_findings_and_categories() {
        let jsonl = include_str!("../../tests/fixtures/tau-json/check-demo.jsonl");
        let report = parse_check_jsonl(jsonl, false);
        let config = report
            .categories
            .iter()
            .find(|c| c.name == "config")
            .unwrap();
        assert_eq!(
            (config.errors, config.warnings, config.needs_setup),
            (1, 0, 0)
        );
        let f = report
            .findings
            .iter()
            .find(|f| f.severity == "error")
            .unwrap();
        assert_eq!(f.rule, "tau.config.invalid");
        assert_eq!(f.category, "config");
        assert_eq!(f.location.as_ref().unwrap().path, "/p/tau.toml");
        assert_eq!(
            f.remediation.as_deref(),
            Some("fix tau.toml per the error message above")
        );
        assert_eq!(report.categories.len(), 6);
        assert!(!report.sandbox.no_sandbox);
    }
}
