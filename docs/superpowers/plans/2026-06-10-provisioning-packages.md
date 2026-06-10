# D2a — Provisioning & packages (real tau) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the gateway's `CliOps` package seam to the real `tau` CLI (`list`/`install`/`uninstall`/`update`/`resolve`/`verify`, all `--json`), evolving `Package` to tau's shape, verified live and offline against a `file://` skill-package fixture.

**Architecture:** `CliOps` shells `tau` with `current_dir(project)` (tau resolves scope from cwd; `tau list` rejects `--project`), mirroring `GitCloner`'s `Command::output()` pattern. Types evolve to tau's truth (drop the fabricated `Package.status`; add `scope`/`version_count`). `MockOps` stays the deterministic oracle; the real path is canned-output parser tests + one gated, `HOME`-isolated, offline round-trip.

**Tech Stack:** Rust (serde_json, std::process::Command), React/TS, real `tau` at `/Users/titouanlebocq/code/tau` (READ-ONLY).

**Conventions (every task):**
- Work in `/Users/titouanlebocq/code/tau-ui`. `cargo` for the gateway, `pnpm` from `web/`.
- ts-rs types regenerate on `cargo test -p tau-gateway`; commit the regenerated `web/src/types/*.ts`.
- Evolving a `#[ts(export)]` type can break `gateway/tests/*_api.rs` (the per-task `--lib` gate misses them) — the type-evolution task runs the **full** `cargo test -p tau-gateway`.
- Commit from the repo root. End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Captured real `tau --json` output (used as canned fixtures below) is embedded verbatim in the tasks.

---

## Task 1: Evolve `Package` + MockOps + PackagesPage (mock stays green)

**Files:**
- Modify: `gateway/src/packages/mod.rs` (type + MockOps + unit test)
- Modify: `web/src/packages/PackagesPage.tsx`, `web/src/packages/PackagesPage.test.tsx`
- Regenerate: `web/src/types/Package.ts`

- [ ] **Step 1: Evolve the `Package` struct + MockOps**

In `gateway/src/packages/mod.rs`, replace the `Package` struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Package {
    pub name: String,
    pub version: String,
    pub source: String,
    pub scope: String, // "project" | "global"
    pub version_count: u32,
}
```

In `MockOps`, update the `seed` closure + `install` to populate the new fields (drop `status`). Replace `MockOps::new`'s seed and the `install` body:

```rust
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
```

In `MockOps::install`, replace the `Package { … status … }` literal with:

```rust
        let pkg = Package {
            name: name.clone(),
            version: "1.0.0".into(),
            source: source_from_url(git_url),
            scope: "project".into(),
            version_count: 1,
        };
```

`MockOps::verify` is unchanged (it builds `VerifyResult { name, status }`, which is untouched). `update` is unchanged (mutates `version`).

- [ ] **Step 2: Update the packages unit test**

In `gateway/src/packages/mod.rs`'s `#[cfg(test)] mod tests`, the existing `mock_list_install_uninstall_verify` references no `Package.status` — but add a scope assertion to lock the new shape. Replace that test's body's install line region with an added assertion:

```rust
        let p = ops.install("https://github.com/acme/cooltool.git").unwrap();
        assert_eq!(p.name, "cooltool");
        assert_eq!(p.scope, "project");
        assert_eq!(p.version_count, 1);
```

(Leave the rest of the test — counts, uninstall, `verify().status == "ok"`, update version — unchanged.)

- [ ] **Step 3: Run the gateway test + regenerate the type**

Run: `cargo test -p tau-gateway --lib packages::`
Expected: PASS. Regenerates `web/src/types/Package.ts` (now `{ name, version, source, scope, version_count: number }`).

- [ ] **Step 4: Update PackagesPage.tsx**

Read `web/src/packages/PackagesPage.tsx`. Changes to the table:
- Add two header cells after `source`: `<th className="px-3 py-2 font-medium">scope</th>` and `<th className="px-3 py-2 font-medium">versions</th>`.
- In each row, after the `source` `<td>`, add:
```tsx
                <td className="px-3 py-2 text-muted">{p.scope}</td>
                <td className="px-3 py-2 font-mono text-muted">{p.version_count}</td>
```
- Change the status cell from `{status[p.name] ?? p.status}` to `{status[p.name] ?? "—"}` (a package's integrity is unknown until Verify runs).

- [ ] **Step 5: Update PackagesPage.test.tsx**

Read `web/src/packages/PackagesPage.test.tsx`. Update the mocked `Package` objects to the evolved shape (`{ name, version, source, scope, version_count }`, no `status`). Update any assertion that referenced `status` on a package row to the evolved behavior (status shows `—` until Verify; after Verify it shows the verify result). Preserve the test's intent (renders packages, install/verify actions). Match the file's existing mock mechanism.

- [ ] **Step 6: Typecheck + web test + commit**

Run:
```bash
cd web && pnpm typecheck && npx vitest run src/packages/PackagesPage.test.tsx
```
Expected: clean + pass.
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/packages/mod.rs web/src/types/Package.ts web/src/packages
git commit -m "feat(packages): evolve Package to tau's shape (scope/version_count; drop fabricated status)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Full gateway suite (catch integration-test drift)**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway`
Expected: all green. `config_packages.rs` asserts only package counts (not `status`), so it should pass unchanged. If any `*_api.rs` test fails on the type change, update it to the evolved shape and amend the commit.

---

## Task 2: CliOps read side — `list` / `verify` / `resolve`

**Files:**
- Modify: `gateway/src/packages/mod.rs` (parsers + CliOps read methods + tests)
- Create: `gateway/tests/fixtures/tau-json/pkg-list.json`, `pkg-verify.jsonl`

- [ ] **Step 1: Save captured real fixtures**

Create `gateway/tests/fixtures/tau-json/pkg-list.json` (real `tau list packages --json`):

```json
[{"name":"demo-skill","version":"0.1.0","source":"file:///tmp/demo-skill.git","scope":"global","version_count":1}]
```

Create `gateway/tests/fixtures/tau-json/pkg-verify.jsonl` (real `tau verify --json`):

```
{"event":"verify_started","total":1}
{"event":"verify_package","name":"demo-skill","status":"ok","version":"0.1.0"}
{"drift":0,"event":"verify_completed","ok":1,"total":1,"unverified":0}
```

- [ ] **Step 2: Write the failing parser tests**

Add to `gateway/src/packages/mod.rs`'s `#[cfg(test)] mod tests`:

```rust
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
```

- [ ] **Step 3: Run them to confirm they fail**

Run: `cargo test -p tau-gateway --lib packages::parse_`
Expected: FAIL to compile — `parse_list_json`/`parse_verify_jsonl` do not exist.

- [ ] **Step 4: Implement the parsers + a tau runner + CliOps read methods**

In `gateway/src/packages/mod.rs`, add `use std::process::Command;` (next to `use std::path::PathBuf;`).

Add the parsers (free fns):

```rust
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
```

Add a private runner method + the read impls. Replace `CliOps::list`, `CliOps::resolve`, `CliOps::verify` bodies (leave install/uninstall/update stubs for Task 3):

```rust
impl CliOps {
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
```

In `impl PackageOps for CliOps`, replace the `list`, `resolve`, `verify` bodies:

```rust
    fn list(&self) -> Vec<Package> {
        let (_, out, _) = self.run(&["list", "packages", "--json"]);
        parse_list_json(&out)
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
```

(Leave `install`/`uninstall`/`update` as their current stub `Err(...)` bodies for now — Task 3 wires them.)

- [ ] **Step 5: Run the parser tests**

Run: `cargo test -p tau-gateway --lib packages::`
Expected: PASS (mock test + 2 parser tests).

- [ ] **Step 6: Build + commit**

Run: `cargo build -p tau-gateway` (clean).
```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/packages/mod.rs gateway/tests/fixtures/tau-json/pkg-list.json gateway/tests/fixtures/tau-json/pkg-verify.jsonl
git commit -m "feat(packages): CliOps list/verify/resolve shell real tau --json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: CliOps write side — `install` / `uninstall` / `update` + guards

**Files:** Modify `gateway/src/packages/mod.rs`.

- [ ] **Step 1: Write the failing guard + install-parse tests**

Add to `gateway/src/packages/mod.rs`'s `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn safe_pkg_url_accepts_known_schemes_and_file() {
        assert!(is_safe_pkg_url("https://github.com/acme/bot.git"));
        assert!(is_safe_pkg_url("file:///tmp/x.git"));
        assert!(is_safe_pkg_url("git@github.com:acme/bot.git"));
        assert!(!is_safe_pkg_url("--upload-pack=evil"));
        assert!(!is_safe_pkg_url("/local/path"));
        assert!(!is_safe_pkg_url(""));
    }

    #[test]
    fn safe_pkg_name_rejects_flags() {
        assert!(is_safe_pkg_name("demo-skill"));
        assert!(is_safe_pkg_name("anthropic"));
        assert!(!is_safe_pkg_name("--version"));
        assert!(!is_safe_pkg_name("a/b"));
        assert!(!is_safe_pkg_name(""));
    }

    #[test]
    fn parse_install_json_builds_package() {
        let json = r#"{"name":"demo-skill","path":"/h/.tau/packages/demo-skill/0.1.0","scope":"global","version":"0.1.0"}"#;
        let p = parse_install_json(json, "file:///tmp/demo-skill.git");
        assert_eq!(p.name, "demo-skill");
        assert_eq!(p.version, "0.1.0");
        assert_eq!(p.scope, "global");
        assert_eq!(p.source, "file:///tmp/demo-skill.git");
        assert_eq!(p.version_count, 1);
    }
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `cargo test -p tau-gateway --lib packages::safe_pkg`
Expected: FAIL to compile — `is_safe_pkg_url`/`is_safe_pkg_name`/`parse_install_json` do not exist.

- [ ] **Step 3: Implement the guards + install parser + write methods**

In `gateway/src/packages/mod.rs`, add the guards + parser (free fns):

```rust
/// Accept only remote git URLs with a known scheme (or scp-like), plus local
/// `file://` (for offline fixtures). Never a leading `-` (flag smuggling).
fn is_safe_pkg_url(url: &str) -> bool {
    if url.is_empty() || url.starts_with('-') {
        return false;
    }
    const SCHEMES: [&str; 5] = ["https://", "http://", "ssh://", "git://", "file://"];
    let scheme_ok = SCHEMES.iter().any(|s| url.starts_with(s));
    let scp_like = !url.contains("://")
        && url.find(':').map(|c| url[..c].contains('@')).unwrap_or(false);
    scheme_ok || scp_like
}

/// A package name is a single token: `[A-Za-z0-9._-]+`, no leading `-`.
fn is_safe_pkg_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn parse_install_json(stdout: &str, url: &str) -> Package {
    let v: serde_json::Value = serde_json::from_str(stdout.trim()).unwrap_or(serde_json::Value::Null);
    Package {
        name: v["name"].as_str().unwrap_or("").to_string(),
        version: v["version"].as_str().unwrap_or("").to_string(),
        source: url.to_string(),
        scope: v["scope"].as_str().unwrap_or("").to_string(),
        version_count: 1,
    }
}
```

Replace the `install`/`uninstall`/`update` bodies in `impl PackageOps for CliOps`:

```rust
    fn install(&self, git_url: &str) -> Result<Package> {
        if !is_safe_pkg_url(git_url) {
            return Err(anyhow!("invalid package url: {git_url}"));
        }
        let (ok, out, err) = self.run(&["install", git_url, "--json"]);
        if !ok {
            return Err(anyhow!("tau install failed: {}", err.trim()));
        }
        Ok(parse_install_json(&out, git_url))
    }
    fn uninstall(&self, name: &str) -> Result<()> {
        if !is_safe_pkg_name(name) {
            return Err(anyhow!("invalid package name: {name}"));
        }
        let (ok, _, err) = self.run(&["uninstall", name, "--json"]);
        if !ok {
            return Err(anyhow!("tau uninstall failed: {}", err.trim()));
        }
        Ok(())
    }
    fn update(&self, name: &str, to: Option<String>) -> Result<Package> {
        if !is_safe_pkg_name(name) {
            return Err(anyhow!("invalid package name: {name}"));
        }
        let mut args: Vec<&str> = vec!["update", name];
        if let Some(v) = to.as_deref() {
            args.push("--version");
            args.push(v);
        }
        args.push("--json");
        let (ok, _, err) = self.run(&args);
        if !ok {
            return Err(anyhow!("tau update failed: {}", err.trim()));
        }
        // `tau update` JSON is an event stream; re-list and return the updated row.
        self.list()
            .into_iter()
            .find(|p| p.name == name)
            .ok_or_else(|| anyhow!("package {name} not found after update"))
    }
```

> Note: `git_url`/`name` are passed as single `.arg()` values (via `run(&[...])` → `Command::args`), never shell-interpolated; the guards are defense-in-depth against flag smuggling. `to` (the `--version` value) is also a single arg.

- [ ] **Step 4: Run the tests + build**

Run: `cargo test -p tau-gateway --lib packages:: && cargo build -p tau-gateway`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/src/packages/mod.rs
git commit -m "feat(packages): CliOps install/uninstall/update shell real tau (url/name guarded)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Gated offline round-trip (the real-tau proof)

**Files:** Create `gateway/tests/real_tau_packages.rs`.

This test builds a `file://` bare-git skill package at runtime, isolates `HOME` to a tempdir (so install writes to `<tmp>/.tau`, NOT the dev's real `~/.tau`), and drives the gateway's `CliOps` through install → list → verify → uninstall. Skips unless `TAU_REAL_BIN` + `git` are present.

- [ ] **Step 1: Create the gated round-trip test**

Create `gateway/tests/real_tau_packages.rs`:

```rust
//! Offline package round-trip against a REAL `tau` binary. Skips unless
//! `TAU_REAL_BIN` points at a runnable tau. Builds a `file://` bare-git skill
//! package at runtime and isolates HOME so install never touches the dev's
//! real `~/.tau`.

use std::path::{Path, PathBuf};
use std::process::Command;
use tau_gateway::packages::{CliOps, PackageOps};

fn real_bin() -> Option<PathBuf> {
    std::env::var("TAU_REAL_BIN").ok().map(PathBuf::from).filter(|p| p.exists())
}

fn git(args: &[&str], cwd: &Path) {
    let ok = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@t")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(ok, "git {:?} failed", args);
}

/// Author a skill package whose manifest `source` == the bare-repo url, commit,
/// tag, and bare-clone. Returns the `file://…demo-skill.git` url.
fn build_skill_package(root: &Path) -> String {
    let bare = root.join("demo-skill.git");
    let url = format!("file://{}", bare.display());
    let pkg = root.join("pkg");
    std::fs::create_dir_all(&pkg).unwrap();
    std::fs::write(
        pkg.join("tau.toml"),
        format!(
            "name = \"demo-skill\"\nversion = \"0.1.0\"\n\
             description = \"A tiny demo skill.\"\nauthors = []\n\
             source = \"{url}\"\nkind = \"skill\"\ndependencies = []\n\n\
             [[capabilities]]\nkind = \"fs.read\"\npaths = [\"${{SKILL_DIR}}/**\"]\n\n[skill]\n"
        ),
    )
    .unwrap();
    std::fs::write(
        pkg.join("SKILL.md"),
        "---\nname: demo-skill\ndescription: A tiny demo skill.\n---\n\n# Demo Skill\nHello.\n",
    )
    .unwrap();
    git(&["init", "-q"], &pkg);
    git(&["add", "-A"], &pkg);
    git(&["commit", "-qm", "v"], &pkg);
    git(&["tag", "v0.1.0"], &pkg);
    git(&["clone", "-q", "--bare", pkg.to_str().unwrap(), bare.to_str().unwrap()], root);
    url
}

#[test]
fn real_tau_package_round_trip_offline() {
    let Some(bin) = real_bin() else {
        eprintln!("skip: set TAU_REAL_BIN");
        return;
    };
    if Command::new("git").arg("--version").output().is_err() {
        eprintln!("skip: git not available");
        return;
    }

    let root = tempfile::tempdir().unwrap();
    // Isolate HOME so global-scope install writes under <tmp>/.tau, not ~/.tau.
    // SAFETY: single-threaded gated test; no other test reads HOME concurrently.
    std::env::set_var("HOME", root.path());

    let url = build_skill_package(root.path());

    let proj = root.path().join("proj");
    std::fs::create_dir_all(&proj).unwrap();
    std::fs::write(proj.join("tau.toml"), "[project]\nname = \"p\"\n").unwrap();

    let ops = CliOps::new(bin, proj.clone());

    // install
    let installed = ops.install(&url).expect("install");
    assert_eq!(installed.name, "demo-skill");
    assert_eq!(installed.version, "0.1.0");

    // list shows it
    assert!(ops.list().iter().any(|p| p.name == "demo-skill"), "list: {:?}", ops.list());

    // verify reports ok
    let v = ops.verify();
    assert!(v.iter().any(|r| r.name == "demo-skill" && r.status == "ok"), "verify: {v:?}");

    // uninstall removes it
    ops.uninstall("demo-skill").expect("uninstall");
    assert!(!ops.list().iter().any(|p| p.name == "demo-skill"), "still listed after uninstall");
}
```

> `tau_gateway::packages::{CliOps, PackageOps}` must be reachable — `packages` is a `pub mod` and these are `pub`. If `std::env::set_var` requires `unsafe` (Rust 2024 edition), wrap that single line in `unsafe { … }` and keep the SAFETY comment. Check the workspace edition (`grep edition Cargo.toml`) while implementing.

- [ ] **Step 2: Confirm it compiles + skips cleanly (no real tau)**

Run: `cargo test -p tau-gateway --test real_tau_packages`
Expected: PASS (skips — `TAU_REAL_BIN` unset).

- [ ] **Step 3: Run once against real tau**

Run:
```bash
TAU_REAL_BIN=/Users/titouanlebocq/code/tau/target/debug/tau \
  cargo test -p tau-gateway --test real_tau_packages -- --nocapture 2>&1 | tail -20
```
Expected: the round-trip passes (install → list shows demo-skill → verify ok → uninstall). If the real binary is missing/wrong-arch, capture the error and note it — the gate does not depend on this. Confirm the dev's real `~/.tau` is untouched (the test set `HOME` to a tempdir).

- [ ] **Step 4: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add gateway/tests/real_tau_packages.rs
git commit -m "test(packages): gated offline real-tau install/list/verify/uninstall round-trip

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final gate

**Files:** none (verification + fixups).

- [ ] **Step 1: Rust build + fmt + clippy + test**

Run:
```bash
cd /Users/titouanlebocq/code/tau-ui
cargo fmt -p tau-gateway
cargo clippy -p tau-gateway --all-targets --all-features -- -D warnings 2>&1 | grep -v "ts-rs failed to parse" | grep -E "warning|error" | head
cargo test -p tau-gateway
```
Expected: clippy clean (ignoring pre-existing ts-rs notes); all tests pass (incl. `real_tau_packages` skipping).

- [ ] **Step 2: Web gate**

Run:
```bash
cd web && pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
Expected: all green.

- [ ] **Step 3: ts-rs drift gate**

Run: `cargo test -p tau-gateway` then `git status --porcelain web/src/types`.
Expected: empty (Package.ts already committed).

- [ ] **Step 4: Commit any fixups**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "chore: fmt + lint after the provisioning/packages seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage** (`2026-06-10-provisioning-packages-design.md`):
- §3 CliOps ops (list/install/uninstall/update/resolve/verify via `current_dir`, guards) → Tasks 2 (read) + 3 (write). ✓
- §4 evolved `Package` (scope/version_count, drop status) + MockOps → Task 1. ✓
- §5 PackagesPage (scope/version_count columns; status from verify only) → Task 1. ✓
- §6 safety (`is_safe_pkg_url` incl. `file://`, `is_safe_pkg_name`, single-arg) → Task 3. ✓
- §7 testing (mock oracle; canned list/verify parser tests; gated offline round-trip; full-suite gate on type evolution) → Tasks 1 (full suite), 2 (canned), 4 (gated). ✓
- §8 out of scope (inventory views, compiled-plugin provisioning) → untouched. ✓

**Placeholder scan:** No TBD/TODO. The `tau update` JSON-stream handling is concrete (run + re-list). The `set_var` edition note is an explicit, bounded conditional with a fallback (`unsafe {}`), not a placeholder.

**Type/signature consistency:** `Package{name,version,source,scope,version_count:u32}`, `VerifyResult{name,status}` (unchanged), `is_safe_pkg_url`/`is_safe_pkg_name`/`parse_list_json`/`parse_verify_jsonl`/`parse_install_json`/`CliOps::run` each defined once and used consistently. `CliOps::new(bin,project)` is pre-existing (no `state.rs` change). Captured real JSON shapes (`list`→`{name,version,source,scope,version_count}`, `install`→`{name,version,scope,path}`, `verify`→`{event:"verify_package",name,status,version}`) match the parsers.
