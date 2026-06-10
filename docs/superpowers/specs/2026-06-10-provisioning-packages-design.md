# D2a — Provisioning & packages (real tau) — design

**Status:** approved (brainstorm 2026-06-10)
**Sub-project:** D2a of the real-tau integration roadmap. D1 run-path + D3 validate/ship MERGED; D2 was split into **D2a (this — provisioning + package ops)** and **D2b (read-only inventory views: tools/plugins/skills)**; D4 (workflow/IR) still pending. See the `real-tau-integration-roadmap` memory.
**Relates to:** `gateway/src/packages/mod.rs` (`PackageOps`/`MockOps`/`CliOps`), `gateway/src/state.rs` (the package methods; `with_options` already wires `CliOps::new(bin, project)`), `gateway/src/api/packages.rs`, `web/src/packages/PackagesPage.tsx`, `web/src/types/Package.ts`, and the real `tau` CLI at `/Users/titouanlebocq/code/tau` (READ-ONLY).

## 1. Context & goal

The gateway's package seam (`CliOps`) is an unwired stub: reads return empty, writes return "not wired yet" errors. tau exposes the package lifecycle as **top-level verbs** (`tau list packages`, `tau install`, `tau uninstall`, `tau update`, `tau resolve`, `tau verify` — all honoring `--json` where applicable). D2a wires `CliOps` to them.

The package lifecycle is also the **provisioning primitive** for the rest of the roadmap: `tau install` writes a project's `tau-lock.toml` + `.tau/packages/` tree, which D3 build/verify and D1's live run ultimately need. `tau install` works **fully offline** against `file://` bare-git repos (tau honors `protocol.file.allow=always` — the pattern tau's own test suite uses).

**Principle (from D3): the UI is driven by tau.** Real `tau list --json` has no `status` field (that is a `tau verify` concept) and adds `scope`/`version_count`. So D2a **evolves** the `Package` type to tau's shape rather than keeping the mock's fabricated `status`.

**Goal:** against a real `tau` binary, the Packages screen lists real installed packages (scope + version_count), Verify reports tau's real integrity status, and install/uninstall/update/resolve drive real `tau`. Verified live and offline via a `file://` skill-package fixture. `MockOps` stays the deterministic oracle.

## 2. Locked decisions (brainstorm)

- **Evolve `Package`** to `{ name, version, source, scope, version_count }` (drop `status`); status is surfaced only by `verify`. (Option B "UI driven by tau", consistent with D3.)
- **Offline skill-package fixture**: a committed source package (`tau.toml` + `SKILL.md`, no compilation) that the gated live test turns into a `file://` bare-git repo at test time (`git init --bare`, author/commit/tag) and installs through the gateway. Repo stays clean (no committed `.tau/` tree or binaries).
- **Scope = package ops only.** The compiled-plugin provisioning that would fully unblock D3-build / D1-Ollama-run live (it needs `cargo build`-ed plugin binaries) is a **documented follow-up**, not D2a.
- **Mock stays the oracle**; real-tau paths are canned-output parser tests + a gated live round-trip (skips without `TAU_REAL_BIN` + git).
- **Out of scope:** the read-only tools/plugins/skills inventory views (→ D2b); `tau skill import` synthesis semantics.

## 3. `CliOps` implementation

`CliOps` already has `::new(bin, project)` and is selected by `with_options` when `!is_mock` — no `state.rs` wiring change. Each op shells `tau` with `current_dir(&self.project)` (tau resolves scope from the cwd; `tau list` rejects a `--project` flag). A shared helper runs a tau subcommand and returns `(ExitStatus, stdout, stderr)`.

- **`list() -> Vec<Package>`** → `tau list packages --json` → parse the array of `{name, version, source, scope, version_count}`. Empty/absent lockfile → `[]` (tau is lazy). Spawn error → empty vec.
- **`install(url) -> Result<Package>`** → guard `url` with `is_safe_pkg_url` (accept `https://`/`http://`/`ssh://`/`git://`/`file://` and scp-like `git@host:org/repo`; reject leading `-`), then `tau install <url> --json` (after `--`) → parse `{name, version, scope, path}` → `Package { name, version, source: url, scope, version_count: 1 }`. Non-zero exit → `anyhow::Error` with tau's stderr.
- **`uninstall(name) -> Result<()>`** → guard `name` with `is_safe_pkg_name` (`[A-Za-z0-9._-]+`, no leading `-`) → `tau uninstall <name>`; non-zero → error.
- **`update(name, to) -> Result<Package>`** → guard `name` → `tau update <name> [--version <to>] --json` (if tau update emits `--json`; else run then `tau list` and find the row) → `Package`. (Implementation confirms tau update's actual flags during the plan.)
- **`resolve() -> Result<Vec<Package>>`** → `tau resolve` (installs missing agent `requires.tools`; it has no `--json`), then `tau list packages --json` to return the resolved set.
- **`verify() -> Vec<VerifyResult>`** → `tau verify --json` (a JSONL **event stream**) → keep each `{event:"verify_package", name, status}` → `VerifyResult { name, status }` (`status` ∈ `ok`/`unverified`/`drift`). Exit code 2 (drift present) is data, not failure.

## 4. Evolved types

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Package {
    pub name: String,
    pub version: String,
    pub source: String,
    pub scope: String,        // "project" | "global"
    pub version_count: u32,
}
// VerifyResult { name, status } — unchanged shape; status now from tau verify.
```

`MockOps` updates to emit the evolved `Package` (seeded with `scope`/`version_count`; its `install`/`update` synthesize those fields), so the default gate + existing `config_packages` tests exercise the same type. ts-rs regenerates `web/src/types/Package.ts`.

## 5. Frontend (`web/src/packages/PackagesPage.tsx`)

- Add `scope` + `version_count` columns to the package table.
- The per-row status comes **only** from a Verify run (`status[p.name] ?? "—"`) — drop the `?? p.status` fallback (a package's integrity is unknown until verified). The Verify button populates the `status` map from `verify()` results.
- The install URL input, Resolve/Verify/uninstall/update actions, `name_from_url`, and `import_agent` (install-then-register) are unchanged behaviourally — they now drive real tau.

## 6. Safety

`install` URL and `uninstall`/`update` names are user input → both pass injection guards before reaching `Command`:
- `is_safe_pkg_url(url)` — reject leading `-`; accept only known schemes (`https/http/ssh/git/file`) or scp-like `user@host:path`. (Extends `cloner::is_safe_git_url` to also allow `file://`.)
- `is_safe_pkg_name(name)` — `[A-Za-z0-9._-]+`, non-empty, no leading `-`.
All values passed as single `.arg()` (no shell), with a `--` end-of-options terminator before the URL.

## 7. Testing

- **Mock oracle:** `MockOps` stays the default; existing `config_packages` API + `PackagesPage` tests keep passing against the evolved `Package`.
- **Type-evolution gate:** evolving `Package` breaks integration tests that the per-task `--lib` gate misses (D3 lesson) — the type-evolution task runs the **full** `cargo test -p tau-gateway` and updates `config_packages.rs`.
- **Canned-output parser tests:** captured real `tau list --json` + `tau verify --json` → assert the parse into `Package`/`VerifyResult`.
- **Gated live round-trip** (`gateway/tests/real_tau_packages.rs`, skips unless `TAU_REAL_BIN` + git present): build the `file://` bare repo from `gateway/tests/fixtures/pkg-src/` → `CliOps.install(file_url)` into a temp project → `list()` shows it → `verify()` reports `ok` → `uninstall()` removes it. This is D2a's proof the real offline install path works.

## 8. Out of scope / roadmap

- Read-only inventory views (tools/plugins/skills) → **D2b**.
- Compiled-plugin provisioning that fully unblocks D3-build / D1-Ollama-run live → documented follow-up (needs `cargo build`-ed plugin binaries in a `file://` fixture).
- D4 (workflow runner + IR inspector) → separate sub-project.
