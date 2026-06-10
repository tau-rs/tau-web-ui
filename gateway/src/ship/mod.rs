//! Ship / Targets & Build: the compile-target registry, `.tau` bundle builds, and
//! reproducibility verify. `MockShip` fabricates a deterministic catalog; `CliShip`
//! shells real tau (`tau target list` / `tau build` / `tau verify`, all `--json`)
//! and scans the project dir for `*.tau` bundles.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Target {
    pub triple: String,
    pub platform: String,
    pub adapter_family: String,
    pub tier: String,
    pub status: String, // available | reserved | unknown
    pub required_shapes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Bundle {
    pub path: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub built_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BuildRequest {
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerifyRequest {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VerifyOutcome {
    pub reproducible: bool,
    pub shipped_sha256: String,
    pub rebuilt_sha256: String,
    pub diffs: Vec<String>,
}

/// Build failure mapped to HTTP 400 by the handler.
#[derive(Debug)]
pub enum BuildError {
    NeedsProvisioning(String),
    Invalid(String),
    Internal(String),
}

impl std::fmt::Display for BuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BuildError::NeedsProvisioning(m) => write!(f, "project needs `tau install` first: {m}"),
            BuildError::Invalid(m) => write!(f, "build rejected: {m}"),
            BuildError::Internal(m) => write!(f, "build failed: {m}"),
        }
    }
}
impl std::error::Error for BuildError {}

/// Source of targets/bundles + the build action. Mock-first; the CLI path stays
/// empty until tau ships `targets`/`build`.
pub trait ShipSource: Send + Sync {
    fn list_targets(&self) -> Vec<Target>;
    fn list_bundles(&self) -> Vec<Bundle>;
    fn build(&self, target: &str) -> Result<Bundle, BuildError>;
    fn verify(&self, bundle_path: &str) -> Result<VerifyOutcome, BuildError>;
}

/// The fixed target registry mirroring `tau target list --json`.
fn targets() -> Vec<Target> {
    let t = |triple: &str, platform: &str, fam: &str, tier: &str, status: &str| Target {
        triple: triple.into(),
        platform: platform.into(),
        adapter_family: fam.into(),
        tier: tier.into(),
        status: status.into(),
        required_shapes: vec![
            "fs.r".into(),
            "fs.w".into(),
            "exec".into(),
            "net.http".into(),
        ],
    };
    vec![
        t(
            "darwin-native-strict",
            "darwin",
            "native",
            "strict",
            "available",
        ),
        t(
            "linux-native-strict",
            "linux",
            "native",
            "strict",
            "available",
        ),
        t("passthrough", "any", "passthrough", "none", "available"),
        t(
            "windows-native-strict",
            "windows",
            "native",
            "strict",
            "reserved",
        ),
    ]
}

pub struct MockShip {
    project: String,
    bundles: Mutex<Vec<Bundle>>,
}

impl MockShip {
    pub fn new(project: String) -> Self {
        let artifact = format!("{project}.tau");
        let seed = |size: u64, built_at: &str| Bundle {
            path: artifact.clone(),
            sha256: "9f3c1a2b7e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b".into(),
            size_bytes: size,
            built_at: Some(built_at.into()),
        };
        MockShip {
            project,
            bundles: Mutex::new(vec![seed(2_456_789, "2m ago"), seed(2_310_004, "1d ago")]),
        }
    }
}

impl ShipSource for MockShip {
    fn list_targets(&self) -> Vec<Target> {
        targets()
    }
    fn list_bundles(&self) -> Vec<Bundle> {
        self.bundles.lock().unwrap().clone()
    }
    fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        let t = targets()
            .into_iter()
            .find(|t| t.triple == target)
            .ok_or_else(|| BuildError::Invalid(format!("unknown target '{target}'")))?;
        if t.status != "available" {
            return Err(BuildError::Invalid(format!(
                "target '{target}' is {}",
                t.status
            )));
        }
        let bundle = Bundle {
            path: format!("{}.tau", self.project),
            sha256: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b".into(),
            size_bytes: 2_460_512,
            built_at: Some("just now".into()),
        };
        self.bundles.lock().unwrap().insert(0, bundle.clone());
        Ok(bundle)
    }
    fn verify(&self, _bundle_path: &str) -> Result<VerifyOutcome, BuildError> {
        Ok(VerifyOutcome {
            reproducible: true,
            shipped_sha256: "9f3c1a2b7e".into(),
            rebuilt_sha256: "9f3c1a2b7e".into(),
            diffs: vec![],
        })
    }
}

/// List `*.tau` files in the project dir. tau has no enumerate-bundles command,
/// so this surfaces only what is observable on disk (path, size, mtime).
fn scan_bundles(project: &Path) -> Vec<Bundle> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(project) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("tau") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let built_at = meta
            .modified()
            .ok()
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());
        out.push(Bundle {
            path: path.to_string_lossy().to_string(),
            sha256: String::new(),
            size_bytes: meta.len(),
            built_at,
        });
    }
    out.sort_by(|a, b| b.built_at.cmp(&a.built_at));
    out
}

/// Reject a target triple that could be smuggled to `tau build` as a flag.
fn is_safe_target(t: &str) -> bool {
    !t.is_empty() && !t.starts_with('-') && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn parse_targets_jsonl(stdout: &str) -> Vec<Target> {
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v.get("event").and_then(|e| e.as_str()) == Some("target"))
        .map(|v| Target {
            triple: v["triple"].as_str().unwrap_or("").to_string(),
            platform: v["platform"].as_str().unwrap_or("").to_string(),
            adapter_family: v["adapter_family"].as_str().unwrap_or("").to_string(),
            tier: v["tier"].as_str().unwrap_or("").to_string(),
            status: v["status"].as_str().unwrap_or("unknown").to_string(),
            required_shapes: v["required_shapes"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|s| s.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default(),
        })
        .collect()
}

/// Map a `tau build --json` result + exit code to a Bundle or a typed error.
fn parse_build_result(
    status: std::process::ExitStatus,
    stdout: &str,
    stderr: &str,
) -> Result<Bundle, BuildError> {
    if status.success() {
        let v: serde_json::Value = serde_json::from_str(stdout.trim().lines().last().unwrap_or(""))
            .map_err(|e| BuildError::Internal(format!("unparseable build output: {e}")))?;
        return Ok(Bundle {
            path: v["path"].as_str().unwrap_or("").to_string(),
            sha256: v["sha256"].as_str().unwrap_or("").to_string(),
            size_bytes: v["size_bytes"].as_u64().unwrap_or(0),
            built_at: None,
        });
    }
    match status.code() {
        Some(3) => Err(BuildError::NeedsProvisioning(stderr.trim().to_string())),
        Some(2) => Err(BuildError::Invalid(stderr.trim().to_string())),
        _ => Err(BuildError::Internal(stderr.trim().to_string())),
    }
}

fn parse_verify_json(stdout: &str) -> Result<VerifyOutcome, BuildError> {
    let line = stdout.trim().lines().last().unwrap_or("");
    let v: serde_json::Value = serde_json::from_str(line)
        .map_err(|e| BuildError::Internal(format!("unparseable verify output: {e}")))?;
    Ok(VerifyOutcome {
        reproducible: v["reproducible"].as_bool().unwrap_or(false),
        shipped_sha256: v["shipped_sha256"].as_str().unwrap_or("").to_string(),
        rebuilt_sha256: v["rebuilt_sha256"].as_str().unwrap_or("").to_string(),
        diffs: v["diffs"]
            .as_array()
            .map(|a| a.iter().map(|d| d.to_string()).collect())
            .unwrap_or_default(),
    })
}

/// Shells real tau: `tau target list` / `tau build` / `tau verify --bundle`.
pub struct CliShip {
    bin: PathBuf,
    project: PathBuf,
}

impl CliShip {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        Self { bin, project }
    }
}

impl ShipSource for CliShip {
    fn list_targets(&self) -> Vec<Target> {
        Command::new(&self.bin)
            .arg("target")
            .arg("list")
            .arg("--all")
            .arg("--json")
            .output()
            .ok()
            .map(|o| parse_targets_jsonl(&String::from_utf8_lossy(&o.stdout)))
            .unwrap_or_default()
    }

    fn list_bundles(&self) -> Vec<Bundle> {
        scan_bundles(&self.project)
    }

    fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        if !is_safe_target(target) {
            return Err(BuildError::Invalid(format!("invalid target '{target}'")));
        }
        let out = Command::new(&self.bin)
            .arg("build")
            .arg("--target")
            .arg(target)
            .arg("--json")
            .current_dir(&self.project)
            .output()
            .map_err(|e| BuildError::Internal(format!("could not run tau build: {e}")))?;
        parse_build_result(
            out.status,
            &String::from_utf8_lossy(&out.stdout),
            &String::from_utf8_lossy(&out.stderr),
        )
    }

    fn verify(&self, bundle_path: &str) -> Result<VerifyOutcome, BuildError> {
        let out = Command::new(&self.bin)
            .arg("verify")
            .arg("--bundle")
            .arg(bundle_path)
            .arg("--json")
            .current_dir(&self.project)
            .output()
            .map_err(|e| BuildError::Internal(format!("could not run tau verify: {e}")))?;
        if out.status.code() == Some(3) {
            return Err(BuildError::NeedsProvisioning(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ));
        }
        parse_verify_json(&String::from_utf8_lossy(&out.stdout))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_seeds_targets_and_bundles() {
        let s = MockShip::new("demo".into());
        let ts = s.list_targets();
        assert!(ts
            .iter()
            .any(|t| t.triple == "darwin-native-strict" && t.status == "available"));
        assert!(ts
            .iter()
            .any(|t| t.triple == "windows-native-strict" && t.status == "reserved"));
        assert!(!s.list_bundles().is_empty());
    }

    #[test]
    fn build_available_appends_bundle() {
        let s = MockShip::new("demo".into());
        let before = s.list_bundles().len();
        let b = s.build("darwin-native-strict").unwrap();
        assert_eq!(b.path, "demo.tau");
        assert_eq!(s.list_bundles().len(), before + 1);
        assert_eq!(s.list_bundles()[0].built_at.as_deref(), Some("just now"));
    }

    #[test]
    fn build_rejects_reserved_and_unknown() {
        let s = MockShip::new("demo".into());
        assert!(matches!(
            s.build("windows-native-strict"),
            Err(BuildError::Invalid(_))
        ));
        assert!(matches!(s.build("nope"), Err(BuildError::Invalid(_))));
    }

    #[test]
    fn cli_ship_is_empty_without_real_tau() {
        // A bogus bin path makes list/build fail gracefully (empty / error), no panic.
        // Use a fresh empty dir so list_bundles' fs scan is deterministic.
        let empty = tempfile::tempdir().unwrap();
        let s = CliShip::new("/nonexistent/tau".into(), empty.path().to_path_buf());
        assert!(s.list_targets().is_empty());
        assert!(s.list_bundles().is_empty());
        assert!(s.build("darwin-native-strict").is_err());
    }

    #[test]
    fn parse_targets_jsonl_maps_triples() {
        let jsonl = include_str!("../../tests/fixtures/tau-json/targets.jsonl");
        let ts = parse_targets_jsonl(jsonl);
        assert_eq!(ts.len(), 4);
        let darwin = ts
            .iter()
            .find(|t| t.triple == "darwin-native-strict")
            .unwrap();
        assert_eq!(darwin.platform, "darwin");
        assert_eq!(darwin.adapter_family, "native");
        assert_eq!(darwin.status, "available");
        assert!(ts
            .iter()
            .any(|t| t.triple == "windows-native-strict" && t.status == "reserved"));
        assert!(darwin.required_shapes.contains(&"exec".to_string()));
    }

    #[test]
    fn parse_verify_reads_reproducibility() {
        let line =
            r#"{"reproducible":true,"shipped_sha256":"aa","rebuilt_sha256":"aa","diffs":[]}"#;
        let v = parse_verify_json(line).unwrap();
        assert!(v.reproducible);
        assert_eq!(v.shipped_sha256, "aa");
    }

    #[test]
    fn safe_target_rejects_flag_smuggling() {
        assert!(is_safe_target("darwin-native-strict"));
        assert!(!is_safe_target("--output=/etc/x"));
        assert!(!is_safe_target("-rf"));
        assert!(!is_safe_target(""));
    }

    #[test]
    fn scan_bundles_lists_tau_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("app.tau"), b"xxxxx").unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"y").unwrap();
        let bundles = scan_bundles(dir.path());
        assert_eq!(bundles.len(), 1);
        assert!(bundles[0].path.ends_with("app.tau"));
        assert_eq!(bundles[0].size_bytes, 5);
        assert!(bundles[0].built_at.is_some());
    }
}
