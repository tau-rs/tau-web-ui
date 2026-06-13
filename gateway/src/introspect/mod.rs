//! Plugin introspection: one cached "describe sweep" that shells
//! `tau list packages --all --json` then `tau plugin describe <pkg> --json` per
//! package, classifying each as a plugin, a data-only package, or a failure.
//! Feeds BOTH the Tools catalog (Tool-port plugins) and the Plugins tab (all
//! ports + error rows). The gateway never links tau crates — it parses --json
//! and distinguishes data-only packages by describe's exit + stderr.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Boundary error taxonomy. Each variant maps to a `PluginError.kind` string.
/// `DataOnly` is NOT here — it is a normal classification, not a failure.
#[derive(Debug, thiserror::Error)]
pub enum IntrospectError {
    #[error("`tau list packages` failed: {0}")]
    ListFailed(String),
    #[error("describe failed: {0}")]
    Describe(String),
    #[error("describe timed out")]
    Timeout,
    #[error("describe output did not parse: {0}")]
    Parse(String),
}

impl IntrospectError {
    fn kind(&self) -> &'static str {
        match self {
            IntrospectError::ListFailed(_) => "list",
            IntrospectError::Describe(_) => "describe",
            IntrospectError::Timeout => "timeout",
            IntrospectError::Parse(_) => "parse",
        }
    }
}

/// A per-package introspection failure, surfaced as a UI error row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginError {
    pub package: String,
    pub kind: String,
    pub message: String,
}

impl PluginError {
    fn from_err(package: &str, e: &IntrospectError) -> Self {
        PluginError {
            package: package.to_string(),
            kind: e.kind().to_string(),
            message: e.to_string(),
        }
    }
}

/// Parsed `tau plugin describe --json` output — the fields the gateway uses.
#[derive(Debug, Clone)]
pub struct PluginInfo {
    pub package: String,
    pub package_version: Option<String>,
    pub source: String,
    pub binary_path: String,
    pub kind: String, // normalized, e.g. "rust-cargo"
    pub port: String, // handshake.provides verbatim: "Tool"|"LlmBackend"|"Storage"|"Sandbox"
    pub protocol_version: u32,
    pub plugin_name: String,
    pub methods: Vec<String>,
    pub tool_params: serde_json::Value, // schemas["tool.call"].params (Null if absent)
}

/// One package's classification from the sweep.
#[derive(Debug, Clone)]
pub enum Classified {
    Plugin(PluginInfo),
    DataOnly,
    Failed(PluginError),
}

/// tau serializes manifest.kind as a Rust `{:?}` debug string; map the known one
/// to the kebab form the UI/mock already use, pass anything else through.
fn normalize_kind(raw: &str) -> String {
    match raw {
        "RustCargo" => "rust-cargo".to_string(),
        other => other.to_string(),
    }
}

/// Parse describe stdout. `None` => not valid JSON / missing handshake.provides,
/// which the caller treats as a Parse failure.
fn parse_describe(pkg: &str, stdout: &str) -> Option<PluginInfo> {
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    let hs = &v["handshake"];
    let port = hs["provides"].as_str()?.to_string();
    // protocol_version is a string in tau; accept a number too, just in case.
    let protocol_version = hs["protocol_version"]
        .as_str()
        .and_then(|s| s.parse::<u32>().ok())
        .or_else(|| hs["protocol_version"].as_u64().map(|n| n as u32))
        .unwrap_or(1);
    Some(PluginInfo {
        package: v["package"].as_str().unwrap_or(pkg).to_string(),
        package_version: v["package_version"].as_str().map(String::from),
        source: v["source"].as_str().unwrap_or("").to_string(),
        binary_path: v["binary_path"].as_str().unwrap_or("").to_string(),
        kind: normalize_kind(v["manifest"]["kind"].as_str().unwrap_or("")),
        port,
        protocol_version,
        plugin_name: hs["plugin_name"].as_str().unwrap_or(pkg).to_string(),
        methods: hs["methods"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|m| m.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        tool_params: hs["schemas"]["tool.call"]["params"].clone(),
    })
}

/// Extract just package names from `tau list packages --all --json`.
fn parse_pkg_names(stdout: &str) -> Vec<String> {
    serde_json::from_str::<Vec<serde_json::Value>>(stdout.trim())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v["name"].as_str().map(String::from))
        .filter(|n| !n.is_empty())
        .collect()
}

/// Classify one describe result. Pure: no spawning, fully unit-testable.
fn classify(pkg: &str, outcome: RunOutcome) -> Classified {
    match outcome {
        RunOutcome::TimedOut => {
            Classified::Failed(PluginError::from_err(pkg, &IntrospectError::Timeout))
        }
        RunOutcome::Done {
            success: true,
            stdout,
            ..
        } => match parse_describe(pkg, &stdout) {
            Some(info) => Classified::Plugin(info),
            None => Classified::Failed(PluginError::from_err(
                pkg,
                &IntrospectError::Parse(stdout.chars().take(120).collect()),
            )),
        },
        RunOutcome::Done {
            success: false,
            stderr,
            ..
        } => {
            // Data-only packages error BEFORE any spawn with this exact phrase.
            if stderr.contains("[plugin] table") {
                Classified::DataOnly
            } else {
                Classified::Failed(PluginError::from_err(
                    pkg,
                    &IntrospectError::Describe(stderr.trim().chars().take(200).collect()),
                ))
            }
        }
    }
}

enum RunOutcome {
    Done {
        success: bool,
        stdout: String,
        stderr: String,
    },
    TimedOut,
}

/// Run a child with a wall-clock timeout. Reader threads drain stdout/stderr so a
/// full pipe buffer can't deadlock the wait loop; on timeout the child is killed.
fn run_with_timeout(bin: &Path, args: &[&str], dir: &Path, timeout: Duration) -> RunOutcome {
    let mut child = match Command::new(bin)
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            return RunOutcome::Done {
                success: false,
                stdout: String::new(),
                stderr: e.to_string(),
            }
        }
    };
    let mut out = child.stdout.take().expect("piped stdout");
    let mut err = child.stderr.take().expect("piped stderr");
    let (tx_out, rx_out) = mpsc::channel();
    let (tx_err, rx_err) = mpsc::channel();
    thread::spawn(move || {
        let mut s = String::new();
        let _ = out.read_to_string(&mut s);
        let _ = tx_out.send(s);
    });
    thread::spawn(move || {
        let mut s = String::new();
        let _ = err.read_to_string(&mut s);
        let _ = tx_err.send(s);
    });

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return RunOutcome::Done {
                    success: status.success(),
                    stdout: rx_out.recv().unwrap_or_default(),
                    stderr: rx_err.recv().unwrap_or_default(),
                };
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return RunOutcome::TimedOut;
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return RunOutcome::TimedOut,
        }
    }
}

struct Cached {
    built_at: Instant,
    items: Vec<Classified>,
}

/// Shared describe sweep with a per-project TTL cache. Built once on the real
/// path and injected (as `Arc`) into both `CliTools` and `CliPlugins`.
pub struct PluginIntrospector {
    bin: PathBuf,
    project: PathBuf,
    timeout: Duration,
    concurrency: usize,
    ttl: Duration,
    cache: Mutex<Option<Cached>>,
}

impl PluginIntrospector {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        Self::with_settings(
            bin,
            project,
            Duration::from_secs(15),
            4,
            Duration::from_secs(60),
        )
    }

    fn with_settings(
        bin: PathBuf,
        project: PathBuf,
        timeout: Duration,
        concurrency: usize,
        ttl: Duration,
    ) -> Self {
        PluginIntrospector {
            bin,
            project,
            timeout,
            concurrency,
            ttl,
            cache: Mutex::new(None),
        }
    }

    /// The classified sweep, cached for `ttl`. Holding the lock across a rebuild
    /// serializes concurrent callers — intentional: it prevents a thundering herd
    /// of describe spawns. First call after expiry pays the rebuild cost.
    pub fn sweep(&self) -> Vec<Classified> {
        let mut guard = self.cache.lock().unwrap();
        if let Some(c) = guard.as_ref() {
            if c.built_at.elapsed() < self.ttl {
                return c.items.clone();
            }
        }
        let items = self.build();
        *guard = Some(Cached {
            built_at: Instant::now(),
            items: items.clone(),
        });
        items
    }

    /// Drop the cache so the next `sweep()` rebuilds (call on package mutations).
    pub fn invalidate(&self) {
        *self.cache.lock().unwrap() = None;
    }

    fn build(&self) -> Vec<Classified> {
        match self.list_packages() {
            Ok(pkgs) => self.describe_all(pkgs),
            // A list failure (incl. a missing tau binary) becomes one error row.
            Err(e) => vec![Classified::Failed(PluginError::from_err("(all)", &e))],
        }
    }

    fn list_packages(&self) -> Result<Vec<String>, IntrospectError> {
        match run_with_timeout(
            &self.bin,
            &["list", "packages", "--all", "--json"],
            &self.project,
            self.timeout,
        ) {
            RunOutcome::TimedOut => Err(IntrospectError::ListFailed("timed out".to_string())),
            RunOutcome::Done {
                success: false,
                stderr,
                ..
            } => Err(IntrospectError::ListFailed(stderr.trim().to_string())),
            RunOutcome::Done {
                success: true,
                stdout,
                ..
            } => Ok(parse_pkg_names(&stdout)),
        }
    }

    fn describe_all(&self, packages: Vec<String>) -> Vec<Classified> {
        if packages.is_empty() {
            return vec![];
        }
        let next = AtomicUsize::new(0);
        let results: Mutex<Vec<(usize, Classified)>> = Mutex::new(Vec::new());
        let workers = self.concurrency.min(packages.len());
        thread::scope(|s| {
            for _ in 0..workers {
                s.spawn(|| loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= packages.len() {
                        break;
                    }
                    let pkg = &packages[i];
                    let outcome = run_with_timeout(
                        &self.bin,
                        &["plugin", "describe", pkg, "--json"],
                        &self.project,
                        self.timeout,
                    );
                    results.lock().unwrap().push((i, classify(pkg, outcome)));
                });
            }
        });
        let mut v = results.into_inner().unwrap();
        v.sort_by_key(|(i, _)| *i);
        v.into_iter().map(|(_, c)| c).collect()
    }
}

/// Build the param→type schema map the UI shows, from a `tool.call` params JSON
/// Schema (`properties` map). Shared by the tools + plugins projections.
pub fn tool_input_schema(params: &serde_json::Value) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    if let Some(props) = params.get("properties").and_then(|p| p.as_object()) {
        for (k, spec) in props {
            let ty = spec
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown")
                .to_string();
            m.insert(k.clone(), ty);
        }
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    const HANDSHAKE_TOOL: &str = r#"{
        "package":"fs-read","package_version":"1.0.0","source":"github.com/tau/fs-read",
        "binary_path":"/bin/fs-read","manifest":{"kind":"RustCargo"},
        "handshake":{"protocol_version":"1","provides":"Tool","plugin_name":"fs-read",
          "methods":["tool.call","tool.describe"],
          "schemas":{"tool.call":{"params":{"type":"object","properties":{"path":{"type":"string"}}}}}}
    }"#;

    #[test]
    fn parse_describe_extracts_tool_fields() {
        let info = parse_describe("fs-read", HANDSHAKE_TOOL).unwrap();
        assert_eq!(info.port, "Tool");
        assert_eq!(info.kind, "rust-cargo"); // normalized from "RustCargo"
        assert_eq!(info.protocol_version, 1); // parsed from the string "1"
        assert_eq!(info.plugin_name, "fs-read");
        assert_eq!(
            tool_input_schema(&info.tool_params).get("path").unwrap(),
            "string"
        );
    }

    #[test]
    fn classify_success_is_a_plugin() {
        let outcome = RunOutcome::Done {
            success: true,
            stdout: HANDSHAKE_TOOL.to_string(),
            stderr: String::new(),
        };
        assert!(matches!(
            classify("fs-read", outcome),
            Classified::Plugin(_)
        ));
    }

    #[test]
    fn classify_data_only_package_is_dropped_not_failed() {
        let outcome = RunOutcome::Done {
            success: false,
            stdout: String::new(),
            stderr: "package 'recipes' has no [plugin] table in its tau.toml (it is a data-only package; nothing to describe)".to_string(),
        };
        assert!(matches!(classify("recipes", outcome), Classified::DataOnly));
    }

    #[test]
    fn classify_other_nonzero_is_a_describe_failure() {
        let outcome = RunOutcome::Done {
            success: false,
            stdout: String::new(),
            stderr: "boom".to_string(),
        };
        match classify("x", outcome) {
            Classified::Failed(e) => assert_eq!(e.kind, "describe"),
            _ => panic!("expected Failed"),
        }
    }

    #[test]
    fn classify_timeout_is_a_timeout_failure() {
        match classify("x", RunOutcome::TimedOut) {
            Classified::Failed(e) => assert_eq!(e.kind, "timeout"),
            _ => panic!("expected Failed"),
        }
    }

    #[test]
    fn classify_unparseable_success_is_a_parse_failure() {
        let outcome = RunOutcome::Done {
            success: true,
            stdout: "not json".to_string(),
            stderr: String::new(),
        };
        match classify("x", outcome) {
            Classified::Failed(e) => assert_eq!(e.kind, "parse"),
            _ => panic!("expected Failed"),
        }
    }

    /// Write a fake `tau` shell script that emulates list + describe for the
    /// sweep integration test (classification + timeout + cache + invalidate).
    fn fake_tau(dir: &Path) -> PathBuf {
        let p = dir.join("tau");
        std::fs::write(
            &p,
            r#"#!/usr/bin/env bash
# Log every call into the project CWD (unique per test) — no shared env var, so
# this is safe under cargo's parallel test threads.
echo "$@" >> calls.log
if [ "$1 $2" = "list packages" ]; then
  echo '[{"name":"fs-read"},{"name":"anthropic"},{"name":"recipes"},{"name":"hang"}]'
  exit 0
fi
if [ "$1 $2" = "plugin describe" ]; then
  case "$3" in
    fs-read) echo '{"package":"fs-read","manifest":{"kind":"RustCargo"},"handshake":{"protocol_version":"1","provides":"Tool","plugin_name":"fs-read","methods":["tool.call"],"schemas":{"tool.call":{"params":{"type":"object","properties":{"path":{"type":"string"}}}}}}}'; exit 0;;
    anthropic) echo '{"package":"anthropic","manifest":{"kind":"RustCargo"},"handshake":{"protocol_version":"1","provides":"LlmBackend","plugin_name":"anthropic","methods":["llm.complete"],"schemas":{}}}'; exit 0;;
    recipes) echo "package 'recipes' has no [plugin] table in its tau.toml (it is a data-only package; nothing to describe)" >&2; exit 2;;
    hang) sleep 30; exit 0;;
  esac
fi
exit 1
"#,
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = std::fs::metadata(&p).unwrap().permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&p, perm).unwrap();
        }
        p
    }

    #[test]
    fn sweep_classifies_plugins_dataonly_and_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_tau(dir.path());
        // 800ms timeout: the `hang` describe (sleep 30) is killed; others are instant.
        let intro = PluginIntrospector::with_settings(
            bin,
            dir.path().to_path_buf(),
            Duration::from_millis(800),
            4,
            Duration::from_secs(60),
        );
        let items = intro.sweep();
        let plugins: Vec<_> = items
            .iter()
            .filter_map(|c| match c {
                Classified::Plugin(i) => Some(i.port.clone()),
                _ => None,
            })
            .collect();
        assert!(plugins.contains(&"Tool".to_string()));
        assert!(plugins.contains(&"LlmBackend".to_string()));
        assert_eq!(
            items
                .iter()
                .filter(|c| matches!(c, Classified::DataOnly))
                .count(),
            1,
            "recipes is data-only and dropped"
        );
        let failed: Vec<_> = items
            .iter()
            .filter_map(|c| match c {
                Classified::Failed(e) => Some(e.kind.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(failed, vec!["timeout".to_string()], "hang times out");
    }

    #[test]
    fn sweep_caches_until_invalidated() {
        let dir = tempfile::tempdir().unwrap();
        let bin = fake_tau(dir.path());
        let calls = dir.path().join("calls.log");
        let intro = PluginIntrospector::with_settings(
            bin,
            dir.path().to_path_buf(),
            Duration::from_millis(800),
            4,
            Duration::from_secs(60),
        );
        intro.sweep();
        let after_first = std::fs::read_to_string(&calls).unwrap().lines().count();
        intro.sweep(); // cache hit → no new tau calls
        assert_eq!(
            std::fs::read_to_string(&calls).unwrap().lines().count(),
            after_first,
            "second sweep within TTL must not re-shell tau"
        );
        intro.invalidate();
        intro.sweep(); // rebuild → more calls
        assert!(
            std::fs::read_to_string(&calls).unwrap().lines().count() > after_first,
            "sweep after invalidate must re-shell tau"
        );
    }
}
