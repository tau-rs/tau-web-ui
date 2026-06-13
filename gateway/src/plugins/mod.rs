//! Plugins view: a read-only catalog of plugin binaries behind packages that
//! provide a tau port, assembled from `introspect`'s describe sweep. Real on the
//! CLI path (`CliPlugins`); `MockPlugins` covers fake-tau-serve.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use crate::introspect::{
    tool_input_schema, Classified, PluginError, PluginInfo, PluginIntrospector,
};
use crate::skills::Capability;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProtocolFrame {
    pub direction: String, // "out" (→ request to plugin) | "in" (← response/notification)
    pub method: String, // "meta.handshake" | "result" | "plugin.describe" | "tool.invoke" | "llm.generate"
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PluginCatalog {
    pub plugins: Vec<PluginDetail>,
    pub errors: Vec<PluginError>,
}

/// Source of the plugin catalog. `MockPlugins` is deterministic; `CliPlugins`
/// projects the real describe sweep.
pub trait PluginsSource: Send + Sync {
    fn catalog(&self) -> PluginCatalog;
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
    fn catalog(&self) -> PluginCatalog {
        let plugins = vec![
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
        ];
        PluginCatalog {
            plugins,
            errors: vec![],
        }
    }
}

/// Return the plugin catalog (plugins + introspection errors).
pub fn list_plugins(source: &dyn PluginsSource) -> PluginCatalog {
    source.catalog()
}

/// Build a `PluginDetail` from one parsed describe result. Capabilities are
/// empty — `tau plugin describe` does not call `tool.describe_capabilities`.
fn plugin_detail_from(info: &PluginInfo) -> PluginDetail {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_catalog_seeds_four_plugins() {
        let cat = MockPlugins.catalog().plugins;
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
        assert!(anthropic
            .transcript
            .iter()
            .any(|f| f.method == "llm.generate"));
    }

    #[test]
    fn list_plugins_returns_catalog() {
        let cat = list_plugins(&MockPlugins);
        assert_eq!(cat.plugins.len(), 4);
        assert!(cat.errors.is_empty());
    }
}
