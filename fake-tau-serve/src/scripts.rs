//! Canned event scripts per agent. Each entry is one runtime.event `data`
//! payload tagged by `kind`; the runner wraps it with id + delays.

use serde_json::{json, Value};

pub struct ScriptStep {
    pub kind: &'static str,
    pub data: Value,
    pub delay_ms: u64,
}

/// Returns the event sequence for an agent. Unknown agents fall back to `greeter`.
pub fn script_for(agent: &str, prompt: &str) -> Vec<ScriptStep> {
    match agent {
        "researcher" => researcher(prompt),
        _ => greeter(prompt),
    }
}

fn step(kind: &'static str, data: Value, delay_ms: u64) -> ScriptStep {
    ScriptStep {
        kind,
        data,
        delay_ms,
    }
}

fn greeter(prompt: &str) -> Vec<ScriptStep> {
    vec![
        step("TextDelta", json!({"text": "Hello! "}), 40),
        step(
            "TextDelta",
            json!({"text": format!("You said: {prompt}")}),
            40,
        ),
        step(
            "ToolCallStarted",
            json!({"tool":"fs-read","call_id":"c1","args":{"path":"/etc/hostname"}}),
            30,
        ),
        step(
            "ToolCallCompleted",
            json!({"tool":"fs-read","call_id":"c1",
            "result":{"ok":true,"content":[{"type":"text","text":"demo-host"}],"is_error":false}}),
            60,
        ),
        step("TextDelta", json!({"text": " (read host ok)"}), 30),
        step(
            "TurnCompleted",
            json!({"turn":1,"stop_reason":"end_turn",
            "usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20}}),
            20,
        ),
        step(
            "RunCompleted",
            json!({"token_usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20}}),
            10,
        ),
    ]
}

/// Exercises the agent-spawn-tree heuristic: a `task.spawn`/`agent.*.spawn`
/// tool call whose children the adapter nests under it (handoff spec §1.2).
fn researcher(prompt: &str) -> Vec<ScriptStep> {
    vec![
        step("TextDelta", json!({"text": "Planning research..."}), 40),
        step(
            "ToolCallStarted",
            json!({"tool":"agent.summarizer.spawn","call_id":"sp1",
            "args":{"prompt": prompt}}),
            30,
        ),
        step(
            "ToolCallStarted",
            json!({"tool":"fs-read","call_id":"c2","args":{"path":"/notes"}}),
            30,
        ),
        step(
            "ToolCallCompleted",
            json!({"tool":"fs-read","call_id":"c2",
            "result":{"ok":true,"content":[{"type":"text","text":"notes..."}],"is_error":false}}),
            50,
        ),
        step(
            "ToolCallCompleted",
            json!({"tool":"agent.summarizer.spawn","call_id":"sp1",
            "result":{"ok":true,"content":[{"type":"text","text":"summary done"}],"is_error":false}}),
            70,
        ),
        step(
            "TurnCompleted",
            json!({"turn":1,"stop_reason":"end_turn",
            "usage":{"input_tokens":40,"output_tokens":22,"total_tokens":62}}),
            20,
        ),
        step(
            "RunCompleted",
            json!({"token_usage":{"input_tokens":40,"output_tokens":22,"total_tokens":62}}),
            10,
        ),
    ]
}
