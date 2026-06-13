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
    /// File extension for downloads. Currently mirrors `as_arg`, kept separate so a
    /// format whose extension diverges from its tau `--format` arg (e.g. jsonl→ndjson)
    /// can change here without touching the CLI invocation.
    pub fn ext(self) -> &'static str {
        self.as_arg()
    }
    pub fn parse(s: &str) -> Result<Self, SessionError> {
        match s {
            "jsonl" => Ok(ExportFormat::Jsonl),
            "md" => Ok(ExportFormat::Md),
            "json" => Ok(ExportFormat::Json),
            other => Err(SessionError::BadFormat(format!(
                "unknown export format: {other}"
            ))),
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

/// Reject anything that isn't a hex/UUID-style id of 8..=36 chars, before it reaches the
/// `tau` argv (no flag/argument injection).
pub fn guard_id(id: &str) -> Result<(), SessionError> {
    let ok = (8..=36).contains(&id.len()) && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-');
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
        let row: SessionSummary =
            serde_json::from_value(v).map_err(|e| SessionError::MalformedOutput(e.to_string()))?;
        out.push(row);
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
        // Best-effort: pull id-looking tokens out of tau's message so the API layer
        // can show candidates. Empty if tau's wording yields none.
        let candidates: Vec<String> = stderr
            .split(|c: char| !(c.is_ascii_hexdigit() || c == '-'))
            .filter(|t| t.len() >= 8 && t.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
            .map(str::to_string)
            .collect();
        SessionError::AmbiguousPrefix(candidates)
    } else if s.contains("not found") || s.contains("no session") {
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
                mk(
                    "018f5a2c-0000-0000-0000-000000000001",
                    "coder",
                    "refactor the parser",
                ),
                mk(
                    "018f5a2c-0000-0000-0000-000000000002",
                    "reviewer",
                    "review the diff",
                ),
                mk(
                    "02b13f99-0000-0000-0000-000000000003",
                    "reviewer",
                    "summarize",
                ),
            ],
        }
    }

    fn resolve(&self, id: &str) -> Result<&SessionDetail, SessionError> {
        if let Some(s) = self.sessions.iter().find(|s| s.header.id == id) {
            return Ok(s);
        }
        let matches: Vec<&SessionDetail> = self
            .sessions
            .iter()
            .filter(|s| s.header.id.starts_with(id))
            .collect();
        match matches.len() {
            0 => Err(SessionError::NotFound(id.to_string())),
            1 => Ok(matches[0]),
            _ => Err(SessionError::AmbiguousPrefix(
                matches.iter().map(|s| s.header.id.clone()).collect(),
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
                let prefix: String = id.chars().take(8).collect();
                format!("# Session {prefix}\n\nagent: {}\n", s.header.agent_id).into_bytes()
            }
        };
        Ok(bytes)
    }
}

/// Real-tau seam: shells `tau session list/export` in the project dir. `global` is
/// false in v1; the field exists so a future scope toggle is a one-line change.
pub struct CliSessions {
    bin: PathBuf,
    project: PathBuf,
    global: bool,
}

impl CliSessions {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        Self {
            bin,
            project,
            global: false,
        }
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
        assert_eq!(rows[1].agent, "reviewer");
        assert_eq!(rows[1].turns, 1);
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
        assert!(matches!(
            guard_id("--global"),
            Err(SessionError::BadFormat(_))
        ));
    }

    #[test]
    fn export_format_parse_roundtrip() {
        assert!(matches!(
            ExportFormat::parse("md").unwrap(),
            ExportFormat::Md
        ));
        assert!(matches!(
            ExportFormat::parse("xml"),
            Err(SessionError::BadFormat(_))
        ));
    }

    #[test]
    fn mock_resolves_exact_prefix_and_ambiguous() {
        let m = MockSessions::new();
        assert_eq!(m.list().unwrap().len(), 3);
        assert!(m.show("018f5a2c-0000-0000-0000-000000000001").is_ok());
        assert!(m.show("02b13f99").is_ok());
        assert!(matches!(
            m.show("018f5a2c"),
            Err(SessionError::AmbiguousPrefix(_))
        ));
        assert!(matches!(m.show("ffffffff"), Err(SessionError::NotFound(_))));
    }

    #[test]
    fn mock_export_json_is_parseable_detail() {
        let m = MockSessions::new();
        let bytes = m.export("02b13f99", ExportFormat::Json).unwrap();
        let d = parse_detail(std::str::from_utf8(&bytes).unwrap()).unwrap();
        assert_eq!(d.header.agent_id, "reviewer");
    }
}
