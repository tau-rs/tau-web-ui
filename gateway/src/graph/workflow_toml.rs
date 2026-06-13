//! Parse a workflow's TOML pipeline into a structural `WorkflowGraph`.
//! Mirrors tau's `tau_workflow::Workflow` model (ordered `[[steps]]`,
//! `agent.run` / `tool.call`). Edges are execution order (step i → i+1);
//! data references (`${steps.X.output}`) are carried on the node `input`
//! for the detail panel, not as edges.

use std::path::Path;

use serde::Deserialize;

use crate::graph::{GraphError, WorkflowEdge, WorkflowGraph, WorkflowNode};

#[derive(Debug, Deserialize)]
struct RawWorkflow {
    #[serde(default)]
    steps: Vec<RawStep>,
}

#[derive(Debug, Deserialize)]
struct RawStep {
    id: String,
    kind: String, // "agent.run" | "tool.call"
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    input: Option<String>,
    #[serde(default)]
    tool: Option<String>,
}

/// Parse `<project>/workflows/<name>.toml` into a structural graph
/// (no provider/tools enrichment — that happens in `state::workflow_graph`).
pub fn parse_workflow_graph(project: &Path, name: &str) -> Result<WorkflowGraph, GraphError> {
    let path = project.join("workflows").join(format!("{name}.toml"));
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(GraphError::NotFound(name.to_string()));
        }
        Err(e) => {
            return Err(GraphError::Parse {
                name: name.to_string(),
                detail: e.to_string(),
            });
        }
    };
    let raw: RawWorkflow = toml::from_str(&text).map_err(|e| GraphError::Parse {
        name: name.to_string(),
        detail: e.to_string(),
    })?;

    let nodes: Vec<WorkflowNode> = raw
        .steps
        .iter()
        .map(|s| WorkflowNode {
            id: s.id.clone(),
            kind: s.kind.clone(),
            label: s.id.clone(),
            agent: s.agent.clone(),
            tool: s.tool.clone(),
            input: if s.kind == "agent.run" {
                s.input.clone()
            } else {
                None
            },
            provider: None,
            tools: vec![],
        })
        .collect();

    let edges: Vec<WorkflowEdge> = raw
        .steps
        .windows(2)
        .map(|w| WorkflowEdge {
            source: w[0].id.clone(),
            target: w[1].id.clone(),
        })
        .collect();

    Ok(WorkflowGraph {
        workflow: name.to_string(),
        nodes,
        edges,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_project(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let wf = dir.path().join("workflows");
        std::fs::create_dir_all(&wf).unwrap();
        for (name, body) in files {
            std::fs::write(wf.join(name), body).unwrap();
        }
        dir
    }

    #[test]
    fn parses_pipeline_with_execution_order_edges() {
        let dir = write_project(&[(
            "nightly-research.toml",
            r#"
[workflow]
description = "x"
default-agent = "researcher"
[[steps]]
id = "gather"
kind = "agent.run"
agent = "researcher"
input = "${input}"
[[steps]]
id = "summarise"
kind = "agent.run"
agent = "greeter"
input = "${steps.gather.output}"
[[steps]]
id = "save-results"
kind = "tool.call"
tool = "fs-write"
args = { path = "/tmp/x.md", content = "${steps.summarise.output}" }
"#,
        )]);
        let g = parse_workflow_graph(dir.path(), "nightly-research").unwrap();
        assert_eq!(g.nodes.len(), 3);
        assert_eq!(g.nodes[0].id, "gather");
        assert_eq!(g.nodes[0].kind, "agent.run");
        assert_eq!(g.nodes[0].agent.as_deref(), Some("researcher"));
        assert_eq!(g.nodes[0].input.as_deref(), Some("${input}"));
        assert_eq!(g.nodes[2].kind, "tool.call");
        assert_eq!(g.nodes[2].tool.as_deref(), Some("fs-write"));
        assert_eq!(g.nodes[2].input, None);
        assert_eq!(g.edges.len(), 2);
        assert_eq!(g.edges[0].source, "gather");
        assert_eq!(g.edges[0].target, "summarise");
        assert_eq!(g.edges[1].source, "summarise");
        assert_eq!(g.edges[1].target, "save-results");
    }

    #[test]
    fn build_report_has_one_sequence_edge() {
        let dir = write_project(&[(
            "build-report.toml",
            r#"
[workflow]
default-agent = "researcher"
[[steps]]
id = "collect"
kind = "agent.run"
agent = "researcher"
input = "${input}"
[[steps]]
id = "render"
kind = "tool.call"
tool = "fs-write"
args = { path = "/tmp/r.html" }
"#,
        )]);
        let g = parse_workflow_graph(dir.path(), "build-report").unwrap();
        assert_eq!(g.edges.len(), 1);
        assert_eq!(g.edges[0].source, "collect");
        assert_eq!(g.edges[0].target, "render");
    }

    #[test]
    fn missing_workflow_is_not_found() {
        let dir = write_project(&[]);
        let err = parse_workflow_graph(dir.path(), "nope").unwrap_err();
        assert!(matches!(err, GraphError::NotFound(_)));
    }

    #[test]
    fn malformed_toml_is_parse_error() {
        let dir = write_project(&[("broken.toml", "this is = = not valid toml [[[")]);
        let err = parse_workflow_graph(dir.path(), "broken").unwrap_err();
        assert!(matches!(err, GraphError::Parse { .. }));
    }
}
