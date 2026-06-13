//! Workflow graph editor (gated β.2): a mock-backed node/edge graph of a
//! workflow's steps. Mirrors the tools/ship/checks seam. The real path
//! (`CliGraph`) parses `workflows/*.toml` + the tau β.2 Workflow IR — empty here.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Why building a workflow graph failed.
#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("workflow {0:?} not found")]
    NotFound(String),
    #[error("failed to parse workflow {name:?}: {detail}")]
    Parse { name: String, detail: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkflowNode {
    pub id: String,
    pub kind: String, // "agent.run" | "tool.call"
    pub label: String,
    pub agent: Option<String>,
    pub tool: Option<String>,
    pub input: Option<String>,
    pub provider: Option<String>, // agent.run: agent's llm_backend, else the recommended backend
    pub tools: Vec<String>,       // agent.run: the agent's requires_tools names
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkflowEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct WorkflowGraph {
    pub workflow: String,
    pub nodes: Vec<WorkflowNode>,
    pub edges: Vec<WorkflowEdge>,
}

/// Source of a workflow's graph. Parses the workflow TOML pipeline; the
/// compiled-IR / bundle inspector is a separate deferred feature (issue #50).
pub trait WorkflowGraphSource: Send + Sync {
    fn graph(&self, name: &str) -> Result<WorkflowGraph, GraphError>;
}

fn node(
    id: &str,
    kind: &str,
    agent: Option<&str>,
    tool: Option<&str>,
    input: Option<&str>,
) -> WorkflowNode {
    WorkflowNode {
        id: id.into(),
        kind: kind.into(),
        label: id.into(),
        agent: agent.map(|s| s.to_string()),
        tool: tool.map(|s| s.to_string()),
        input: input.map(|s| s.to_string()),
        provider: None,
        tools: vec![],
    }
}

fn edge(source: &str, target: &str) -> WorkflowEdge {
    WorkflowEdge {
        source: source.into(),
        target: target.into(),
    }
}

pub struct MockGraph;

impl WorkflowGraphSource for MockGraph {
    fn graph(&self, name: &str) -> Result<WorkflowGraph, GraphError> {
        let g = match name {
            "nightly-research" => WorkflowGraph {
                workflow: name.into(),
                nodes: vec![
                    node(
                        "gather",
                        "agent.run",
                        Some("researcher"),
                        None,
                        Some("${input}"),
                    ),
                    node(
                        "summarise",
                        "agent.run",
                        Some("greeter"),
                        None,
                        Some("${steps.gather.output}"),
                    ),
                    node(
                        "save-results",
                        "tool.call",
                        None,
                        Some("fs-write"),
                        Some("${steps.summarise.output}"),
                    ),
                ],
                edges: vec![
                    edge("gather", "summarise"),
                    edge("summarise", "save-results"),
                ],
            },
            "build-report" => WorkflowGraph {
                workflow: name.into(),
                nodes: vec![
                    node(
                        "collect",
                        "agent.run",
                        Some("researcher"),
                        None,
                        Some("${input}"),
                    ),
                    node("render", "tool.call", None, Some("fs-write"), None),
                ],
                edges: vec![edge("collect", "render")],
            },
            other => WorkflowGraph {
                workflow: other.into(),
                nodes: vec![],
                edges: vec![],
            },
        };
        Ok(g)
    }
}

/// Real graph source: parses `<project>/workflows/<name>.toml`.
pub struct CliGraph {
    #[allow(dead_code)]
    project: PathBuf,
}

impl CliGraph {
    pub fn new(project: PathBuf) -> Self {
        CliGraph { project }
    }
}

impl WorkflowGraphSource for CliGraph {
    fn graph(&self, name: &str) -> Result<WorkflowGraph, GraphError> {
        // Real parse lands in Task A3.
        Ok(WorkflowGraph {
            workflow: name.into(),
            nodes: vec![],
            edges: vec![],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_seeds_nightly_research() {
        let g = MockGraph.graph("nightly-research").unwrap();
        assert_eq!(g.workflow, "nightly-research");
        assert_eq!(g.nodes.len(), 3);
        assert_eq!(g.nodes[0].label, "gather"); // label defaults to the step id
        assert_eq!(g.nodes[0].kind, "agent.run");
        assert_eq!(g.nodes[2].kind, "tool.call");
        assert_eq!(g.edges.len(), 2);
        assert_eq!(g.edges[0].source, "gather");
        assert_eq!(g.edges[0].target, "summarise");
        assert_eq!(g.edges[1].target, "save-results");
    }

    #[test]
    fn mock_build_report_has_sequence_edge() {
        let g = MockGraph.graph("build-report").unwrap();
        assert_eq!(g.nodes.len(), 2);
        assert_eq!(g.nodes[0].kind, "agent.run"); // collect
        assert_eq!(g.nodes[1].kind, "tool.call"); // render
                                                  // execution order: collect runs, then render
        assert_eq!(g.edges.len(), 1);
        assert_eq!(g.edges[0].source, "collect");
        assert_eq!(g.edges[0].target, "render");
    }

    #[test]
    fn mock_unknown_is_empty() {
        let g = MockGraph.graph("nope").unwrap();
        assert_eq!(g.workflow, "nope");
        assert!(g.nodes.is_empty());
    }

    #[test]
    fn cli_graph_unknown_is_empty_for_now() {
        let g = CliGraph::new(std::path::PathBuf::from("/nonexistent"))
            .graph("nightly-research")
            .unwrap();
        assert!(g.nodes.is_empty());
        assert!(g.edges.is_empty());
    }
}
