//! Compiled workflow IR (β.2): shells `tau ir inspect --json` and projects the
//! `IrModule` envelope into a flat, UI-friendly shape. Mirrors the graph/ship
//! seam. tau's IR is PROJECT-scoped (one IrModule per `tau.toml`), so this seam
//! takes no workflow argument; per-workflow scoping is a web-side highlight.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Why compiling/inspecting the IR failed.
#[derive(Debug, thiserror::Error)]
pub enum IrError {
    #[error("project did not compile: {0}")]
    NotCompiled(String),
    #[error("could not run tau ir inspect: {0}")]
    Spawn(String),
    #[error("could not parse tau ir inspect output: {0}")]
    Parse(String),
}

/// Flat, UI-facing projection of the compiled IR.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CompiledIr {
    pub hash_kind: String, // "lowered" (stand-in caches) | "bundle" (real hash)
    pub canonical_ir_hash: String,
    pub target: String,
    pub tau_version: String,
    pub agents: Vec<IrAgent>,
    pub tools: Vec<IrTool>,
    pub edges: Vec<IrEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IrAgent {
    pub id: String,
    pub llm_backend: String,
    /// Tool ids this agent wires to (derived from subflow edges).
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IrTool {
    pub id: String,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IrEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
}

/// Source of the compiled project IR. Mock-first; `CliIr` shells the real verb.
pub trait IrSource: Send + Sync {
    fn inspect(&self) -> Result<CompiledIr, IrError>;
}

// ---- envelope deserialize (matches the verb's `ir-inspect/v1` JSON) ----

#[derive(Debug, Deserialize)]
struct Envelope {
    hash_kind: String,
    canonical_ir_hash: String,
    module: Module,
}
#[derive(Debug, Deserialize)]
struct Module {
    tau_version: String,
    target: String,
    workflow: WorkflowIn,
}
#[derive(Debug, Deserialize)]
struct WorkflowIn {
    #[serde(default)]
    agents: BTreeMap<String, AgentIn>,
    #[serde(default)]
    tools: BTreeMap<String, ToolIn>,
    #[serde(default)]
    edges: Vec<EdgeIn>,
    #[serde(default)]
    capability_table: BTreeMap<String, Vec<String>>,
}
#[derive(Debug, Deserialize)]
struct AgentIn {
    #[serde(default)]
    llm_backend: String,
}
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct ToolIn {}
#[derive(Debug, Deserialize)]
struct EdgeIn {
    from: String,
    to: String,
    #[serde(default)]
    kind: String,
}

/// Project the verb envelope into the flat `CompiledIr`. Each agent's `tools`
/// are the subflow-edge targets that are themselves tool ids; each tool's
/// `capabilities` come from the capability table.
fn project(env: Envelope) -> CompiledIr {
    let wf = env.module.workflow;
    let tool_ids: BTreeSet<String> = wf.tools.keys().cloned().collect();
    let agents = wf
        .agents
        .iter()
        .map(|(id, a)| IrAgent {
            id: id.clone(),
            llm_backend: a.llm_backend.clone(),
            tools: wf
                .edges
                .iter()
                .filter(|e| &e.from == id && tool_ids.contains(&e.to))
                .map(|e| e.to.clone())
                .collect(),
        })
        .collect();
    let tools = wf
        .tools
        .keys()
        .map(|id| IrTool {
            id: id.clone(),
            capabilities: wf.capability_table.get(id).cloned().unwrap_or_default(),
        })
        .collect();
    let edges = wf
        .edges
        .into_iter()
        .map(|e| IrEdge {
            from: e.from,
            to: e.to,
            kind: e.kind,
        })
        .collect();
    CompiledIr {
        hash_kind: env.hash_kind,
        canonical_ir_hash: env.canonical_ir_hash,
        target: env.module.target,
        tau_version: env.module.tau_version,
        agents,
        tools,
        edges,
    }
}

/// Parse a single JSON envelope line into the flat projection.
pub fn parse_envelope(json: &str) -> Result<CompiledIr, IrError> {
    let env: Envelope = serde_json::from_str(json).map_err(|e| IrError::Parse(e.to_string()))?;
    Ok(project(env))
}

pub struct MockIr;

impl IrSource for MockIr {
    fn inspect(&self) -> Result<CompiledIr, IrError> {
        parse_envelope(include_str!(
            "../../tests/fixtures/tau-json/ir-inspect.json"
        ))
    }
}

/// Real source: `tau ir inspect --json` in the project dir.
pub struct CliIr {
    bin: PathBuf,
    project: PathBuf,
}

impl CliIr {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        CliIr { bin, project }
    }
}

impl IrSource for CliIr {
    fn inspect(&self) -> Result<CompiledIr, IrError> {
        let out = Command::new(&self.bin)
            .args(["ir", "inspect", "--json"])
            .current_dir(&self.project)
            .output()
            .map_err(|e| IrError::Spawn(e.to_string()))?;
        if !out.status.success() {
            return Err(IrError::NotCompiled(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            ));
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        // empty stdout → surfaces as IrError::Parse (EOF). Matches the ship seam.
        let line = stdout.trim().lines().last().unwrap_or("");
        parse_envelope(line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_fixture_with_delta() {
        let ir = MockIr.inspect().unwrap();
        assert_eq!(ir.hash_kind, "lowered");
        assert_eq!(ir.target, "darwin-native-strict");
        assert_eq!(ir.agents.len(), 2);
        assert_eq!(ir.tools.len(), 1);
        assert_eq!(ir.edges.len(), 1);
        let researcher = ir.agents.iter().find(|a| a.id == "researcher").unwrap();
        assert_eq!(researcher.tools, vec!["web-search".to_string()]);
        let tool = &ir.tools[0];
        assert_eq!(tool.id, "web-search");
        assert_eq!(tool.capabilities, vec!["net.outbound".to_string()]);
    }

    #[test]
    fn parse_rejects_garbage() {
        let err = parse_envelope("not json").unwrap_err();
        assert!(matches!(err, IrError::Parse(_)));
    }

    #[test]
    fn cli_ir_spawn_error_without_binary() {
        let err = CliIr::new("/nonexistent/tau".into(), "/tmp".into())
            .inspect()
            .unwrap_err();
        assert!(matches!(err, IrError::Spawn(_)));
    }
}
