//! Workflow graph editor (gated β.2): a mock-backed node/edge graph of a
//! workflow's steps. Mirrors the tools/ship/checks seam. The real path
//! (`CliGraph`) parses `workflows/*.toml` + the tau β.2 Workflow IR — empty here.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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

/// Source of a workflow's graph. Mock-first; the CLI path stays empty until tau
/// ships the Workflow IR (β.2).
pub trait WorkflowGraphSource: Send + Sync {
    fn graph(&self, name: &str) -> WorkflowGraph;
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
    fn graph(&self, name: &str) -> WorkflowGraph {
        match name {
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
                edges: vec![],
            },
            other => WorkflowGraph {
                workflow: other.into(),
                nodes: vec![],
                edges: vec![],
            },
        }
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliGraph;

impl WorkflowGraphSource for CliGraph {
    fn graph(&self, name: &str) -> WorkflowGraph {
        WorkflowGraph {
            workflow: name.into(),
            nodes: vec![],
            edges: vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_seeds_nightly_research() {
        let g = MockGraph.graph("nightly-research");
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
    fn mock_build_report_has_no_edges() {
        let g = MockGraph.graph("build-report");
        assert_eq!(g.nodes.len(), 2);
        assert_eq!(g.nodes[0].kind, "agent.run"); // collect
        assert_eq!(g.nodes[1].kind, "tool.call"); // render
        assert!(g.edges.is_empty());
    }

    #[test]
    fn mock_unknown_is_empty() {
        let g = MockGraph.graph("nope");
        assert_eq!(g.workflow, "nope");
        assert!(g.nodes.is_empty());
    }

    #[test]
    fn cli_graph_is_empty() {
        let g = CliGraph.graph("nightly-research");
        assert!(g.nodes.is_empty());
        assert!(g.edges.is_empty());
    }
}
