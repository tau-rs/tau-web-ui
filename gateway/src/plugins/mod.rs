//! Plugins view: a gated, read-only catalog of plugin binaries (the executables
//! behind packages that provide a tau port). Mock data — tau has no plugin
//! introspection yet — so this mirrors the tools `MockTools`/`CliTools` seam.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use crate::skills::Capability;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProtocolFrame {
    pub direction: String, // "out" (→ request to plugin) | "in" (← response/notification)
    pub method: String,    // "meta.handshake" | "result" | "plugin.describe" | "tool.invoke" | "llm.generate"
    #[ts(type = "unknown")]
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolSchema {
    pub name: String,
    pub input_schema: BTreeMap<String, String>, // param → type
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginDescribe {
    pub port: String, // "Tool" | "LlmBackend"
    pub protocol_version: u32,
    pub tool: Option<ToolSchema>,
    pub capabilities: Vec<Capability>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginDetail {
    pub name: String,
    pub version: Option<String>,
    pub source: String,
    pub kind: String, // "rust-cargo"
    pub binary: String,
    pub port: String, // mirrors describe.port for list-row convenience
    pub protocol_version: u32,
    pub describe: PluginDescribe,
    pub transcript: Vec<ProtocolFrame>,
}

/// Source of the plugin catalog. Mock-first; the CLI path stays empty until tau
/// exposes plugin introspection.
pub trait PluginsSource: Send + Sync {
    fn catalog(&self) -> Vec<PluginDetail>;
}

fn cap(kind: &str, param: &str, vals: &[&str]) -> Capability {
    Capability {
        kind: kind.into(),
        fields: BTreeMap::from([(
            param.to_string(),
            vals.iter().map(|s| s.to_string()).collect(),
        )]),
    }
}

fn tool_schema(name: &str, params: &[(&str, &str)]) -> ToolSchema {
    ToolSchema {
        name: name.into(),
        input_schema: params
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
    }
}

fn frame(direction: &str, method: &str, payload: Value) -> ProtocolFrame {
    ProtocolFrame {
        direction: direction.into(),
        method: method.into(),
        payload,
    }
}

/// The shared leading frames: handshake → describe request → describe result.
/// `describe_value` is the wire form of the plugin's `describe` (kept in sync by
/// serializing the typed `PluginDescribe`).
fn lead_frames(pkg: &str, describe_value: Value) -> Vec<ProtocolFrame> {
    vec![
        frame(
            "out",
            "meta.handshake",
            json!({"client_name":"tau-gateway","client_version":"0.1.0","protocol_version":1}),
        ),
        frame(
            "in",
            "result",
            json!({"server_name":"tau","server_version":"0.0.0","protocol_version":1}),
        ),
        frame("out", "plugin.describe", json!({ "package": pkg })),
        frame("in", "result", describe_value),
    ]
}

/// Assemble a plugin: typed describe + a 6-frame transcript (4 lead frames + the
/// 2 port-appropriate sample-call frames).
fn assemble(
    name: &str,
    version: &str,
    describe: PluginDescribe,
    mut sample: Vec<ProtocolFrame>,
) -> PluginDetail {
    let port = describe.port.clone();
    let protocol_version = describe.protocol_version;
    let describe_value = serde_json::to_value(&describe).expect("describe serializes");
    let mut transcript = lead_frames(name, describe_value);
    transcript.append(&mut sample);
    PluginDetail {
        name: name.into(),
        version: Some(version.into()),
        source: format!("github.com/tau/{name}"),
        kind: "rust-cargo".into(),
        binary: name.into(),
        port,
        protocol_version,
        describe,
        transcript,
    }
}

pub struct MockPlugins;

impl PluginsSource for MockPlugins {
    fn catalog(&self) -> Vec<PluginDetail> {
        vec![
            assemble(
                "fs-read",
                "1.0.0",
                PluginDescribe {
                    port: "Tool".into(),
                    protocol_version: 1,
                    tool: Some(tool_schema("fs-read", &[("path", "string")])),
                    capabilities: vec![cap("fs.read", "paths", &["${WORKDIR}/**"])],
                },
                vec![
                    frame(
                        "out",
                        "tool.invoke",
                        json!({"call_id":"c1","args":{"path":"${WORKDIR}/README.md"}}),
                    ),
                    frame(
                        "in",
                        "result",
                        json!({"ok":true,"content":[{"type":"text","text":"# tau\nA workflow compiler for portable agents."}],"is_error":false}),
                    ),
                ],
            ),
            assemble(
                "shell",
                "0.2.0",
                PluginDescribe {
                    port: "Tool".into(),
                    protocol_version: 1,
                    tool: Some(tool_schema("shell", &[("command", "string")])),
                    capabilities: vec![cap("process.spawn", "commands", &["sh"])],
                },
                vec![
                    frame(
                        "out",
                        "tool.invoke",
                        json!({"call_id":"c1","args":{"command":"ls"}}),
                    ),
                    frame(
                        "in",
                        "result",
                        json!({"ok":true,"content":[{"type":"text","text":"README.md\nCargo.toml"}],"is_error":false}),
                    ),
                ],
            ),
            assemble(
                "web-search",
                "1.2.0",
                PluginDescribe {
                    port: "Tool".into(),
                    protocol_version: 1,
                    tool: Some(tool_schema("web-search", &[("query", "string")])),
                    capabilities: vec![cap("net.http", "hosts", &["*"])],
                },
                vec![
                    frame(
                        "out",
                        "tool.invoke",
                        json!({"call_id":"c1","args":{"query":"tau agent framework"}}),
                    ),
                    frame(
                        "in",
                        "result",
                        json!({"ok":true,"content":[{"type":"text","text":"3 results for tau agent framework"}],"is_error":false}),
                    ),
                ],
            ),
            assemble(
                "anthropic",
                "0.1.0",
                PluginDescribe {
                    port: "LlmBackend".into(),
                    protocol_version: 1,
                    tool: None,
                    capabilities: vec![cap("net.http", "hosts", &["api.anthropic.com"])],
                },
                vec![
                    frame(
                        "out",
                        "llm.generate",
                        json!({"model":"claude-opus-4","messages":[{"role":"user","content":"hi"}]}),
                    ),
                    frame(
                        "in",
                        "result",
                        json!({"content":[{"type":"text","text":"Hello!"}],"usage":{"input_tokens":10,"output_tokens":3}}),
                    ),
                ],
            ),
        ]
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliPlugins;

impl PluginsSource for CliPlugins {
    fn catalog(&self) -> Vec<PluginDetail> {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_catalog_seeds_four_plugins() {
        let cat = MockPlugins.catalog();
        let names: Vec<&str> = cat.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, vec!["fs-read", "shell", "web-search", "anthropic"]);

        let fsr = &cat[0];
        assert_eq!(fsr.port, "Tool");
        assert_eq!(fsr.describe.port, "Tool");
        assert_eq!(fsr.kind, "rust-cargo");
        assert_eq!(fsr.transcript.len(), 6);
        // describe-result frame (index 3) is the serialized typed describe — guards
        // against drift between PluginDescribe and its wire form.
        assert_eq!(fsr.transcript[3].method, "result");
        assert_eq!(fsr.transcript[3].payload["port"], json!("Tool"));
        let last = fsr.transcript.last().unwrap();
        assert_eq!(last.method, "result");
        assert_eq!(last.payload["ok"], json!(true));

        let anthropic = cat.iter().find(|p| p.name == "anthropic").unwrap();
        assert_eq!(anthropic.port, "LlmBackend");
        assert!(anthropic.describe.tool.is_none());
        assert!(anthropic.transcript.iter().any(|f| f.method == "llm.generate"));

        assert!(CliPlugins.catalog().is_empty());
    }
}
