//! Canonical Trace/Run/Event model (handoff spec §1.2).
//!
//! Every gateway surface reads these types. TS types are generated from here
//! via ts-rs (see `cargo test export_bindings`), so the frontend cannot drift.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum Substrate {
    Host,
    Wasm,
    #[serde(rename = "c-abi")]
    CAbi,
    Mcu,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Dev,
    Prod,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Serve,
    Log,
    Otlp,
    Wasm,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TokenUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub total_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RunError {
    pub kind: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Run {
    pub id: String,
    pub agent_id: String,
    pub prompt: String,
    pub substrate: Substrate,
    pub mode: Mode,
    pub status: RunStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub total_turns: Option<u32>,
    pub token_usage: Option<TokenUsage>,
    pub stop_reason: Option<String>,
    pub error: Option<RunError>,
    pub source: Source,
}

/// Span kind. `Other` (`#[serde(other)]`) lets the gateway DESERIALIZE unknown
/// kinds at runtime without panicking (forward-compat). The generated TS union is
/// intentionally closed to the known kinds (`#[ts(skip)]` on `Other`); the frontend
/// branches on span `name`, not on an exhaustive `kind` switch, so this is safe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SpanKind {
    Run,
    Turn,
    ToolCall,
    Agent,
    McpCall,
    ContextStep,
    #[ts(skip)]
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum SpanStatus {
    Running,
    Ok,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Span {
    pub id: String,
    pub parent_id: Option<String>,
    pub run_id: String,
    pub kind: SpanKind,
    pub name: String,
    pub status: SpanStatus,
    pub started_at: String,
    pub ended_at: Option<String>,
    #[ts(type = "unknown")]
    pub attributes: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Event {
    pub run_id: String,
    pub span_id: Option<String>,
    pub ts: String,
    /// Free-form so unknown RunEvent kinds survive (RunEvent is #[non_exhaustive]).
    pub kind: String,
    #[ts(type = "unknown")]
    pub payload: serde_json::Value,
}

/// What the WS pushes to the browser: a tagged union of incremental updates.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    /// Full current span list, sent once on connect (replay).
    Snapshot {
        run: Run,
        spans: Vec<Span>,
    },
    SpanUpdate {
        span: Span,
    },
    Event {
        event: Event,
    },
    RunUpdate {
        run: Run,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_serializes_with_expected_fields() {
        let run = Run {
            id: "01ABC".into(),
            agent_id: "greeter".into(),
            prompt: "hi".into(),
            substrate: Substrate::Host,
            mode: Mode::Dev,
            status: RunStatus::Running,
            started_at: "2026-05-31T00:00:00Z".into(),
            ended_at: None,
            total_turns: None,
            token_usage: None,
            stop_reason: None,
            error: None,
            source: Source::Serve,
        };
        let v = serde_json::to_value(&run).unwrap();
        assert_eq!(v["substrate"], "host");
        assert_eq!(v["mode"], "dev");
        assert_eq!(v["status"], "running");
        assert_eq!(v["source"], "serve");
        assert!(v["ended_at"].is_null());
        let back: Run = serde_json::from_value(v).unwrap();
        assert_eq!(back.agent_id, "greeter");
    }

    #[test]
    fn span_status_and_kind_serialize_lowercase_snake() {
        let span = Span {
            id: "s1".into(),
            parent_id: None,
            run_id: "01ABC".into(),
            kind: SpanKind::ToolCall,
            name: "fs-read".into(),
            status: SpanStatus::Running,
            started_at: "2026-05-31T00:00:00Z".into(),
            ended_at: None,
            attributes: serde_json::json!({"args": {"path": "/x"}}),
        };
        let v = serde_json::to_value(&span).unwrap();
        assert_eq!(v["kind"], "tool_call");
        assert_eq!(v["status"], "running");
    }

    #[test]
    fn cabi_substrate_uses_hyphenated_wire_name() {
        // manual #[serde(rename="c-abi")] must beat rename_all="lowercase" (which gives "cabi")
        assert_eq!(serde_json::to_value(&Substrate::CAbi).unwrap(), "c-abi");
    }

    #[test]
    fn unknown_span_kind_deserializes_to_other() {
        // forward-compat: a future kind string must not fail deserialization
        let k: SpanKind = serde_json::from_value(serde_json::json!("some_future_kind")).unwrap();
        assert!(matches!(k, SpanKind::Other));
    }

    #[test]
    fn ws_message_uses_type_tag_with_snake_case_variants() {
        let span = Span {
            id: "s1".into(),
            parent_id: None,
            run_id: "R1".into(),
            kind: SpanKind::ToolCall,
            name: "x".into(),
            status: SpanStatus::Running,
            started_at: "t".into(),
            ended_at: None,
            attributes: serde_json::json!({}),
        };
        let v = serde_json::to_value(&WsMessage::SpanUpdate { span }).unwrap();
        assert_eq!(v["type"], "span_update");
        assert!(v["span"].is_object());
    }

    #[test]
    fn export_bindings() {
        Run::export_all().expect("export Run + deps");
        Span::export_all().expect("export Span + deps");
        WsMessage::export_all().expect("export WsMessage + deps");
    }
}
