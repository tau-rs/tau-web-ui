# Sessions View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Sessions surface to tau-ui — list, inspect (transcript), and export the persisted `tau chat` sessions, wired to the real `tau session` CLI via a Mock/Cli seam.

**Architecture:** A new `gateway/src/sessions/` module follows the established sidecar-seam pattern (`SessionsSource` trait, `MockSessions` for the fake-serve tier, `CliSessions` shelling `tau session list/export` in the project dir). Three GET routes nest under `/api/projects/{pid}`. The web adds a `Sessions` nav entry, a paginated list page, and a detail page with a dedicated, defensive transcript renderer. Project scope only; no mutation.

**Tech Stack:** Rust (axum, serde, thiserror, ts-rs), React 19 + TypeScript + Tailwind v4, vitest, react-router v7.

**Spec:** `docs/superpowers/specs/2026-06-13-sessions-view-design.md`

**Conventions (from `.context/handoffs/README.md`):**
- Gateway never links tau crates — shells out, parses `--json`. Don't break this.
- Per-task frontend gates omit `format:check`, so **every web task ends by running `prettier`**.
- Use `pnpm` (not npm). Node 20+ (works under 26).
- Conventional commits, imperative, scoped. **Commit at each task's final step.**
- Wire types are exported by ts-rs into `web/src/types/` automatically when `cargo test` runs the generated `export_bindings_*` tests (`.cargo/config.toml` sets `TS_RS_EXPORT_DIR=web/src/types`).

---

## File Structure

**Gateway (create):**
- `gateway/src/sessions/mod.rs` — types, `SessionsSource` trait, `MockSessions`, `CliSessions`, `SessionError`, parsers, guards. Inline `#[cfg(test)]` parser/guard unit tests.
- `gateway/src/api/sessions.rs` — three handlers + error mapping.
- `gateway/tests/sessions_api.rs` — mock-tier HTTP contract test (all status codes).
- `gateway/tests/real_tau_sessions.rs` — `TAU_REAL_BIN`-gated round-trip over a seeded on-disk session.
- `gateway/tests/fixtures/tau-json/session-list.json` — captured `tau session list --json` JSONL.
- `gateway/tests/fixtures/tau-json/session-export.json` — captured `tau session export --format json` envelope.

**Gateway (modify):**
- `gateway/src/lib.rs` — add `pub mod sessions;`.
- `gateway/src/state.rs` — `Inner.sessions_source` field, wiring in `with_options`, three delegating methods.
- `gateway/src/api/mod.rs` — `pub mod sessions;` + three routes.

**Web (create):**
- `web/src/api/sessions.ts` — typed endpoints.
- `web/src/sessions/SessionsPage.tsx` — list + filter + pagination.
- `web/src/sessions/SessionDetailPage.tsx` — header, tiles, export, transcript.
- `web/src/sessions/SessionTranscript.tsx` — defensive message/turn renderer.
- `web/src/api/sessions.test.ts`, `web/src/sessions/SessionsPage.test.tsx`, `web/src/sessions/SessionTranscript.test.tsx`.

**Web (modify):**
- `web/src/App.tsx` — two routes.
- `web/src/app/Sidebar.tsx` — nav entry.

**Generated (do not hand-edit):** `web/src/types/SessionSummary.ts`, `SessionDetail.ts`, `SessionHeader.ts`, `SessionPackage.ts`, `TurnSummary.ts`, `ExportFormat.ts`.

---

## Task 1: Gateway sessions module — types, errors, guards, parsers

**Files:**
- Create: `gateway/src/sessions/mod.rs`
- Modify: `gateway/src/lib.rs`
- Create: `gateway/tests/fixtures/tau-json/session-list.json`
- Create: `gateway/tests/fixtures/tau-json/session-export.json`

- [ ] **Step 1: Register the module**

In `gateway/src/lib.rs`, add the module in alphabetical order (after `pub mod serve_client;`... actually after `pub mod providers;` — keep alpha: it goes between `serve_client` and `ship`):

```rust
pub mod sessions;
```
(Place it so the list stays sorted: `... serve_client; sessions; ship; ...`.)

- [ ] **Step 2: Write the two fixtures**

`gateway/tests/fixtures/tau-json/session-list.json` (JSONL — envelope line then two rows):

```
{"event":"sessions","total":2,"limit":0}
{"event":"session","id":"018f5a2c-0000-0000-0000-000000000001","prefix":"018f5a2c","agent":"coder","created_at":"2026-06-12T14:33:21Z","turns":2,"title":null}
{"event":"session","id":"02b13f99-0000-0000-0000-000000000003","prefix":"02b13f99","agent":"reviewer","created_at":"2026-06-11T09:11:02Z","turns":1,"title":null}
```

`gateway/tests/fixtures/tau-json/session-export.json` (single envelope, `export --format json`):

```json
{
  "header": {
    "type": "header",
    "schema": 1,
    "id": "018f5a2c-0000-0000-0000-000000000001",
    "created_at": "2026-06-12T14:33:21Z",
    "agent_id": "coder",
    "package": { "name": "my-agent", "version": "1.0.0", "resolved_commit": "0000000000000000000000000000000000000000" },
    "llm_backend": "anthropic",
    "title": null
  },
  "messages": [
    { "from": "user", "payload": { "text": "refactor the parser" } },
    { "from": "assistant", "payload": { "text": "Here is the plan" } }
  ],
  "turn_summaries": [
    { "turn": 1, "stop_reason": "EndTurn", "input_tokens": 1840, "output_tokens": 210 }
  ]
}
```

- [ ] **Step 3: Write the module skeleton — types, error, guards, parsers (no tests yet)**

Create `gateway/src/sessions/mod.rs`:

```rust
//! Persisted `tau chat` sessions: a read-only sidecar seam over `tau session
//! list/export`. Project scope only (the `Cli` seam carries a `global` flag for a
//! future toggle). The gateway never links tau crates — it shells out and parses
//! `--json`. The inner message body is passed through opaquely (`Vec<Value>`); the
//! header and turn summaries are typed (stable per the on-disk `schema:1` contract).

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionSummary {
    pub id: String,
    pub prefix: String,
    pub agent: String,
    pub created_at: String,
    pub turns: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionPackage {
    pub name: String,
    pub version: String,
    pub resolved_commit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionHeader {
    pub id: String,
    pub created_at: String,
    pub agent_id: String,
    pub llm_backend: String,
    pub package: SessionPackage,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TurnSummary {
    pub turn: u32,
    pub stop_reason: String,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionDetail {
    pub header: SessionHeader,
    /// Opaque passthrough of each `tau_domain::Message` — never interpreted here.
    #[ts(type = "Array<unknown>")]
    pub messages: Vec<Value>,
    pub turn_summaries: Vec<TurnSummary>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Jsonl,
    Md,
    Json,
}

impl ExportFormat {
    pub fn as_arg(self) -> &'static str {
        match self {
            ExportFormat::Jsonl => "jsonl",
            ExportFormat::Md => "md",
            ExportFormat::Json => "json",
        }
    }
    pub fn content_type(self) -> &'static str {
        match self {
            ExportFormat::Jsonl => "application/x-ndjson",
            ExportFormat::Md => "text/markdown; charset=utf-8",
            ExportFormat::Json => "application/json",
        }
    }
    pub fn ext(self) -> &'static str {
        self.as_arg()
    }
    pub fn parse(s: &str) -> Result<Self, SessionError> {
        match s {
            "jsonl" => Ok(ExportFormat::Jsonl),
            "md" => Ok(ExportFormat::Md),
            "json" => Ok(ExportFormat::Json),
            other => Err(SessionError::BadFormat(format!("unknown export format: {other}"))),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("session not found: {0}")]
    NotFound(String),
    #[error("ambiguous session id prefix")]
    AmbiguousPrefix(Vec<String>),
    #[error("bad request: {0}")]
    BadFormat(String),
    #[error("malformed tau output: {0}")]
    MalformedOutput(String),
    #[error("tau error: {0}")]
    Tau(String),
}

/// Reject anything that isn't a hex/UUID id of 8..=36 chars, before it reaches the
/// `tau` argv (no flag/argument injection).
pub fn guard_id(id: &str) -> Result<(), SessionError> {
    let ok = (8..=36).contains(&id.len())
        && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
    if ok {
        Ok(())
    } else {
        Err(SessionError::BadFormat(format!("invalid session id: {id}")))
    }
}

/// Parse `tau session list --json` (JSONL): skip the `event:"sessions"` envelope,
/// map each `event:"session"` row. A non-JSON non-empty line is malformed output.
pub fn parse_list(stdout: &str) -> Result<Vec<SessionSummary>, SessionError> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: Value =
            serde_json::from_str(line).map_err(|e| SessionError::MalformedOutput(e.to_string()))?;
        if v.get("event").and_then(Value::as_str) != Some("session") {
            continue;
        }
        out.push(SessionSummary {
            id: v["id"].as_str().unwrap_or_default().to_string(),
            prefix: v["prefix"].as_str().unwrap_or_default().to_string(),
            agent: v["agent"].as_str().unwrap_or_default().to_string(),
            created_at: v["created_at"].as_str().unwrap_or_default().to_string(),
            turns: v["turns"].as_u64().unwrap_or(0) as u32,
        });
    }
    Ok(out)
}

/// Parse the `tau session export --format json` envelope. Its shape is exactly
/// `SessionDetail` (extra header fields `type`/`schema`/`title` are ignored by serde).
pub fn parse_detail(stdout: &str) -> Result<SessionDetail, SessionError> {
    serde_json::from_str(stdout.trim()).map_err(|e| SessionError::MalformedOutput(e.to_string()))
}

/// Map a failed `tau` invocation's stderr to a typed error. The id already passed
/// `guard_id`, so a failure is most likely not-found; ambiguous prefixes are flagged
/// distinctly by substring (tau prints "ambiguous").
fn classify_err(stderr: &str) -> SessionError {
    let s = stderr.to_lowercase();
    if s.contains("ambiguous") {
        SessionError::AmbiguousPrefix(Vec::new())
    } else if s.contains("not found") || s.contains("no session") || s.contains("unknown") {
        SessionError::NotFound(stderr.trim().to_string())
    } else {
        SessionError::Tau(stderr.trim().to_string())
    }
}

pub trait SessionsSource: Send + Sync {
    fn list(&self) -> Result<Vec<SessionSummary>, SessionError>;
    fn show(&self, id: &str) -> Result<SessionDetail, SessionError>;
    fn export(&self, id: &str, fmt: ExportFormat) -> Result<Vec<u8>, SessionError>;
}
```

- [ ] **Step 4: Add the inline unit tests at the bottom of `mod.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = include_str!("../../tests/fixtures/tau-json/session-list.json");
    const DETAIL: &str = include_str!("../../tests/fixtures/tau-json/session-export.json");

    #[test]
    fn parse_list_skips_envelope_and_maps_rows() {
        let rows = parse_list(LIST).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "018f5a2c-0000-0000-0000-000000000001");
        assert_eq!(rows[0].prefix, "018f5a2c");
        assert_eq!(rows[0].agent, "coder");
        assert_eq!(rows[0].turns, 2);
    }

    #[test]
    fn parse_list_rejects_malformed() {
        let err = parse_list("not json at all").unwrap_err();
        assert!(matches!(err, SessionError::MalformedOutput(_)));
    }

    #[test]
    fn parse_detail_reads_envelope() {
        let d = parse_detail(DETAIL).unwrap();
        assert_eq!(d.header.agent_id, "coder");
        assert_eq!(d.header.llm_backend, "anthropic");
        assert_eq!(d.header.package.name, "my-agent");
        assert_eq!(d.messages.len(), 2);
        assert_eq!(d.turn_summaries.len(), 1);
        assert_eq!(d.turn_summaries[0].input_tokens, Some(1840));
    }

    #[test]
    fn guard_id_rejects_short_and_flaglike() {
        assert!(guard_id("018f5a2c-0000-0000-0000-000000000001").is_ok());
        assert!(guard_id("018f5a2c").is_ok());
        assert!(matches!(guard_id("short"), Err(SessionError::BadFormat(_))));
        assert!(matches!(guard_id("--global"), Err(SessionError::BadFormat(_))));
    }

    #[test]
    fn export_format_parse_roundtrip() {
        assert!(matches!(ExportFormat::parse("md").unwrap(), ExportFormat::Md));
        assert!(matches!(ExportFormat::parse("xml"), Err(SessionError::BadFormat(_))));
    }
}
```

- [ ] **Step 5: Run the tests (they will fail — `MockSessions`/`CliSessions` not yet defined, but these tests don't need them; the module must compile)**

Run: `cargo test -p tau-gateway --lib sessions::tests 2>&1 | tail -20`
Expected: the 5 tests PASS (the module compiles — trait + free functions only). If `ExportFormat`/`SessionError` unused-warning fails the build under `-D warnings`, note clippy runs separately; `cargo test` does not deny warnings. Proceed.

- [ ] **Step 6: Confirm ts-rs exported the types**

Run: `cargo test -p tau-gateway --lib 2>&1 | tail -5 && ls web/src/types/Session*.ts web/src/types/TurnSummary.ts web/src/types/ExportFormat.ts`
Expected: files `SessionSummary.ts`, `SessionDetail.ts`, `SessionHeader.ts`, `SessionPackage.ts`, `TurnSummary.ts`, `ExportFormat.ts` exist. `SessionDetail.ts` should show `messages: Array<unknown>`.

- [ ] **Step 7: Commit**

```bash
git add gateway/src/sessions/mod.rs gateway/src/lib.rs gateway/tests/fixtures/tau-json/session-list.json gateway/tests/fixtures/tau-json/session-export.json web/src/types/Session*.ts web/src/types/TurnSummary.ts web/src/types/ExportFormat.ts
git commit -m "feat(gateway): sessions module types + parsers"
```

---

## Task 2: MockSessions and CliSessions implementations

**Files:**
- Modify: `gateway/src/sessions/mod.rs`

- [ ] **Step 1: Write a failing test for `MockSessions` prefix resolution**

Add to the `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn mock_resolves_exact_prefix_and_ambiguous() {
        let m = MockSessions::new();
        // three seeded sessions; #1 and #2 share prefix "018f5a2c"
        assert_eq!(m.list().unwrap().len(), 3);
        // exact id → ok
        assert!(m.show("018f5a2c-0000-0000-0000-000000000001").is_ok());
        // unique prefix → ok
        assert!(m.show("02b13f99").is_ok());
        // shared 8-char prefix → ambiguous
        assert!(matches!(m.show("018f5a2c"), Err(SessionError::AmbiguousPrefix(_))));
        // no match → not found
        assert!(matches!(m.show("ffffffff"), Err(SessionError::NotFound(_))));
    }

    #[test]
    fn mock_export_json_is_parseable_detail() {
        let m = MockSessions::new();
        let bytes = m
            .export("02b13f99", ExportFormat::Json)
            .unwrap();
        let d = parse_detail(std::str::from_utf8(&bytes).unwrap()).unwrap();
        assert_eq!(d.header.agent_id, "reviewer");
    }
```

- [ ] **Step 2: Run it — fails (no `MockSessions`)**

Run: `cargo test -p tau-gateway --lib sessions::tests::mock 2>&1 | tail -10`
Expected: compile error `cannot find type MockSessions`.

- [ ] **Step 3: Implement `MockSessions` (insert above the `#[cfg(test)]` block)**

```rust
fn summary_of(d: &SessionDetail) -> SessionSummary {
    let id = d.header.id.clone();
    let prefix = id.chars().take(8).collect();
    SessionSummary {
        prefix,
        agent: d.header.agent_id.clone(),
        created_at: d.header.created_at.clone(),
        turns: d.turn_summaries.len() as u32,
        id,
    }
}

/// In-memory seam for the fake-serve tier. Seeds three sessions; #1 and #2 share an
/// 8-char prefix so the HTTP contract test can exercise 409 (ambiguous) and 404.
pub struct MockSessions {
    sessions: Vec<SessionDetail>,
}

impl MockSessions {
    pub fn new() -> Self {
        let mk = |id: &str, agent: &str, msg: &str| SessionDetail {
            header: SessionHeader {
                id: id.to_string(),
                created_at: "2026-06-12T14:33:21Z".to_string(),
                agent_id: agent.to_string(),
                llm_backend: "anthropic".to_string(),
                package: SessionPackage {
                    name: "my-agent".to_string(),
                    version: "1.0.0".to_string(),
                    resolved_commit: "0".repeat(40),
                },
            },
            messages: vec![
                serde_json::json!({ "from": "user", "payload": { "text": msg } }),
                serde_json::json!({ "from": "assistant", "payload": { "text": "ok" } }),
            ],
            turn_summaries: vec![TurnSummary {
                turn: 1,
                stop_reason: "EndTurn".to_string(),
                input_tokens: Some(1840),
                output_tokens: Some(210),
            }],
        };
        Self {
            sessions: vec![
                mk("018f5a2c-0000-0000-0000-000000000001", "coder", "refactor the parser"),
                mk("018f5a2c-0000-0000-0000-000000000002", "reviewer", "review the diff"),
                mk("02b13f99-0000-0000-0000-000000000003", "reviewer", "summarize"),
            ],
        }
    }

    fn resolve(&self, id: &str) -> Result<&SessionDetail, SessionError> {
        if let Some(s) = self.sessions.iter().find(|s| s.header.id == id) {
            return Ok(s);
        }
        let matches: Vec<&SessionDetail> =
            self.sessions.iter().filter(|s| s.header.id.starts_with(id)).collect();
        match matches.len() {
            0 => Err(SessionError::NotFound(id.to_string())),
            1 => Ok(matches[0]),
            _ => Err(SessionError::AmbiguousPrefix(
                matches.iter().map(|s| s.header.id.chars().take(8).collect()).collect(),
            )),
        }
    }
}

impl Default for MockSessions {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionsSource for MockSessions {
    fn list(&self) -> Result<Vec<SessionSummary>, SessionError> {
        Ok(self.sessions.iter().map(summary_of).collect())
    }
    fn show(&self, id: &str) -> Result<SessionDetail, SessionError> {
        guard_id(id)?;
        self.resolve(id).cloned()
    }
    fn export(&self, id: &str, fmt: ExportFormat) -> Result<Vec<u8>, SessionError> {
        guard_id(id)?;
        let s = self.resolve(id)?;
        let bytes = match fmt {
            ExportFormat::Json => serde_json::to_vec_pretty(s).unwrap_or_default(),
            ExportFormat::Jsonl => {
                let mut buf = serde_json::to_string(&s.header).unwrap_or_default();
                for m in &s.messages {
                    buf.push('\n');
                    buf.push_str(&serde_json::to_string(m).unwrap_or_default());
                }
                buf.into_bytes()
            }
            ExportFormat::Md => {
                format!("# Session {}\n\nagent: {}\n", &id[..id.len().min(8)], s.header.agent_id)
                    .into_bytes()
            }
        };
        Ok(bytes)
    }
}
```

- [ ] **Step 4: Run the mock tests — pass**

Run: `cargo test -p tau-gateway --lib sessions::tests::mock 2>&1 | tail -10`
Expected: both `mock_*` tests PASS.

- [ ] **Step 5: Implement `CliSessions` (insert after `MockSessions`)**

```rust
/// Real-tau seam: shells `tau session list/export` in the project dir. `global` is
/// false in v1; the field exists so a future scope toggle is a one-line change.
pub struct CliSessions {
    bin: PathBuf,
    project: PathBuf,
    global: bool,
}

impl CliSessions {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        Self { bin, project, global: false }
    }

    fn run(&self, args: &[&str]) -> Result<(bool, String, String), SessionError> {
        let mut argv: Vec<&str> = args.to_vec();
        if self.global {
            argv.push("--global");
        }
        Command::new(&self.bin)
            .args(&argv)
            .current_dir(&self.project)
            .output()
            .map(|o| {
                (
                    o.status.success(),
                    String::from_utf8_lossy(&o.stdout).into_owned(),
                    String::from_utf8_lossy(&o.stderr).into_owned(),
                )
            })
            .map_err(|e| SessionError::Tau(e.to_string()))
    }
}

impl SessionsSource for CliSessions {
    fn list(&self) -> Result<Vec<SessionSummary>, SessionError> {
        let (ok, out, err) = self.run(&["session", "list", "--all", "--json"])?;
        if !ok {
            return Err(SessionError::Tau(err.trim().to_string()));
        }
        parse_list(&out)
    }

    fn show(&self, id: &str) -> Result<SessionDetail, SessionError> {
        guard_id(id)?;
        let (ok, out, err) = self.run(&["session", "export", id, "--format", "json"])?;
        if !ok {
            return Err(classify_err(&err));
        }
        parse_detail(&out)
    }

    fn export(&self, id: &str, fmt: ExportFormat) -> Result<Vec<u8>, SessionError> {
        guard_id(id)?;
        let (ok, out, err) = self.run(&["session", "export", id, "--format", fmt.as_arg()])?;
        if !ok {
            return Err(classify_err(&err));
        }
        Ok(out.into_bytes())
    }
}
```

- [ ] **Step 6: Run the full module test + clippy**

Run: `cargo test -p tau-gateway --lib sessions 2>&1 | tail -10 && cargo clippy -p tau-gateway --lib 2>&1 | tail -15`
Expected: all `sessions::tests` PASS; clippy clean (no warnings).

- [ ] **Step 7: Commit**

```bash
git add gateway/src/sessions/mod.rs
git commit -m "feat(gateway): MockSessions + CliSessions seam impls"
```

---

## Task 3: Wire the seam into AppState

**Files:**
- Modify: `gateway/src/state.rs`

- [ ] **Step 1: Add the import**

Near the other module imports at the top of `state.rs` (after `use crate::ship::...;`), add:

```rust
use crate::sessions::{self, ExportFormat, SessionDetail, SessionError, SessionSummary, SessionsSource};
```

- [ ] **Step 2: Add the `Inner` field**

In `struct Inner`, beside the other `Box<dyn ...>` seams (after `graph_source: Box<dyn WorkflowGraphSource>,`), add:

```rust
    sessions_source: Box<dyn SessionsSource>,
```

- [ ] **Step 3: Wire it in `with_options`**

After the `graph_source` selection block (just before `AppState(Arc::new(Inner {`), add:

```rust
        let sessions_source: Box<dyn SessionsSource> = if is_mock {
            Box::new(sessions::MockSessions::new())
        } else {
            Box::new(sessions::CliSessions::new(bin.clone(), project.clone()))
        };
```

Then add `sessions_source,` to the `Inner { ... }` initializer (next to `graph_source,`).

- [ ] **Step 4: Add the three delegating methods on `AppState`**

Near the other read delegations (e.g. after `pub fn checks(&self)`), add:

```rust
    pub fn list_sessions(&self) -> Result<Vec<SessionSummary>, SessionError> {
        self.0.sessions_source.list()
    }

    pub fn show_session(&self, id: &str) -> Result<SessionDetail, SessionError> {
        self.0.sessions_source.show(id)
    }

    pub fn export_session(&self, id: &str, fmt: ExportFormat) -> Result<Vec<u8>, SessionError> {
        self.0.sessions_source.export(id, fmt)
    }
```

- [ ] **Step 5: Build to verify wiring**

Run: `cargo build -p tau-gateway 2>&1 | tail -15`
Expected: compiles clean. (If `ExportFormat`/`SessionError`/`SessionSummary`/`SessionDetail` show as unused, they are used by the methods — no warning expected.)

- [ ] **Step 6: Commit**

```bash
git add gateway/src/state.rs
git commit -m "feat(gateway): wire sessions seam into AppState"
```

---

## Task 4: API routes + handlers

**Files:**
- Create: `gateway/src/api/sessions.rs`
- Modify: `gateway/src/api/mod.rs`

- [ ] **Step 1: Write the handlers**

Create `gateway/src/api/sessions.rs`:

```rust
use axum::{
    extract::{Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;

use crate::api::scope::Scoped;
use crate::sessions::{ExportFormat, SessionDetail, SessionError, SessionSummary};

fn map_err(e: SessionError) -> (StatusCode, String) {
    match e {
        SessionError::NotFound(m) => (StatusCode::NOT_FOUND, m),
        SessionError::AmbiguousPrefix(c) => (
            StatusCode::CONFLICT,
            format!("ambiguous session id; candidates: {}", c.join(", ")),
        ),
        SessionError::BadFormat(m) => (StatusCode::BAD_REQUEST, m),
        SessionError::MalformedOutput(m) => (StatusCode::BAD_GATEWAY, m),
        SessionError::Tau(m) => (StatusCode::BAD_GATEWAY, m),
    }
}

pub async fn list(
    Scoped(state): Scoped,
) -> Result<Json<Vec<SessionSummary>>, (StatusCode, String)> {
    state.list_sessions().map(Json).map_err(map_err)
}

pub async fn get_one(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
) -> Result<Json<SessionDetail>, (StatusCode, String)> {
    state.show_session(&id).map(Json).map_err(map_err)
}

#[derive(Deserialize)]
pub struct ExportQuery {
    pub format: Option<String>,
}

pub async fn export(
    Scoped(state): Scoped,
    Path((_pid, id)): Path<(String, String)>,
    Query(q): Query<ExportQuery>,
) -> Result<Response, (StatusCode, String)> {
    let fmt = ExportFormat::parse(q.format.as_deref().unwrap_or("jsonl")).map_err(map_err)?;
    let bytes = state.export_session(&id, fmt).map_err(map_err)?;
    let prefix: String = id.chars().take(8).collect();
    Ok((
        [
            (header::CONTENT_TYPE, fmt.content_type().to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"session-{prefix}.{}\"", fmt.ext()),
            ),
        ],
        bytes,
    )
        .into_response())
}
```

- [ ] **Step 2: Register the module + routes in `api/mod.rs`**

Add `pub mod sessions;` in the module list (alpha order, after `pub mod scope;`... keep sorted: it goes after `runs`/`scope`/`ship` — place it `pub mod sessions;` right after `pub mod scope;`). Then in the `scoped` router, after the `/plugins` route (line ~63), add:

```rust
        .route("/sessions", get(sessions::list))
        .route("/sessions/{id}", get(sessions::get_one))
        .route("/sessions/{id}/export", get(sessions::export))
```

- [ ] **Step 3: Build**

Run: `cargo build -p tau-gateway 2>&1 | tail -15`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add gateway/src/api/sessions.rs gateway/src/api/mod.rs
git commit -m "feat(gateway): sessions API routes"
```

---

## Task 5: Mock-tier HTTP contract test

**Files:**
- Create: `gateway/tests/sessions_api.rs`

- [ ] **Step 1: Write the test (mirrors `skills_api.rs` harness)**

Create `gateway/tests/sessions_api.rs`:

```rust
use std::path::PathBuf;

use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}
fn project() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

async fn setup() -> (String, String) {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    // leak the tempdir so its files survive the test process
    std::mem::forget(data);
    (base, meta.id)
}

#[tokio::test]
async fn sessions_list_show_export_over_http() {
    let (base, pid) = setup().await;
    let http = reqwest::Client::new();

    // LIST — three seeded mock sessions
    let rows: serde_json::Value = http
        .get(format!("{base}/api/projects/{pid}/sessions"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rows.as_array().unwrap().len(), 3);

    // SHOW (exact id) — 200 with envelope
    let detail: serde_json::Value = http
        .get(format!(
            "{base}/api/projects/{pid}/sessions/018f5a2c-0000-0000-0000-000000000001"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["header"]["agent_id"], "coder");
    assert!(detail["messages"].is_array());

    // SHOW (ambiguous prefix) — 409
    let amb = http
        .get(format!("{base}/api/projects/{pid}/sessions/018f5a2c"))
        .send()
        .await
        .unwrap();
    assert_eq!(amb.status(), reqwest::StatusCode::CONFLICT);

    // SHOW (no match) — 404
    let missing = http
        .get(format!("{base}/api/projects/{pid}/sessions/ffffffff"))
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), reqwest::StatusCode::NOT_FOUND);

    // SHOW (bad id) — 400
    let bad = http
        .get(format!("{base}/api/projects/{pid}/sessions/short"))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);

    // EXPORT (md) — download headers + body
    let exp = http
        .get(format!(
            "{base}/api/projects/{pid}/sessions/02b13f99/export?format=md"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(exp.status(), reqwest::StatusCode::OK);
    assert!(exp
        .headers()
        .get("content-disposition")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("session-02b13f99.md"));

    // EXPORT (bad format) — 400
    let badfmt = http
        .get(format!(
            "{base}/api/projects/{pid}/sessions/02b13f99/export?format=xml"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(badfmt.status(), reqwest::StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 2: Ensure `fake-tau-serve` is built, then run**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test sessions_api 2>&1 | tail -20`
Expected: `sessions_list_show_export_over_http` PASS. (If `setup`'s `add_local` signature differs, copy the exact harness from `gateway/tests/skills_api.rs` — it is the source of truth.)

- [ ] **Step 3: Commit**

```bash
git add gateway/tests/sessions_api.rs
git commit -m "test(gateway): sessions HTTP contract over mock tier"
```

---

## Task 6: Web API client + types

**Files:**
- Create: `web/src/api/sessions.ts`
- Create: `web/src/api/sessions.test.ts`

- [ ] **Step 1: Write the failing api test**

Create `web/src/api/sessions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listSessions, getSession, exportUrl } from "./sessions";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("sessions api", () => {
  it("listSessions GETs the scoped path", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listSessions("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/sessions");
  });

  it("getSession percent-encodes the id", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    await getSession("demo", "../../etc");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/sessions/..%2F..%2Fetc");
  });

  it("exportUrl builds a scoped download url with format", () => {
    expect(exportUrl("demo", "018f5a2c", "md")).toBe(
      "/api/projects/demo/sessions/018f5a2c/export?format=md",
    );
  });
});
```

- [ ] **Step 2: Run it — fails (no module)**

Run: `cd web && pnpm vitest run src/api/sessions.test.ts 2>&1 | tail -15`
Expected: FAIL — cannot resolve `./sessions`.

- [ ] **Step 3: Implement the client**

Create `web/src/api/sessions.ts`:

```ts
import type { SessionSummary } from "../types/SessionSummary";
import type { SessionDetail } from "../types/SessionDetail";
import { request, scopedPath } from "./client";

export const listSessions = (pid: string) =>
  request<SessionSummary[]>(scopedPath(pid, "/sessions"));

export const getSession = (pid: string, id: string) =>
  request<SessionDetail>(scopedPath(pid, `/sessions/${encodeURIComponent(id)}`));

export type ExportFmt = "jsonl" | "md" | "json";

/** Direct download URL (used as an `<a href>`), not a fetch — the gateway streams
 *  the file with a Content-Disposition attachment header. */
export const exportUrl = (pid: string, id: string, format: ExportFmt) =>
  scopedPath(pid, `/sessions/${encodeURIComponent(id)}/export?format=${format}`);
```

- [ ] **Step 4: Run the test — pass**

Run: `cd web && pnpm vitest run src/api/sessions.test.ts 2>&1 | tail -10`
Expected: 3 tests PASS.

- [ ] **Step 5: Format + commit**

```bash
cd web && pnpm exec prettier --write src/api/sessions.ts src/api/sessions.test.ts && cd ..
git add web/src/api/sessions.ts web/src/api/sessions.test.ts
git commit -m "feat(web): sessions api client"
```

---

## Task 7: SessionTranscript component (defensive renderer)

**Files:**
- Create: `web/src/sessions/SessionTranscript.tsx`
- Create: `web/src/sessions/SessionTranscript.test.tsx`

- [ ] **Step 1: Write the failing test (covers the JSON-fallback branch)**

Create `web/src/sessions/SessionTranscript.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionTranscript } from "./SessionTranscript";
import type { SessionDetail } from "../types/SessionDetail";

const detail: SessionDetail = {
  header: {
    id: "018f5a2c-0000-0000-0000-000000000001",
    created_at: "2026-06-12T14:33:21Z",
    agent_id: "coder",
    llm_backend: "anthropic",
    package: { name: "my-agent", version: "1.0.0", resolved_commit: "0".repeat(40) },
  },
  // first message has recognizable text; second is an unknown shape → JSON fallback
  messages: [
    { from: "user", payload: { text: "hello there" } },
    { kind: "tool_call", tool: "fs.read", path: "src/lexer.rs" },
  ],
  turn_summaries: [
    { turn: 1, stop_reason: "EndTurn", input_tokens: 1840, output_tokens: 210 },
  ],
};

describe("SessionTranscript", () => {
  it("renders recognizable message text", () => {
    render(<SessionTranscript detail={detail} />);
    expect(screen.getByText("hello there")).toBeInTheDocument();
  });

  it("falls back to JSON for an unrecognized message shape", () => {
    render(<SessionTranscript detail={detail} />);
    expect(screen.getByText(/"tool": "fs.read"/)).toBeInTheDocument();
  });

  it("renders a turn-summary divider with stop reason and tokens", () => {
    render(<SessionTranscript detail={detail} />);
    expect(screen.getByText(/EndTurn/)).toBeInTheDocument();
    expect(screen.getByText(/1840 in/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it — fails**

Run: `cd web && pnpm vitest run src/sessions/SessionTranscript.test.tsx 2>&1 | tail -15`
Expected: FAIL — cannot resolve `./SessionTranscript`.

- [ ] **Step 3: Implement the renderer**

Create `web/src/sessions/SessionTranscript.tsx`:

```tsx
import type { SessionDetail } from "../types/SessionDetail";
import type { TurnSummary } from "../types/TurnSummary";

/** Best-effort field pluck from an opaque message value. tau's Message shape is not
 *  a documented contract (see spec), so we probe common shapes and fall back to JSON. */
function field(m: unknown, ...keys: string[]): string | undefined {
  if (m && typeof m === "object") {
    const obj = m as Record<string, unknown>;
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string") return v;
    }
  }
  return undefined;
}

function messageText(m: unknown): string | undefined {
  if (m && typeof m === "object") {
    const payload = (m as Record<string, unknown>).payload;
    const nested = field(payload, "text");
    if (nested) return nested;
  }
  return field(m, "text", "content");
}

function roleOf(m: unknown): string {
  return field(m, "role", "from") ?? "message";
}

function Bubble({ role, children }: { role: string; children: React.ReactNode }) {
  const isUser = role === "user";
  return (
    <div
      className={`max-w-[78%] rounded-lg border px-3 py-2 text-sm ${
        isUser
          ? "self-end border-accent/25 bg-accent/[0.08]"
          : "self-start border-border bg-surface"
      }`}
    >
      <div className="mb-0.5 text-[9px] uppercase tracking-wide text-muted">{role}</div>
      {children}
    </div>
  );
}

function Divider({ t }: { t: TurnSummary }) {
  const toks =
    t.input_tokens != null || t.output_tokens != null
      ? ` · ${t.input_tokens ?? 0} in / ${t.output_tokens ?? 0} out`
      : "";
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="font-mono text-[10px] text-muted">
        turn {t.turn} · {t.stop_reason}
        {toks}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

export function SessionTranscript({ detail }: { detail: SessionDetail }) {
  // v1 ordering: render all messages, then each turn divider after its turn index.
  // The data needed for exact interleave is present; full fidelity is a follow-up.
  return (
    <div className="flex flex-col gap-2.5">
      {detail.messages.map((m, i) => {
        const text = messageText(m);
        return (
          <Bubble key={`m${i}`} role={roleOf(m)}>
            {text != null ? (
              <span>{text}</span>
            ) : (
              <pre className="m-0 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
                {JSON.stringify(m, null, 2)}
              </pre>
            )}
          </Bubble>
        );
      })}
      {detail.turn_summaries.map((t) => (
        <Divider key={`t${t.turn}`} t={t} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test — pass**

Run: `cd web && pnpm vitest run src/sessions/SessionTranscript.test.tsx 2>&1 | tail -10`
Expected: 3 tests PASS.

- [ ] **Step 5: Format + commit**

```bash
cd web && pnpm exec prettier --write src/sessions/SessionTranscript.tsx src/sessions/SessionTranscript.test.tsx && cd ..
git add web/src/sessions/SessionTranscript.tsx web/src/sessions/SessionTranscript.test.tsx
git commit -m "feat(web): defensive session transcript renderer"
```

---

## Task 8: SessionDetailPage

**Files:**
- Create: `web/src/sessions/SessionDetailPage.tsx`

- [ ] **Step 1: Implement the detail page**

(No separate unit test — it's covered by the transcript test + the page test in Task 9 exercises the list. Keep this task a single focused component.)

Create `web/src/sessions/SessionDetailPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { SessionDetail } from "../types/SessionDetail";
import { getSession, exportUrl, type ExportFmt } from "../api/sessions";
import { useProjectId } from "../app/project-context";
import { SessionTranscript } from "./SessionTranscript";

export function SessionDetailPage() {
  const pid = useProjectId();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fmt, setFmt] = useState<ExportFmt>("jsonl");

  useEffect(() => {
    if (!id) return;
    setDetail(null);
    setError(null);
    getSession(pid, id)
      .then(setDetail)
      .catch((e) => setError(String(e)));
  }, [pid, id]);

  if (error) return <div className="p-4 text-sm text-st-error">{error}</div>;
  if (!detail) return <div className="p-4 text-sm text-muted">Loading…</div>;

  const h = detail.header;
  const tin = detail.turn_summaries.reduce((s, t) => s + (t.input_tokens ?? 0), 0);
  const tout = detail.turn_summaries.reduce((s, t) => s + (t.output_tokens ?? 0), 0);
  const tile = "flex-1 rounded-lg border border-border bg-surface px-3 py-2";

  return (
    <div className="space-y-4 p-4">
      <div className="text-[11px] text-muted">
        <span className="text-accent">Sessions</span> / {h.id.slice(0, 8)}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border pb-2.5">
        <strong className="font-mono text-[15px]">{h.id.slice(0, 8)}</strong>
        <span className="text-xs">
          agent <b>{h.agent_id}</b>
        </span>
        <span className="text-[11px] text-muted">
          {h.llm_backend} · {h.package.name}@{h.package.version}
        </span>
        <span className="text-[11px] text-muted">{h.created_at}</span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px]">
          <span className="text-muted">Export</span>
          <select
            aria-label="export format"
            className="rounded-md border border-border bg-surface px-2 py-1"
            value={fmt}
            onChange={(e) => setFmt(e.target.value as ExportFmt)}
          >
            <option value="jsonl">jsonl</option>
            <option value="md">md</option>
            <option value="json">json</option>
          </select>
          <a
            className="rounded-md bg-accent px-3 py-1 font-semibold text-accent-fg"
            href={exportUrl(pid, h.id, fmt)}
          >
            Download
          </a>
        </span>
      </div>

      <div className="flex gap-2">
        <div className={tile}>
          <div className="text-[9px] uppercase tracking-wide text-muted">turns</div>
          <b className="text-base">{detail.turn_summaries.length}</b>
        </div>
        <div className={tile}>
          <div className="text-[9px] uppercase tracking-wide text-muted">input tokens</div>
          <b className="text-base">{tin.toLocaleString()}</b>
        </div>
        <div className={tile}>
          <div className="text-[9px] uppercase tracking-wide text-muted">output tokens</div>
          <b className="text-base">{tout.toLocaleString()}</b>
        </div>
      </div>

      <SessionTranscript detail={detail} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && pnpm typecheck 2>&1 | tail -15`
Expected: no errors. (Confirms `useProjectId` import path and `st-error` token exist — they do, per `Sidebar.tsx`/`index.css`. If `project-context` export differs, match `SkillsIndex.tsx`'s import.)

- [ ] **Step 3: Format + commit**

```bash
cd web && pnpm exec prettier --write src/sessions/SessionDetailPage.tsx && cd ..
git add web/src/sessions/SessionDetailPage.tsx
git commit -m "feat(web): session detail page"
```

---

## Task 9: SessionsPage (list + filter + pagination)

**Files:**
- Create: `web/src/sessions/SessionsPage.tsx`
- Create: `web/src/sessions/SessionsPage.test.tsx`

- [ ] **Step 1: Write the failing page test**

Create `web/src/sessions/SessionsPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SessionsPage } from "./SessionsPage";
import { ProjectProvider } from "../app/project-context";

const rows = Array.from({ length: 30 }, (_, i) => ({
  id: `018f5a2c-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`,
  prefix: `018f5a${String(i).padStart(2, "0")}`,
  agent: i % 2 === 0 ? "coder" : "reviewer",
  created_at: "2026-06-12T14:33:21Z",
  turns: i,
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
});

function renderAt() {
  render(
    <ProjectProvider pid="demo">
      <MemoryRouter initialEntries={["/projects/demo/sessions"]}>
        <Routes>
          <Route path="/projects/:pid/sessions" element={<SessionsPage />} />
        </Routes>
      </MemoryRouter>
    </ProjectProvider>,
  );
}

describe("SessionsPage", () => {
  it("renders the first page (25 rows) with id links", async () => {
    renderAt();
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(25));
    const first = screen.getAllByRole("link")[0];
    expect(first).toHaveAttribute(
      "href",
      "/projects/demo/sessions/018f5a2c-0000-0000-0000-000000000000",
    );
  });

  it("filters by agent", async () => {
    renderAt();
    await waitFor(() => expect(screen.getAllByRole("link").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("filter by agent"), {
      target: { value: "reviewer" },
    });
    // 15 reviewers, all on one page
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(15));
  });
});
```

- [ ] **Step 2: Run it — fails**

Run: `cd web && pnpm vitest run src/sessions/SessionsPage.test.tsx 2>&1 | tail -15`
Expected: FAIL — cannot resolve `./SessionsPage`.

- [ ] **Step 3: Implement the page**

Create `web/src/sessions/SessionsPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SessionSummary } from "../types/SessionSummary";
import { listSessions } from "../api/sessions";
import { useProjectId } from "../app/project-context";

const PAGE = 25;

export function SessionsPage() {
  const pid = useProjectId();
  const [all, setAll] = useState<SessionSummary[]>([]);
  const [agent, setAgent] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    listSessions(pid)
      .then(setAll)
      .catch(() => {});
  }, [pid]);

  const filtered = useMemo(
    () => (agent.trim() ? all.filter((s) => s.agent.includes(agent.trim())) : all),
    [all, agent],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const clamped = Math.min(page, pages - 1);
  const slice = filtered.slice(clamped * PAGE, clamped * PAGE + PAGE);

  function onFilter(v: string) {
    setAgent(v);
    setPage(0);
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Sessions</h2>
        <input
          aria-label="filter by agent"
          placeholder="filter by agent…"
          className="ml-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
          value={agent}
          onChange={(e) => onFilter(e.target.value)}
        />
        <span className="ml-auto text-xs text-muted">
          {filtered.length} session{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 pr-2 font-medium">id</th>
            <th className="px-2 py-1 font-medium">agent</th>
            <th className="px-2 py-1 font-medium">created</th>
            <th className="px-2 py-1 text-right font-medium">turns</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {slice.map((s) => (
            <tr key={s.id} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-2">
                <Link to={`/projects/${pid}/sessions/${s.id}`} className="text-accent">
                  {s.prefix}
                </Link>
              </td>
              <td className="px-2 py-1">{s.agent}</td>
              <td className="px-2 py-1 text-muted">{s.created_at}</td>
              <td className="px-2 py-1 text-right">{s.turns}</td>
            </tr>
          ))}
          {slice.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-center text-muted">
                no sessions
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <span className="mr-auto text-muted">
            page {clamped + 1} of {pages}
          </span>
          <button
            className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
            disabled={clamped === 0}
            onClick={() => setPage(clamped - 1)}
          >
            ‹ Prev
          </button>
          <button
            className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
            disabled={clamped >= pages - 1}
            onClick={() => setPage(clamped + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test — pass**

Run: `cd web && pnpm vitest run src/sessions/SessionsPage.test.tsx 2>&1 | tail -10`
Expected: 2 tests PASS.

- [ ] **Step 5: Format + commit**

```bash
cd web && pnpm exec prettier --write src/sessions/SessionsPage.tsx src/sessions/SessionsPage.test.tsx && cd ..
git add web/src/sessions/SessionsPage.tsx web/src/sessions/SessionsPage.test.tsx
git commit -m "feat(web): sessions list page with filter + pagination"
```

---

## Task 10: Routes + nav entry

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/app/Sidebar.tsx`

- [ ] **Step 1: Add the imports + routes in `App.tsx`**

Add imports beside the others:

```tsx
import { SessionsPage } from "./sessions/SessionsPage";
import { SessionDetailPage } from "./sessions/SessionDetailPage";
```

Add the two routes after the `runs/:id` route:

```tsx
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="sessions/:id" element={<SessionDetailPage />} />
```

- [ ] **Step 2: Add the nav entry in `Sidebar.tsx`**

In the `"Operate"` group's `items` array, between `runs` and `ship`, add:

```tsx
      { to: "sessions", label: "Sessions", icon: "◎" },
```

- [ ] **Step 3: Typecheck + full web test + lint**

Run: `cd web && pnpm typecheck && pnpm vitest run 2>&1 | tail -15 && pnpm lint 2>&1 | tail -5`
Expected: typecheck clean, all tests pass, lint clean.

- [ ] **Step 4: Format + commit**

```bash
cd web && pnpm exec prettier --write src/App.tsx src/app/Sidebar.tsx && cd ..
git add web/src/App.tsx web/src/app/Sidebar.tsx
git commit -m "feat(web): sessions route + nav entry"
```

---

## Task 11: Gated real-tau round-trip test

**Files:**
- Create: `gateway/tests/real_tau_sessions.rs`

- [ ] **Step 1: Inspect the existing gated harness to copy its gating idiom**

Run: `sed -n '1,40p' gateway/tests/real_tau_skills.rs`
Expected: shows the `TAU_REAL_BIN` env gate + HOME isolation. Mirror exactly.

- [ ] **Step 2: Write the test — seed an on-disk session, read it back via the CLI seam**

Create `gateway/tests/real_tau_sessions.rs`. This exercises `CliSessions` against the real binary over the durable on-disk JSONL contract (no interactive `tau chat` needed):

```rust
//! Gated on TAU_REAL_BIN. Writes a known `.tau/sessions/<id>.jsonl` into a temp
//! project, then asserts the real `tau session list/export` read it back through
//! the gateway's CliSessions seam. Skipped when TAU_REAL_BIN is unset/missing.

use std::fs;
use std::path::PathBuf;

use tau_gateway::sessions::{CliSessions, ExportFormat, SessionsSource};

fn real_bin() -> Option<PathBuf> {
    let p = PathBuf::from(std::env::var("TAU_REAL_BIN").ok()?);
    p.exists().then_some(p)
}

const SESSION_ID: &str = "018f5a2c-1111-2222-3333-444455556666";

fn seed(project: &std::path::Path) {
    let dir = project.join(".tau/sessions");
    fs::create_dir_all(&dir).unwrap();
    let header = serde_json::json!({
        "type": "header", "schema": 1, "id": SESSION_ID,
        "created_at": "2026-06-12T14:33:21Z", "agent_id": "coder",
        "package": { "name": "demo", "version": "0.1.0", "resolved_commit": "0".repeat(40) },
        "llm_backend": "anthropic", "title": null
    });
    let msg = serde_json::json!({ "type": "message", "msg": { "from": "user", "payload": { "text": "hi" } } });
    let turn = serde_json::json!({ "type": "turn_summary", "turn": 1, "stop_reason": "EndTurn", "input_tokens": 10, "output_tokens": 5 });
    let body = format!("{header}\n{msg}\n{turn}\n");
    fs::write(dir.join(format!("{SESSION_ID}.jsonl")), body).unwrap();
}

#[test]
fn real_tau_reads_seeded_session() {
    let Some(bin) = real_bin() else {
        eprintln!("skipping: TAU_REAL_BIN unset or missing");
        return;
    };
    let tmp = tempfile::tempdir().unwrap();
    // minimal tau project marker so Scope::resolve picks project scope
    fs::write(tmp.path().join("tau.toml"), "[project]\nname = \"demo\"\n").unwrap();
    seed(tmp.path());

    let cli = CliSessions::new(bin, tmp.path().to_path_buf());

    let rows = cli.list().expect("list");
    assert!(rows.iter().any(|r| r.id == SESSION_ID), "seeded session not listed: {rows:?}");

    let detail = cli.show(SESSION_ID).expect("show");
    assert_eq!(detail.header.agent_id, "coder");
    assert_eq!(detail.turn_summaries.len(), 1);

    let md = cli.export(SESSION_ID, ExportFormat::Md).expect("export md");
    assert!(!md.is_empty());
}
```

- [ ] **Step 3: Run gated (skips without a real binary; must still compile)**

Run: `cargo test -p tau-gateway --test real_tau_sessions 2>&1 | tail -10`
Expected: compiles; test prints "skipping" and passes (no `TAU_REAL_BIN`). If a real tau is available: `TAU_REAL_BIN=/path/to/tau cargo test -p tau-gateway --test real_tau_sessions` and confirm it passes — this is the one place that validates the assumed `--json`/`export` shapes against the live binary. If shapes diverge, fix `parse_list`/`parse_detail` and the fixtures, then re-run.

- [ ] **Step 4: Commit**

```bash
git add gateway/tests/real_tau_sessions.rs
git commit -m "test(gateway): gated real-tau session read round-trip"
```

---

## Task 12: Final gate + docs

**Files:**
- Modify (if they enumerate seams): `docs/seams.md`

- [ ] **Step 1: Full Rust gate**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway 2>&1 | tail -20 && cargo clippy -p tau-gateway --all-targets 2>&1 | tail -10`
Expected: all tests pass, clippy clean.

- [ ] **Step 2: Full web gate**

Run: `cd web && pnpm typecheck && pnpm lint && pnpm vitest run 2>&1 | tail -15 && pnpm exec prettier --check src/sessions src/api/sessions.ts src/api/sessions.test.ts && cd ..`
Expected: all green.

- [ ] **Step 3: Update `docs/seams.md` if it lists the sidecar seams**

Run: `grep -n "ToolsSource\|InstalledSkills\|WorkflowGraphSource" docs/seams.md | head`
If it enumerates seams, add a `SessionsSource` row mirroring the others (trait in `gateway/src/sessions/mod.rs`, `MockSessions`/`CliSessions`, project scope, read-only). If the file does not enumerate seams, skip.

- [ ] **Step 4: Commit docs (if changed)**

```bash
git add docs/seams.md
git commit -m "docs: note SessionsSource seam"
```

- [ ] **Step 5: Manual smoke (optional, requires running the stack)**

Per `superpowers:run`/repo README: start the gateway with the mock serve + the web dev server, open a project, click **Sessions**, confirm the three mock rows, open one, see the transcript + tiles, and that the Download links resolve. This is verification, not a code change — no commit.

---

## Self-Review notes (already reconciled)

- **Spec coverage:** scope (Task 1–4 project-only, `global` field present), columns/filter/pagination (Task 9), read-only/no-delete (no mutating routes anywhere), export all three formats (Tasks 1/4/8), separate nav (Task 10), dedicated transcript (Task 7), D1 `export --format json` for detail (Task 2 `CliSessions::show`), D2 opaque `messages` (Task 1 `#[ts(type="Array<unknown>")]`), D3 ambiguous→409 (Task 2 resolve + Task 4 `map_err` + Task 5 assertion), `thiserror` boundary (Task 1). Test strategy: mock contract (Task 5), parser units (Task 1), gated real round-trip (Task 11). Follow-ups recorded in the spec's Out-of-scope section.
- **Type consistency:** `SessionDetail`/`SessionSummary`/`SessionHeader`/`TurnSummary`/`ExportFormat` names identical across gateway types, ts-rs exports, web imports, and tests. `list_sessions`/`show_session`/`export_session` AppState methods match handler calls. `scopedPath`/`request` match `web/src/api/client.ts` exports. `useProjectId`/`ProjectProvider` match `SkillsIndex.tsx` usage.
- **Placeholders:** none — every step has concrete code or an exact command with expected output. The one runtime assumption (live `--json` shapes) is explicitly validated in Task 11 against `TAU_REAL_BIN`, with a stated fallback.
