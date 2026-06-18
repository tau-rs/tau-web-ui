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
    // A `long run` prompt yields a deliberately long, finely-stepped script so
    // cancellation e2e has a stable window to click Cancel before the run ends.
    if prompt.contains("long run") {
        return long_run();
    }
    match agent {
        "researcher" => researcher(prompt),
        _ => greeter(prompt),
    }
}

/// ~3s of cancellable runway built from many short steps. The runner checks for
/// cancellation between steps, so small `delay_ms` keeps the run in `running`
/// while still noticing a cancel within one step (~50ms) — no flaky race on slow
/// CI runners where the old ~230ms greeter could finish before Cancel landed.
fn long_run() -> Vec<ScriptStep> {
    let mut steps = vec![step("TextDelta", json!({"text": "Starting long run"}), 40)];
    for _ in 0..60 {
        steps.push(step("TextDelta", json!({"text": "."}), 50));
    }
    steps.push(step(
        "RunCompleted",
        json!({"token_usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}),
        10,
    ));
    steps
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
/// Emits: fs-read (tool_call) + agent.summarizer.spawn (Agent) + agent.factcheck.spawn (Agent).
fn researcher(prompt: &str) -> Vec<ScriptStep> {
    vec![
        step("TextDelta", json!({"text": "Planning research..."}), 40),
        // the researcher's own tool call
        step(
            "ToolCallStarted",
            json!({"tool":"fs-read","call_id":"c1","args":{"path":"/notes"}}),
            30,
        ),
        step(
            "ToolCallCompleted",
            json!({"tool":"fs-read","call_id":"c1",
            "result":{"ok":true,"content":[{"type":"text","text":"notes..."}],"is_error":false}}),
            40,
        ),
        // spawn a summarizer sub-agent
        step(
            "ToolCallStarted",
            json!({"tool":"agent.summarizer.spawn","call_id":"sp1","args":{"prompt": prompt}}),
            30,
        ),
        step(
            "ToolCallCompleted",
            json!({"tool":"agent.summarizer.spawn","call_id":"sp1",
            "result":{"ok":true,"content":[{"type":"text","text":"summary done"}],"is_error":false,
            "usage":{"input_tokens":120,"output_tokens":60,"total_tokens":180}}}),
            60,
        ),
        // spawn a fact-checker sub-agent
        step(
            "ToolCallStarted",
            json!({"tool":"agent.factcheck.spawn","call_id":"sp2","args":{"claims":3}}),
            30,
        ),
        step(
            "ToolCallCompleted",
            json!({"tool":"agent.factcheck.spawn","call_id":"sp2",
            "result":{"ok":true,"content":[{"type":"text","text":"checked"}],"is_error":false,
            "usage":{"input_tokens":80,"output_tokens":30,"total_tokens":110}}}),
            60,
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
