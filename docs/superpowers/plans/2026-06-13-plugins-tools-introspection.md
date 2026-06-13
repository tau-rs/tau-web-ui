# Plugins + Tools real introspection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits are deferred.** The repo owner asked for no commits until they say so. Where the writing-plans template would commit, this plan runs a **verify gate** (`just fmt && just test`) instead. Do NOT `git commit`.

**Goal:** Replace tau-ui's mock Tools catalog and fully-mock Plugins tab with real data assembled from `tau list packages --all --json` + `tau plugin describe <pkg> --json`, surfaced through cached, bounded, timeout-guarded gateway introspection.

**Architecture:** A new gateway module `introspect` runs one cached "describe sweep" (per project, 60s TTL, ≤4 concurrent child spawns, 15s per-child kill timeout) classifying each package as `Plugin` / `DataOnly` / `Failed`. `CliTools` and `CliPlugins` both project that one sweep — `Tool`-port plugins become tool rows; all ports become plugin rows; failures become error rows. The `/plugins` endpoint returns `{plugins, errors}` (envelope) and `/tools` returns `{tools, error_count}`.

**Tech Stack:** Rust (axum, serde_json, thiserror, ts-rs, `std::thread::scope`); React 19 / TypeScript / vitest; `just` task runner (`pnpm` for web).

**Spec:** `docs/superpowers/specs/2026-06-13-plugins-tools-introspection-design.md`

---

## File Structure

**Create:**
- `gateway/src/introspect/mod.rs` — the describe sweep: parsing, classification, timeout runner, cache, concurrency. Knows nothing about `ToolDetail`/`PluginDetail` (inward dependency: `tools`/`plugins` depend on `introspect`).
- `web/src/api/tools.test.ts`, `web/src/api/plugins.test.ts` — API contract tests.

**Modify (gateway):**
- `gateway/src/lib.rs` — declare `pub mod introspect;`.
- `gateway/src/tools/mod.rs` — `ToolCatalog` type; `ToolsSource::catalog` → `ToolCatalog`; `CliTools` reads introspector; `list_tools` returns `ToolCatalog`; `tool_detail_from`.
- `gateway/src/plugins/mod.rs` — `PluginCatalog` type; `PluginsSource::catalog` → `PluginCatalog`; `CliPlugins` reads introspector; `list_plugins` returns `PluginCatalog`; `plugin_detail_from`.
- `gateway/src/state.rs` — build `Arc<PluginIntrospector>` on the real path, inject into both `Cli*`, store it, invalidate on package mutations; `list_tools`/`list_plugins` return the envelopes.
- `gateway/src/api/tools.rs`, `gateway/src/api/plugins.rs` — handler return types → the envelopes.
- `gateway/tests/serve_kind.rs`, `gateway/tests/tools_api.rs`, `gateway/tests/plugins_api.rs` — assert against envelope shapes.

**Modify (web):**
- `web/src/api/tools.ts`, `web/src/api/plugins.ts` — return the envelope types.
- `web/src/tools/ToolsTab.tsx` — consume `ToolCatalog`, render the error-count notice.
- `web/src/tools/PluginsTab.tsx` — consume `PluginCatalog`, drop the mock banner, render error rows.
- `web/src/tools/ToolsPage.tsx` — remove the `gated` badge.
- `web/src/tools/ToolsTab.test.tsx`, `web/src/tools/PluginsTab.test.tsx`, `web/src/tools/ToolsPage.test.tsx` — envelope shapes + new assertions.

**Generated (do not hand-edit):** `web/src/types/PluginError.ts`, `ToolCatalog.ts`, `PluginCatalog.ts` — emitted by ts-rs `#[ts(export)]` when `cargo test` runs (`TS_RS_EXPORT_DIR=web/src/types`, per `.cargo/config.toml`).

**Sequencing:** Task 1 → 2 → 3 are gateway and sequential. Tasks 4 & 5 (web) parallelize once Task 3 regenerates the type files.

---

## Task 1: `introspect` module — the cached describe sweep

**Files:**
- Create: `gateway/src/introspect/mod.rs`
- Modify: `gateway/src/lib.rs` (add `pub mod introspect;`)

- [ ] **Step 1: Declare the module**

In `gateway/src/lib.rs`, add the line in alphabetical position (between `pub mod graph;` and `pub mod packages;`):

```rust
pub mod introspect;
```

- [ ] **Step 2: Write the module with pure logic + a private timeout runner + the cached introspector**

Create `gateway/src/introspect/mod.rs`:

```rust
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
            .map(|a| a.iter().filter_map(|m| m.as_str().map(String::from)).collect())
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

/// Re-export so `tools`/`plugins` can build a tool-param schema map without
/// re-walking the JSON Schema shape twice.
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
        assert_eq!(tool_input_schema(&info.tool_params).get("path").unwrap(), "string");
    }

    #[test]
    fn classify_success_is_a_plugin() {
        let outcome = RunOutcome::Done {
            success: true,
            stdout: HANDSHAKE_TOOL.to_string(),
            stderr: String::new(),
        };
        assert!(matches!(classify("fs-read", outcome), Classified::Plugin(_)));
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
echo "$@" >> "$TAU_CALLS"
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
        std::env::set_var("TAU_CALLS", dir.path().join("calls.log"));
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
            items.iter().filter(|c| matches!(c, Classified::DataOnly)).count(),
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
        std::env::set_var("TAU_CALLS", &calls);
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
```

- [ ] **Step 3: Run the introspect tests and confirm they pass**

Run: `cargo test -p tau-gateway introspect`
Expected: PASS — `parse_describe_*`, all five `classify_*`, `sweep_classifies_*`, `sweep_caches_until_invalidated`. The two `sweep_*` tests take ~1s each (the `hang` kill).

- [ ] **Step 4: Verify gate (no commit)**

Run: `cargo fmt --all && cargo clippy -p tau-gateway --all-targets -- -D warnings`
Expected: clean (no warnings). Do NOT commit.

---

## Task 2: Gateway contract — envelopes, mappings, and `Cli*` rewire

**Files:**
- Modify: `gateway/src/tools/mod.rs`
- Modify: `gateway/src/plugins/mod.rs`

- [ ] **Step 1: Update the plugins module — `PluginCatalog`, mapping, `CliPlugins`**

In `gateway/src/plugins/mod.rs`:

a) Update the file-level doc comment (line 1-3) to:

```rust
//! Plugins view: a read-only catalog of plugin binaries behind packages that
//! provide a tau port, assembled from `introspect`'s describe sweep. Real on the
//! CLI path (`CliPlugins`); `MockPlugins` covers fake-tau-serve.
```

b) Add imports near the top (after the existing `use crate::skills::Capability;`):

```rust
use std::sync::Arc;

use crate::introspect::{tool_input_schema, Classified, PluginError, PluginIntrospector};
```

c) Add the envelope type right after the `PluginDetail` struct (after its closing `}` at line 50):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginCatalog {
    pub plugins: Vec<PluginDetail>,
    pub errors: Vec<PluginError>,
}
```

d) Change the trait (lines 52-56) to return the envelope:

```rust
/// Source of the plugin catalog. `MockPlugins` is deterministic; `CliPlugins`
/// projects the real describe sweep.
pub trait PluginsSource: Send + Sync {
    fn catalog(&self) -> PluginCatalog;
}
```

e) Change `MockPlugins::catalog` to wrap its `vec![...]` in the envelope. Replace the `impl PluginsSource for MockPlugins` signature line and the surrounding `vec![ ... ]`:

```rust
impl PluginsSource for MockPlugins {
    fn catalog(&self) -> PluginCatalog {
        let plugins = vec![
            // ... LEAVE the four existing assemble(...) calls EXACTLY as they are ...
        ];
        PluginCatalog {
            plugins,
            errors: vec![],
        }
    }
}
```

(Keep the four `assemble(...)` entries verbatim; only the wrapping changes from `vec![...]` returned directly to `let plugins = vec![...]; PluginCatalog { plugins, errors: vec![] }`.)

f) Replace `list_plugins` (lines 229-235) and `CliPlugins` (lines 237-244) with:

```rust
/// Return the plugin catalog (plugins + introspection errors).
pub fn list_plugins(source: &dyn PluginsSource) -> PluginCatalog {
    source.catalog()
}

/// Build a `PluginDetail` from one parsed describe result. Capabilities are
/// empty — `tau plugin describe` does not call `tool.describe_capabilities`.
fn plugin_detail_from(info: &PluginInfoRef) -> PluginDetail {
    let tool = if info.port == "Tool" {
        Some(ToolSchema {
            name: info.plugin_name.clone(),
            input_schema: tool_input_schema(&info.tool_params),
        })
    } else {
        None
    };
    let describe = PluginDescribe {
        port: info.port.clone(),
        protocol_version: info.protocol_version,
        tool,
        capabilities: vec![],
    };
    // Synthesize a 2-frame transcript so the protocol pane isn't dead.
    let transcript = vec![
        frame(
            "out",
            "meta.handshake",
            json!({ "protocol_version": info.protocol_version }),
        ),
        frame(
            "in",
            "result",
            json!({
                "plugin_name": info.plugin_name,
                "provides": info.port,
                "protocol_version": info.protocol_version,
                "methods": info.methods,
            }),
        ),
    ];
    PluginDetail {
        name: info.package.clone(),
        version: info.package_version.clone(),
        source: info.source.clone(),
        kind: info.kind.clone(),
        binary: info.binary_path.clone(),
        port: info.port.clone(),
        protocol_version: info.protocol_version,
        describe,
        transcript,
    }
}

/// Real-tau plugin seam: projects the shared describe sweep into the envelope.
pub struct CliPlugins {
    introspector: Arc<PluginIntrospector>,
}

impl CliPlugins {
    pub fn new(introspector: Arc<PluginIntrospector>) -> Self {
        CliPlugins { introspector }
    }
}

impl PluginsSource for CliPlugins {
    fn catalog(&self) -> PluginCatalog {
        let mut plugins = vec![];
        let mut errors = vec![];
        for c in self.introspector.sweep() {
            match c {
                Classified::Plugin(info) => plugins.push(plugin_detail_from(&info)),
                Classified::DataOnly => {}
                Classified::Failed(e) => errors.push(e),
            }
        }
        PluginCatalog { plugins, errors }
    }
}
```

Note: `plugin_detail_from` takes `&PluginInfoRef` — that's a typo guard; use the real type `&crate::introspect::PluginInfo`. Add `PluginInfo` to the import in (b): `use crate::introspect::{tool_input_schema, Classified, PluginError, PluginInfo, PluginIntrospector};` and change the signature to `fn plugin_detail_from(info: &PluginInfo) -> PluginDetail`.

- [ ] **Step 2: Update the plugins unit tests for the envelope**

In `gateway/src/plugins/mod.rs` `#[cfg(test)] mod tests`:

Replace `mock_catalog_seeds_four_plugins`'s first lines:

```rust
        let cat = MockPlugins.catalog().plugins;
        let names: Vec<&str> = cat.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["fs-read", "shell", "web-search", "anthropic"]);
```

(The rest of that test references `cat[0]`, `cat.iter()` — unchanged since `cat` is now the `Vec<PluginDetail>`.)

Delete the final line of that test: `assert!(CliPlugins.catalog().is_empty());` (CliPlugins now needs an introspector and is covered by Task 1's sweep tests).

Replace `list_plugins_returns_catalog`:

```rust
    #[test]
    fn list_plugins_returns_catalog() {
        let cat = list_plugins(&MockPlugins);
        assert_eq!(cat.plugins.len(), 4);
        assert!(cat.errors.is_empty());
    }
```

- [ ] **Step 3: Update the tools module — `ToolCatalog`, mapping, `CliTools`**

In `gateway/src/tools/mod.rs`:

a) Add imports after `use crate::skills::Capability;`:

```rust
use std::sync::Arc;

use crate::introspect::{tool_input_schema, Classified, PluginInfo, PluginIntrospector};
```

b) Add the envelope type after the `ToolDetail` struct (after line 30):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolCatalog {
    pub tools: Vec<ToolDetail>,
    /// Count of plugins that failed to introspect; detail lives on the Plugins tab.
    pub error_count: u32,
}
```

c) Change the trait (lines 32-35):

```rust
/// Source of the tool catalog (used_by left empty; filled by `list_tools`).
pub trait ToolsSource: Send + Sync {
    fn catalog(&self) -> ToolCatalog;
}
```

d) Change `MockTools::catalog` to return the envelope. Replace its signature and the final `vec![ ... ]`:

```rust
impl ToolsSource for MockTools {
    fn catalog(&self) -> ToolCatalog {
        // ... LEAVE the `cap` and `tool` closures exactly as they are ...
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
```

e) Replace `CliTools` (lines 70-77) with the introspector-backed impl + the mapping:

```rust
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
```

f) Change `list_tools` (lines 81-110) to thread the envelope. Replace its signature and the `let mut tools = source.catalog();` / `tools` lines:

```rust
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
```

- [ ] **Step 4: Update the tools unit tests for the envelope**

In `gateway/src/tools/mod.rs` `#[cfg(test)] mod tests`:

Replace `mock_catalog_seeds_three_tools` body's first lines and drop the `CliTools` assertion:

```rust
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
```

In `list_tools_computes_used_by_from_demo`, change the binding to read `.tools`:

```rust
        let cat = list_tools(&demo(), &MockTools);
        let fsr = cat.tools.iter().find(|t| t.name == "fs-read").unwrap();
        assert!(fsr
            .used_by
            .iter()
            .any(|u| u.kind == "skill" && u.name == "critic"));
        let shell = cat.tools.iter().find(|t| t.name == "shell").unwrap();
        assert!(shell.used_by.is_empty());
```

In `list_tools_computes_used_by_from_agent`, change the last lines:

```rust
        let cat = list_tools(dir.path(), &MockTools);
        let ws = cat.tools.iter().find(|t| t.name == "web-search").unwrap();
        assert!(ws
            .used_by
            .iter()
            .any(|u| u.kind == "agent" && u.name == "researcher"));
```

- [ ] **Step 5: Run the tools + plugins unit tests**

Run: `cargo test -p tau-gateway --lib tools:: plugins::`
Expected: PASS — mock catalogs return the envelopes; `list_tools`/`list_plugins` thread them.

(The crate won't fully build yet — `state.rs` and the API handlers still call the old shapes; Task 3 fixes them. If `cargo test --lib` fails to compile due to `state.rs`, that's expected; proceed to Task 3 and run the full build there.)

---

## Task 3: Wire the introspector into `AppState`, the API, and integration tests

**Files:**
- Modify: `gateway/src/state.rs`
- Modify: `gateway/src/api/tools.rs`, `gateway/src/api/plugins.rs`
- Modify: `gateway/tests/serve_kind.rs`, `gateway/tests/tools_api.rs`, `gateway/tests/plugins_api.rs`

- [ ] **Step 1: Inject + store the introspector in `AppState`**

In `gateway/src/state.rs`:

a) Update imports — change line 19 and 25 to pull the envelopes, and add the introspect import:

```rust
use crate::introspect::PluginIntrospector;
use crate::plugins::{self, PluginCatalog, PluginsSource};
// ...
use crate::tools::{self, ToolCatalog, ToolsSource};
```

(Remove the now-unused `PluginDetail` / `ToolDetail` names from those two `use` lines.)

b) Add a field to `Inner` (after `graph_source: Box<dyn WorkflowGraphSource>,` at line 46):

```rust
    /// Shared describe sweep for tools + plugins (None on the mock path).
    introspector: Option<Arc<PluginIntrospector>>,
```

c) In `with_options`, build the introspector before the `tools_source`/`plugins_source` selectors and use it. Replace the existing `tools_source` + `plugins_source` blocks (lines 101-110):

```rust
        let introspector: Option<Arc<PluginIntrospector>> = if is_mock {
            None
        } else {
            Some(Arc::new(PluginIntrospector::new(bin.clone(), project.clone())))
        };
        let tools_source: Box<dyn ToolsSource> = if is_mock {
            Box::new(tools::MockTools)
        } else {
            Box::new(tools::CliTools::new(
                introspector.clone().expect("real path builds an introspector"),
            ))
        };
        let plugins_source: Box<dyn PluginsSource> = if is_mock {
            Box::new(plugins::MockPlugins)
        } else {
            Box::new(plugins::CliPlugins::new(
                introspector.clone().expect("real path builds an introspector"),
            ))
        };
```

d) Add `introspector,` to the `Inner { ... }` initializer (after `graph_source,` at line 149).

- [ ] **Step 2: Change the state accessors + add invalidation**

In `gateway/src/state.rs`:

a) Replace `list_tools` (line 558-560) and `list_plugins` (line 562-564):

```rust
    pub fn list_tools(&self) -> ToolCatalog {
        tools::list_tools(&self.0.project, self.0.tools_source.as_ref())
    }

    pub fn list_plugins(&self) -> PluginCatalog {
        plugins::list_plugins(self.0.plugins_source.as_ref())
    }

    /// Drop the cached describe sweep (call after any package mutation).
    fn invalidate_introspect(&self) {
        if let Some(i) = &self.0.introspector {
            i.invalidate();
        }
    }
```

b) Add `self.invalidate_introspect();` after each successful package mutation. Replace the four methods (lines 502-512) and the two import helpers:

```rust
    pub fn package_install(&self, git_url: &str) -> Result<Package> {
        let r = self.0.package_ops.install(git_url);
        if r.is_ok() {
            self.invalidate_introspect();
        }
        r
    }

    pub fn package_uninstall(&self, name: &str) -> Result<()> {
        let r = self.0.package_ops.uninstall(name);
        if r.is_ok() {
            self.invalidate_introspect();
        }
        r
    }

    pub fn package_update(&self, name: &str, to: Option<String>) -> Result<Package> {
        let r = self.0.package_ops.update(name, to);
        if r.is_ok() {
            self.invalidate_introspect();
        }
        r
    }
```

In `import_agent` (line 523-536), add `self.invalidate_introspect();` right after `let pkg = self.0.package_ops.install(git_url)?;`. In `import_skill` (line 554-556), wrap:

```rust
    pub fn import_skill(&self, git_url: &str) -> anyhow::Result<String> {
        let r = self.0.installed_skills.import(git_url);
        if r.is_ok() {
            self.invalidate_introspect();
        }
        r
    }
```

- [ ] **Step 3: Change the API handler return types**

Replace `gateway/src/api/tools.rs`:

```rust
use axum::Json;

use crate::api::scope::Scoped;
use crate::tools::ToolCatalog;

pub async fn list(Scoped(state): Scoped) -> Json<ToolCatalog> {
    Json(state.list_tools())
}
```

Replace `gateway/src/api/plugins.rs`:

```rust
use axum::Json;

use crate::api::scope::Scoped;
use crate::plugins::PluginCatalog;

pub async fn list(Scoped(state): Scoped) -> Json<PluginCatalog> {
    Json(state.list_plugins())
}
```

- [ ] **Step 4: Update the integration tests to the envelope shapes**

In `gateway/tests/serve_kind.rs`: change line 25 `!state.list_tools().is_empty()` → `!state.list_tools().tools.is_empty()`, and line 41 `state.list_tools().is_empty()` → `state.list_tools().tools.is_empty()`.

In `gateway/tests/tools_api.rs`, replace the assertions after `let list: serde_json::Value = resp.json().await.unwrap();`:

```rust
    let arr = list["tools"].as_array().unwrap();
    assert_eq!(arr.len(), 3);
    assert_eq!(list["error_count"], 0);
    let fsr = arr.iter().find(|t| t["name"] == "fs-read").unwrap();
    assert_eq!(fsr["provides"], "tool");
    assert_eq!(fsr["capabilities"][0]["kind"], "fs.read");
    assert!(fsr["used_by"]
        .as_array()
        .unwrap()
        .iter()
        .any(|u| u["kind"] == "skill" && u["name"] == "critic"));
```

In `gateway/tests/plugins_api.rs`, replace the assertions after `let list: serde_json::Value = resp.json().await.unwrap();`:

```rust
    let arr = list["plugins"].as_array().unwrap();
    assert_eq!(arr.len(), 4);
    assert!(list["errors"].as_array().unwrap().is_empty());

    let fsr = arr.iter().find(|p| p["name"] == "fs-read").unwrap();
    assert_eq!(fsr["port"], "Tool");
    assert_eq!(fsr["describe"]["port"], "Tool");
    assert!(!fsr["transcript"].as_array().unwrap().is_empty());

    let anthropic = arr.iter().find(|p| p["name"] == "anthropic").unwrap();
    assert_eq!(anthropic["port"], "LlmBackend");
```

(Drop the `anthropic … "method" == "llm.generate"` transcript assertion: the mock keeps its `llm.generate` sample frame, so it still holds — leave that block in place. Only change the `arr` extraction line at the top to `list["plugins"]`.)

- [ ] **Step 5: Build, test, and regenerate the TypeScript types**

Run: `cargo test -p tau-gateway --locked`
Expected: PASS — all gateway unit + integration tests. ts-rs `#[ts(export)]` writes `web/src/types/PluginError.ts`, `ToolCatalog.ts`, `PluginCatalog.ts` during the run.

Run: `git status --short web/src/types/`
Expected: three new untracked files: `PluginError.ts`, `PluginCatalog.ts`, `ToolCatalog.ts`. Open `PluginCatalog.ts` and confirm it reads roughly:

```ts
export type PluginCatalog = { plugins: Array<PluginDetail>, errors: Array<PluginError>, };
```

- [ ] **Step 6: Verify gate (no commit)**

Run: `cargo fmt --all && cargo clippy -p tau-gateway --all-targets -- -D warnings`
Expected: clean. Do NOT commit.

---

## Task 4: Web — Plugins tab un-gated + error rows

**Files:**
- Modify: `web/src/api/plugins.ts`
- Modify: `web/src/tools/PluginsTab.tsx`
- Modify: `web/src/tools/ToolsPage.tsx`
- Modify: `web/src/tools/PluginsTab.test.tsx`, `web/src/tools/ToolsPage.test.tsx`
- Create: `web/src/api/plugins.test.ts`

> Prereq: Task 3 generated `web/src/types/PluginCatalog.ts` + `PluginError.ts`.

- [ ] **Step 1: Update the failing component test (PluginsTab) to the envelope + error rows**

Replace `web/src/tools/PluginsTab.test.tsx` entirely:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PluginsTab } from "./PluginsTab";
import { ProjectProvider } from "../app/project-context";

const plugins = [
  {
    name: "fs-read",
    version: "1.0.0",
    source: "github.com/tau/fs-read",
    kind: "rust-cargo",
    binary: "fs-read",
    port: "Tool",
    protocol_version: 1,
    describe: {
      port: "Tool",
      protocol_version: 1,
      tool: { name: "fs-read", input_schema: { path: "string" } },
      capabilities: [],
    },
    transcript: [
      { direction: "out", method: "meta.handshake", payload: { protocol_version: 1 } },
      {
        direction: "in",
        method: "result",
        payload: { plugin_name: "fs-read", provides: "Tool" },
      },
    ],
  },
  {
    name: "anthropic",
    version: "0.1.0",
    source: "github.com/tau/anthropic",
    kind: "rust-cargo",
    binary: "anthropic",
    port: "LlmBackend",
    protocol_version: 1,
    describe: { port: "LlmBackend", protocol_version: 1, tool: null, capabilities: [] },
    transcript: [
      { direction: "out", method: "meta.handshake", payload: { protocol_version: 1 } },
      { direction: "in", method: "result", payload: { plugin_name: "anthropic" } },
    ],
  },
];

function stub(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

beforeEach(() => {
  stub({ plugins, errors: [] });
});

describe("PluginsTab", () => {
  it("lists plugins, selects the first by default, shows describe + transcript, no mock banner", async () => {
    render(
      <ProjectProvider pid="demo">
        <PluginsTab />
      </ProjectProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /fs-read/i })).toBeInTheDocument(),
    );
    // mock banner is gone now that the real path is the default
    expect(screen.queryByText(/mock data/i)).not.toBeInTheDocument();
    expect(screen.getByText(/fs-read\(path: string\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /meta\.handshake/i })).toBeInTheDocument();
  });

  it("renders an error row for a plugin that failed to introspect", async () => {
    stub({
      plugins: [],
      errors: [{ package: "shell", kind: "timeout", message: "describe timed out" }],
    });
    render(
      <ProjectProvider pid="demo">
        <PluginsTab />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("shell")).toBeInTheDocument());
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByText(/describe timed out/)).toBeInTheDocument();
    expect(screen.getByText(/no plugins/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd web && pnpm vitest run src/tools/PluginsTab.test.tsx`
Expected: FAIL — current `PluginsTab` reads `p[0]` off an array and renders the mock banner; the envelope shape + error rows aren't handled.

- [ ] **Step 3: Update the API helper**

Replace `web/src/api/plugins.ts`:

```ts
import type { PluginCatalog } from "../types/PluginCatalog";
import { request, scopedPath } from "./client";

export const listPlugins = (pid: string) =>
  request<PluginCatalog>(scopedPath(pid, "/plugins"));
```

- [ ] **Step 4: Update `PluginsTab.tsx`**

Replace the top of `web/src/tools/PluginsTab.tsx` down through the end of the `PluginsTab` function (lines 1-53) with:

```tsx
import { useEffect, useState } from "react";
import type { PluginCatalog } from "../types/PluginCatalog";
import type { PluginDetail } from "../types/PluginDetail";
import type { ProtocolFrame } from "../types/ProtocolFrame";
import { listPlugins } from "../api/plugins";
import { useProjectId } from "../app/project-context";

export function PluginsTab() {
  const pid = useProjectId();
  const [cat, setCat] = useState<PluginCatalog>({ plugins: [], errors: [] });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    listPlugins(pid)
      .then((c) => {
        setCat(c);
        setSelected((cur) => cur ?? c.plugins[0]?.name ?? null);
      })
      .catch(() => {});
  }, [pid]);

  const current = cat.plugins.find((p) => p.name === selected) ?? null;

  return (
    <div className="space-y-2">
      {cat.errors.length > 0 && (
        <ul className="space-y-0.5">
          {cat.errors.map((e) => (
            <li
              key={e.package}
              className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
            >
              <span aria-hidden>⚠</span>
              <span className="font-medium">{e.package}</span>
              <span className="rounded bg-amber-100 px-1 text-[8px] font-bold uppercase">
                {e.kind}
              </span>
              <span className="truncate text-muted">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-[160px_1fr] gap-3">
        <ul className="space-y-0.5">
          {cat.plugins.map((p) => (
            <li key={p.name}>
              <button
                onClick={() => setSelected(p.name)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs ${
                  p.name === selected ? "bg-accent/10 text-accent" : "text-muted hover:text-fg"
                }`}
              >
                <span className="font-medium">{p.name}</span>
                <PortBadge port={p.port} />
              </button>
            </li>
          ))}
        </ul>
        {current ? (
          <PluginDetailPane plugin={current} />
        ) : (
          <p className="text-xs text-muted">No plugins.</p>
        )}
      </div>
    </div>
  );
}
```

Leave `PortBadge`, `PluginDetailPane`, and `FrameRow` (lines 55-128) unchanged — `PluginDetailPane` still takes a `PluginDetail`, which is still imported.

- [ ] **Step 5: Remove the gated badge in `ToolsPage.tsx`**

In `web/src/tools/ToolsPage.tsx`, replace the Plugins button (lines 23-28) with:

```tsx
          <button className={chip(tab === "plugins")} onClick={() => setTab("plugins")}>
            Plugins
          </button>
```

- [ ] **Step 6: Fix `ToolsPage.test.tsx` (it asserts the old gated/mock UI)**

Replace `web/src/tools/ToolsPage.test.tsx`'s `beforeEach` and the test body:

```tsx
beforeEach(() => {
  // SkillsIndex wants an array; ToolsTab/PluginsTab want their envelopes.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url.endsWith("/skills")
            ? []
            : url.endsWith("/tools")
              ? { tools: [], error_count: 0 }
              : { plugins: [], errors: [] },
      }),
    ),
  );
});
```

```tsx
describe("ToolsPage tabs", () => {
  it("switches Skills → Tools → Plugins (no longer gated)", async () => {
    const user = userEvent.setup();
    renderAt();
    expect(screen.getByLabelText("import skill git url")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^tools$/i }));
    expect(screen.getByText("provides")).toBeInTheDocument();
    expect(screen.queryByLabelText("import skill git url")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /plugins/i }));
    // Plugins is a real tab now: empty envelope → "No plugins.", and no gated badge.
    expect(screen.getByText(/no plugins/i)).toBeInTheDocument();
    expect(screen.queryByText(/gated/i)).toBeNull();
  });
});
```

- [ ] **Step 7: Add the API contract test**

Create `web/src/api/plugins.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listPlugins } from "./plugins";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("plugins api", () => {
  it("listPlugins GETs the scoped path and decodes the envelope", async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ plugins: [], errors: [] }) });
    vi.stubGlobal("fetch", f);
    const cat = await listPlugins("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/plugins");
    expect(cat).toEqual({ plugins: [], errors: [] });
  });
});
```

- [ ] **Step 8: Run the web tests for this task + prettier**

Run: `cd web && pnpm vitest run src/tools/PluginsTab.test.tsx src/tools/ToolsPage.test.tsx src/api/plugins.test.ts`
Expected: PASS.

Run: `cd web && pnpm format && pnpm lint`
Expected: prettier writes/clean; eslint + tsc clean. Do NOT commit.

---

## Task 5: Web — Tools tab error-count notice

**Files:**
- Modify: `web/src/api/tools.ts`
- Modify: `web/src/tools/ToolsTab.tsx`
- Modify: `web/src/tools/ToolsTab.test.tsx`
- Create: `web/src/api/tools.test.ts`

> Prereq: Task 3 generated `web/src/types/ToolCatalog.ts`. Parallel-safe with Task 4 (disjoint files; both only read `ToolsPage.tsx`/types).

- [ ] **Step 1: Update the failing component test (ToolsTab) to the envelope + notice**

Replace `web/src/tools/ToolsTab.test.tsx`'s `beforeEach` + add a notice test. Change the stub to wrap the array:

```tsx
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tools, error_count: 0 }) }),
  );
});
```

Add a third test inside the `describe("ToolsTab", ...)` block:

```tsx
  it("shows a failed-introspection notice when error_count > 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tools: [], error_count: 2 }) }),
    );
    render(
      <ProjectProvider pid="demo">
        <ToolsTab />
      </ProjectProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/2 plugins failed to introspect/i)).toBeInTheDocument(),
    );
  });
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd web && pnpm vitest run src/tools/ToolsTab.test.tsx`
Expected: FAIL — `ToolsTab` reads an array and has no notice; envelope `.tools` access + the notice don't exist yet.

- [ ] **Step 3: Update the API helper**

Replace `web/src/api/tools.ts`:

```ts
import type { ToolCatalog } from "../types/ToolCatalog";
import { request, scopedPath } from "./client";

export const listTools = (pid: string) => request<ToolCatalog>(scopedPath(pid, "/tools"));
```

- [ ] **Step 4: Update `ToolsTab.tsx`**

Replace the top of `web/src/tools/ToolsTab.tsx` down through the end of the returned JSX of the `ToolsTab` function (lines 1-51) with:

```tsx
import { useEffect, useState } from "react";
import type { ToolCatalog } from "../types/ToolCatalog";
import { listTools } from "../api/tools";
import type { ToolDetail } from "../types/ToolDetail";
import { useProjectId } from "../app/project-context";

const MAX_CHIPS = 6;

export function ToolsTab() {
  const pid = useProjectId();
  const [cat, setCat] = useState<ToolCatalog>({ tools: [], error_count: 0 });
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    listTools(pid)
      .then(setCat)
      .catch(() => {});
  }, [pid]);

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {cat.error_count > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          {cat.error_count} plugin{cat.error_count === 1 ? "" : "s"} failed to introspect — see the
          Plugins tab.
        </div>
      )}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 pr-2 font-medium">tool</th>
            <th className="px-2 py-1 font-medium">version</th>
            <th className="px-2 py-1 font-medium">provides</th>
            <th className="px-2 py-1 font-medium">capabilities</th>
            <th className="px-2 py-1 font-medium">used by</th>
          </tr>
        </thead>
        <tbody>
          {cat.tools.map((t) => (
            <ToolRow
              key={t.name}
              tool={t}
              expanded={open.has(t.name)}
              onToggle={() => toggle(t.name)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Leave `ToolRow` (lines 53-136) unchanged — it still takes a `ToolDetail` and `ToolDetail` is still imported.

- [ ] **Step 5: Add the API contract test**

Create `web/src/api/tools.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listTools } from "./tools";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("tools api", () => {
  it("listTools GETs the scoped path and decodes the envelope", async () => {
    const f = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ tools: [], error_count: 0 }) });
    vi.stubGlobal("fetch", f);
    const cat = await listTools("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/tools");
    expect(cat).toEqual({ tools: [], error_count: 0 });
  });
});
```

- [ ] **Step 6: Run the web tests for this task + prettier**

Run: `cd web && pnpm vitest run src/tools/ToolsTab.test.tsx src/api/tools.test.ts`
Expected: PASS.

Run: `cd web && pnpm format && pnpm lint`
Expected: clean. Do NOT commit.

---

## Final verification (whole feature)

- [ ] **Run the full gate both stacks**

Run: `just fmt && just lint && just test`
Expected: PASS across web (vitest) and rust (cargo test). This is the same body CI's `ci-summary` runs.

- [ ] **Manual smoke against a real tau (optional, if a real `tau` is on PATH)**

Run the gateway with `--serve-kind real` against a project that has at least one plugin package installed, open the Tools and Plugins tabs, and confirm: real plugins appear, a `Tool`-port plugin shows a tool row, the Plugins tab shows no mock banner and no gated badge, and (if a plugin is broken) an error row appears with a count notice on Tools.

- [ ] **Report to the repo owner that the branch is ready and ask whether to commit.** Do NOT commit or push without explicit instruction.

---

## Self-review notes (author)

- **Spec coverage:** DQ1 cache/concurrency/timeout → Task 1 (`PluginIntrospector`, 60s TTL, 4-way, 15s kill). DQ2 corrected tool model → Task 2 `tool_detail_from` (Tool-port only, `tool.call` schema). DQ3 data-only detection → `classify` stderr `[plugin] table`. DQ4 shared seam → `Arc<PluginIntrospector>` into both `Cli*`. DQ5 failure UX → envelope A (plugins errors) + flat-B (tools error_count) + badge removal. DQ6 taxonomy → `IntrospectError` (ListFailed/Describe/Timeout/Parse; `DataOnly` is not an error). Cache invalidation → Task 3 step 2.
- **Placeholder scan:** none — every step shows full code/commands.
- **Type consistency:** `ToolCatalog{tools,error_count}`, `PluginCatalog{plugins,errors}`, `PluginError{package,kind,message}` used identically in Rust (Tasks 2-3), generated TS, and web (Tasks 4-5). `PluginInfo`/`Classified`/`tool_input_schema` defined in Task 1 and consumed by name in Task 2. `IntrospectError` kinds (`list`/`describe`/`timeout`/`parse`) match the `classify` arms and the test assertions.
- **Note for the executor:** `cargo clippy -D warnings` forbids unused enum variants — `IntrospectError` therefore omits a separate `TauSpawn` variant (a missing binary surfaces as `ListFailed`, since the list step is where it's first hit). Do not add unused variants.
