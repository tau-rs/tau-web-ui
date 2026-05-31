//! serve-adapter: maps the tau serve RunEvent stream onto the Trace model.
//! Mapping rules per handoff spec §1.2. RunEvent is #[non_exhaustive] upstream,
//! so unknown kinds become generic Events and never panic.

use serde_json::{json, Value};

use crate::adapters::TraceDelta;
use crate::trace::{Event, Span, SpanKind, SpanStatus, TokenUsage};

/// Stateful per-run builder. Feed it RunItems (as (kind, data)); it emits deltas.
pub struct ServeAdapter {
    run_id: String,
    now: fn() -> String,
    turn_index: u32,
    turn_span_id: Option<String>,
    turn_started_at: Option<String>,
    /// serve call_id -> (our span id, started_at, args), for matching ToolCallCompleted.
    tool_spans: std::collections::HashMap<String, (String, String, Value)>,
    seq: u64,
}

fn rfc3339_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl ServeAdapter {
    pub fn new(run_id: String) -> Self {
        Self::with_clock(run_id, rfc3339_now)
    }
    pub fn with_clock(run_id: String, now: fn() -> String) -> Self {
        ServeAdapter {
            run_id,
            now,
            turn_index: 0,
            turn_span_id: None,
            turn_started_at: None,
            tool_spans: Default::default(),
            seq: 0,
        }
    }

    fn span_id(&mut self, prefix: &str) -> String {
        self.seq += 1;
        format!("{}-{}-{}", self.run_id, prefix, self.seq)
    }

    /// Ensure a turn span exists; return its id.
    fn ensure_turn(&mut self, out: &mut Vec<TraceDelta>) -> String {
        if let Some(id) = &self.turn_span_id {
            return id.clone();
        }
        self.turn_index += 1;
        let id = self.span_id("turn");
        let started = (self.now)();
        self.turn_started_at = Some(started.clone());
        let span = Span {
            id: id.clone(),
            parent_id: None,
            run_id: self.run_id.clone(),
            kind: SpanKind::Turn,
            name: format!("turn {}", self.turn_index),
            status: SpanStatus::Running,
            started_at: started,
            ended_at: None,
            attributes: json!({}),
        };
        out.push(TraceDelta::SpanOpened(span));
        self.turn_span_id = Some(id.clone());
        id
    }

    /// Heuristic (§1.2): tool names like `task.*`, `agent.*.spawn`, `run.*`
    /// represent agent-spawn; their span kind is Agent so the UI nests them.
    fn kind_for_tool(name: &str) -> SpanKind {
        if name.starts_with("agent.") || name.starts_with("task.") || name.starts_with("run.") {
            SpanKind::Agent
        } else {
            SpanKind::ToolCall
        }
    }

    /// Feed one serve event. Returns the deltas it produced.
    pub fn on_event(&mut self, kind: &str, data: &Value) -> Vec<TraceDelta> {
        let mut out = vec![];
        let turn_id = self.ensure_turn(&mut out);
        match kind {
            "TextDelta" => {
                out.push(TraceDelta::Event(Event {
                    run_id: self.run_id.clone(),
                    span_id: Some(turn_id),
                    ts: (self.now)(),
                    kind: "text_delta".into(),
                    payload: json!({"text": data["text"].as_str().unwrap_or("")}),
                }));
            }
            "ToolCallStarted" => {
                let name = data["tool"].as_str().unwrap_or("tool").to_string();
                let call_id = data["call_id"].as_str().unwrap_or("").to_string();
                let sid = self.span_id("tool");
                let started = (self.now)();
                let args = data["args"].clone();
                self.tool_spans
                    .insert(call_id, (sid.clone(), started.clone(), args.clone()));
                out.push(TraceDelta::SpanOpened(Span {
                    id: sid,
                    parent_id: Some(self.turn_span_id.clone().unwrap()),
                    run_id: self.run_id.clone(),
                    kind: Self::kind_for_tool(&name),
                    name,
                    status: SpanStatus::Running,
                    started_at: started,
                    ended_at: None,
                    attributes: json!({"args": args}),
                }));
                out.push(TraceDelta::Event(Event {
                    run_id: self.run_id.clone(),
                    span_id: None,
                    ts: (self.now)(),
                    kind: "tool_started".into(),
                    payload: data.clone(),
                }));
            }
            "ToolCallCompleted" => {
                let call_id = data["call_id"].as_str().unwrap_or("").to_string();
                let result = &data["result"];
                let is_err = result["ok"].as_bool() == Some(false)
                    || result["is_error"].as_bool() == Some(true);
                if let Some((sid, started, args)) = self.tool_spans.remove(&call_id) {
                    // Preserve args from the open event so the inspector can show both.
                    out.push(TraceDelta::SpanUpdated(Span {
                        id: sid,
                        parent_id: Some(self.turn_span_id.clone().unwrap()),
                        run_id: self.run_id.clone(),
                        kind: Self::kind_for_tool(data["tool"].as_str().unwrap_or("")),
                        name: data["tool"].as_str().unwrap_or("tool").into(),
                        status: if is_err {
                            SpanStatus::Error
                        } else {
                            SpanStatus::Ok
                        },
                        started_at: started,
                        ended_at: Some((self.now)()),
                        attributes: json!({"args": args, "result": result.clone()}),
                    }));
                }
                out.push(TraceDelta::Event(Event {
                    run_id: self.run_id.clone(),
                    span_id: None,
                    ts: (self.now)(),
                    kind: "tool_completed".into(),
                    payload: data.clone(),
                }));
            }
            "TurnCompleted" => {
                if let Some(id) = self.turn_span_id.take() {
                    let started = self.turn_started_at.take().unwrap_or_else(|| (self.now)());
                    out.push(TraceDelta::SpanUpdated(Span {
                        id,
                        parent_id: None,
                        run_id: self.run_id.clone(),
                        kind: SpanKind::Turn,
                        name: format!("turn {}", self.turn_index),
                        status: SpanStatus::Ok,
                        started_at: started,
                        ended_at: Some((self.now)()),
                        attributes: data.clone(),
                    }));
                }
            }
            "RunCompleted" => {
                out.push(TraceDelta::Event(Event {
                    run_id: self.run_id.clone(),
                    span_id: None,
                    ts: (self.now)(),
                    kind: "run_completed".into(),
                    payload: data.clone(),
                }));
            }
            "FatalError" => {
                out.push(TraceDelta::Event(Event {
                    run_id: self.run_id.clone(),
                    span_id: None,
                    ts: (self.now)(),
                    kind: "fatal_error".into(),
                    payload: data.clone(),
                }));
            }
            // RunEvent is #[non_exhaustive] — unknown kinds render generically.
            other => {
                out.push(TraceDelta::Event(Event {
                    run_id: self.run_id.clone(),
                    span_id: None,
                    ts: (self.now)(),
                    kind: format!("unknown:{other}"),
                    payload: data.clone(),
                }));
            }
        }
        out
    }

    /// Apply token usage from a usage-bearing value to a Run.
    pub fn parse_usage(v: &Value) -> Option<TokenUsage> {
        if v.is_null() {
            return None;
        }
        Some(TokenUsage {
            input_tokens: v["input_tokens"]
                .as_u64()
                .or_else(|| v["prompt"].as_u64())
                .unwrap_or(0) as u32,
            output_tokens: v["output_tokens"]
                .as_u64()
                .or_else(|| v["completion"].as_u64())
                .unwrap_or(0) as u32,
            total_tokens: v["total_tokens"].as_u64().map(|t| t as u32),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_now() -> String {
        "2026-05-31T00:00:00.000Z".to_string()
    }

    #[test]
    fn tool_call_opens_then_closes_ok() {
        let mut a = ServeAdapter::with_clock("R1".into(), fixed_now);
        let opened = a.on_event(
            "ToolCallStarted",
            &json!({"tool":"fs-read","call_id":"c1","args":{"path":"/x"}}),
        );
        let tool_open = opened
            .iter()
            .find_map(|d| match d {
                TraceDelta::SpanOpened(s) if s.kind == SpanKind::ToolCall => Some(s.clone()),
                _ => None,
            })
            .expect("tool span opened");
        assert_eq!(tool_open.status, SpanStatus::Running);
        assert_eq!(tool_open.name, "fs-read");

        let closed = a.on_event(
            "ToolCallCompleted",
            &json!({"tool":"fs-read","call_id":"c1",
                    "result":{"ok":true,"content":[],"is_error":false}}),
        );
        let upd = closed
            .iter()
            .find_map(|d| match d {
                TraceDelta::SpanUpdated(s) => Some(s.clone()),
                _ => None,
            })
            .expect("tool span updated");
        assert_eq!(upd.id, tool_open.id);
        assert_eq!(upd.status, SpanStatus::Ok);
    }

    #[test]
    fn error_result_marks_span_error() {
        let mut a = ServeAdapter::with_clock("R1".into(), fixed_now);
        a.on_event(
            "ToolCallStarted",
            &json!({"tool":"x","call_id":"c1","args":{}}),
        );
        let closed = a.on_event(
            "ToolCallCompleted",
            &json!({"tool":"x","call_id":"c1","result":{"ok":false,"error":"boom"}}),
        );
        let upd = closed
            .iter()
            .find_map(|d| match d {
                TraceDelta::SpanUpdated(s) => Some(s.clone()),
                _ => None,
            })
            .unwrap();
        assert_eq!(upd.status, SpanStatus::Error);
    }

    #[test]
    fn spawn_tool_becomes_agent_span() {
        let mut a = ServeAdapter::with_clock("R1".into(), fixed_now);
        let d = a.on_event(
            "ToolCallStarted",
            &json!({"tool":"agent.summarizer.spawn","call_id":"sp1","args":{}}),
        );
        let s = d
            .iter()
            .find_map(|x| match x {
                TraceDelta::SpanOpened(s) if s.kind == SpanKind::Agent => Some(s.clone()),
                _ => None,
            })
            .expect("agent span");
        assert_eq!(s.name, "agent.summarizer.spawn");
    }

    #[test]
    fn unknown_kind_is_generic_event() {
        let mut a = ServeAdapter::with_clock("R1".into(), fixed_now);
        let d = a.on_event("SomeFutureKind", &json!({"x":1}));
        assert!(d
            .iter()
            .any(|x| matches!(x, TraceDelta::Event(e) if e.kind == "unknown:SomeFutureKind")));
    }

    #[test]
    fn usage_normalizes_both_shapes() {
        assert_eq!(
            ServeAdapter::parse_usage(&json!({"input_tokens":3,"output_tokens":4}))
                .unwrap()
                .input_tokens,
            3
        );
        assert_eq!(
            ServeAdapter::parse_usage(&json!({"prompt":5,"completion":6}))
                .unwrap()
                .output_tokens,
            6
        );
        assert!(ServeAdapter::parse_usage(&json!(null)).is_none());
    }

    #[test]
    fn tool_span_preserves_open_timestamp_on_close() {
        let mut a = ServeAdapter::with_clock("R1".into(), fixed_now);
        let opened = a.on_event(
            "ToolCallStarted",
            &json!({"tool":"x","call_id":"c1","args":{}}),
        );
        let open = opened
            .iter()
            .find_map(|d| match d {
                TraceDelta::SpanOpened(s) if s.kind == SpanKind::ToolCall => Some(s.clone()),
                _ => None,
            })
            .unwrap();
        let closed = a.on_event(
            "ToolCallCompleted",
            &json!({"tool":"x","call_id":"c1","result":{"ok":true}}),
        );
        let close = closed
            .iter()
            .find_map(|d| match d {
                TraceDelta::SpanUpdated(s) => Some(s.clone()),
                _ => None,
            })
            .unwrap();
        // started_at carried over from the open span; ended_at now populated.
        assert_eq!(close.started_at, open.started_at);
        assert!(close.ended_at.is_some());
    }

    #[test]
    fn tool_close_preserves_args_alongside_result() {
        let mut a = ServeAdapter::with_clock("R1".into(), fixed_now);
        a.on_event(
            "ToolCallStarted",
            &json!({"tool":"fs-read","call_id":"c1","args":{"path":"/etc/hostname"}}),
        );
        let closed = a.on_event(
            "ToolCallCompleted",
            &json!({"tool":"fs-read","call_id":"c1","result":{"ok":true,"content":[]}}),
        );
        let upd = closed
            .iter()
            .find_map(|d| match d {
                TraceDelta::SpanUpdated(s) => Some(s.clone()),
                _ => None,
            })
            .expect("span updated");
        // Both args and result must be present so the span inspector can show them.
        assert_eq!(upd.attributes["args"]["path"], "/etc/hostname");
        assert!(!upd.attributes["result"].is_null());
    }
}
