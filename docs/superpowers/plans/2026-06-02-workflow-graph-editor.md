# Workflow Graph Editor (gated β.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/workflows` `StubPage` with a real, mock-backed Workflow graph editor on the existing `@xyflow/react` canvas — a node/edge DAG of a workflow's steps, view-by-default with a local edit mode, where Save → Workflow IR is gated on tau β.2.

**Architecture:** A new gateway `graph` module (mock seam `WorkflowGraphSource`/`MockGraph`/`CliGraph` returning a `WorkflowGraph`) + one scoped read-only endpoint `GET /workflows/:name/graph`; a frontend `GraphEditor` (toolbar + inspector + mode toggle + gated Build) wrapping a thin `GraphCanvas` (React Flow), with a pure `workflowToFlow` layout. Edit mode mutates local React state only.

**Tech Stack:** Rust, axum 0.7, serde, ts-rs; React 18, react-router-dom v6, `@xyflow/react` v12 (React Flow), Vitest, Playwright.

This is the single plan for the Workflow graph editor (see `docs/superpowers/specs/2026-06-02-workflow-graph-editor-design.md`) — surface ①, gated β.2.

---

## File Structure

**New:**
- `gateway/src/graph/mod.rs` — `WorkflowNode`/`WorkflowEdge`/`WorkflowGraph` types, `WorkflowGraphSource` seam (`MockGraph`/`CliGraph`).
- `gateway/src/api/graph.rs` — the `graph` handler.
- `web/src/api/graph.ts` — `getWorkflowGraph`.
- `web/src/graph/layout.ts` — pure `workflowToFlow`.
- `web/src/graph/StepNode.tsx` — custom React Flow node.
- `web/src/graph/GraphCanvas.tsx` — thin React Flow wrapper.
- `web/src/graph/GraphEditor.tsx` — the editor (toolbar/inspector/mode/gated Build).
- Tests: `gateway/tests/graph_api.rs`, `web/src/graph/layout.test.ts`, `web/src/graph/GraphEditor.test.tsx`.

**Modified:**
- `gateway/src/lib.rs` — `pub mod graph;`.
- `gateway/src/state.rs` — `graph_source` field + `workflow_graph()` wrapper.
- `gateway/src/api/mod.rs` — `pub mod graph;` + `/workflows/:name/graph` route.
- `web/src/App.tsx` — `/workflows` route renders `<GraphEditor />`; remove the now-unused `StubPage` import.

(`Sidebar.tsx` is unchanged — Workflows keeps `gated: true`. `web/src/graph/README.md` may be left as-is or deleted; leaving it is fine.)

---

## Task 1: Types + `WorkflowGraphSource` seam

**Files:**
- Create: `gateway/src/graph/mod.rs`
- Modify: `gateway/src/lib.rs`

- [ ] **Step 1: Add the module to lib.rs**

In `gateway/src/lib.rs`, insert `pub mod graph;` alphabetically — after `pub mod config;` and before `pub mod packages;`:

```rust
pub mod config;
pub mod graph;
pub mod packages;
```

- [ ] **Step 2: Create `gateway/src/graph/mod.rs`**

```rust
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
                    node("gather", "agent.run", Some("researcher"), None, Some("${input}")),
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
                edges: vec![edge("gather", "summarise"), edge("summarise", "save-results")],
            },
            "build-report" => WorkflowGraph {
                workflow: name.into(),
                nodes: vec![
                    node("collect", "agent.run", Some("researcher"), None, Some("${input}")),
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
```

- [ ] **Step 3: Write the failing tests** — add a test module at the bottom of `gateway/src/graph/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_seeds_nightly_research() {
        let g = MockGraph.graph("nightly-research");
        assert_eq!(g.workflow, "nightly-research");
        assert_eq!(g.nodes.len(), 3);
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
```

- [ ] **Step 4: Run + commit**

Run: `cargo test -p tau-gateway --lib graph::tests`
Expected: PASS (4 tests). Also `cargo build -p tau-gateway` (clean — no unused imports).

```bash
git add gateway/src/lib.rs gateway/src/graph/mod.rs
git commit -m "feat(gateway): workflow graph types + mock seam"
```

---

## Task 2: AppState wrapper

**Files:**
- Modify: `gateway/src/state.rs`

- [ ] **Step 1: Add the import** — in `gateway/src/state.rs`, add to the `use` block (alphabetically `graph` sits just after `config`/`checks`, before `packages`):

```rust
use crate::graph::{self, WorkflowGraph, WorkflowGraphSource};
```

- [ ] **Step 2: Add the `Inner` field** — add to the `Inner` struct, right after the existing `check_source: Box<dyn CheckSource>,` field:

```rust
    graph_source: Box<dyn WorkflowGraphSource>,
```

- [ ] **Step 3: Build it in `AppState::new`** — right after the existing `check_source` selection block (`is_mock` is in scope):

```rust
        let graph_source: Box<dyn WorkflowGraphSource> = if is_mock {
            Box::new(graph::MockGraph)
        } else {
            Box::new(graph::CliGraph)
        };
```

and add `graph_source` to the `Inner { ... }` struct literal, right after the existing `check_source,` line:

```rust
            check_source,
            graph_source,
```

- [ ] **Step 4: Add the wrapper method** — inside `impl AppState`, right after the existing `checks` method:

```rust
    pub fn workflow_graph(&self, name: &str) -> WorkflowGraph {
        self.0.graph_source.graph(name)
    }
```

- [ ] **Step 5: Run + commit**

Run: `cargo build -p tau-gateway && cargo test -p tau-gateway --lib`
Expected: PASS, no regressions.

```bash
git add gateway/src/state.rs
git commit -m "feat(gateway): AppState graph_source + workflow_graph wrapper"
```

---

## Task 3: API route + integration test

**Files:**
- Create: `gateway/src/api/graph.rs`, `gateway/tests/graph_api.rs`
- Modify: `gateway/src/api/mod.rs`

- [ ] **Step 1: Create `gateway/src/api/graph.rs`**

```rust
use axum::extract::Path;
use axum::Json;

use crate::api::scope::Scoped;
use crate::graph::WorkflowGraph;

pub async fn graph(
    Scoped(state): Scoped,
    Path((_pid, name)): Path<(String, String)>,
) -> Json<WorkflowGraph> {
    Json(state.workflow_graph(&name))
}
```

- [ ] **Step 2: Wire the route in `gateway/src/api/mod.rs`**

Add `pub mod graph;` to the module list at the top — alphabetically, after `pub mod config;` and before `pub mod meta;`:

```rust
pub mod config;
pub mod graph;
pub mod meta;
```

In the scoped router, find the existing `.route("/workflows/run", post(workflows::run))` line and chain the graph route right after it:

```rust
        .route("/workflows/run", post(workflows::run))
        .route("/workflows/:name/graph", get(graph::graph))
```

(`get` is already imported via `axum::routing::{delete, get, post}`. The 3-segment `/workflows/:name/graph` does not conflict with the 2-segment `/workflows/run`.)

- [ ] **Step 3: Create `gateway/tests/graph_api.rs`**

```rust
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}
fn project() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn workflow_graph_over_http() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    let resp = http
        .get(format!(
            "{base}/api/projects/{}/workflows/nightly-research/graph",
            meta.id
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let g: serde_json::Value = resp.json().await.unwrap();

    assert_eq!(g["workflow"], "nightly-research");
    assert_eq!(g["nodes"].as_array().unwrap().len(), 3);
    assert_eq!(g["edges"].as_array().unwrap().len(), 2);

    let nodes = g["nodes"].as_array().unwrap();
    let gather = nodes.iter().find(|n| n["id"] == "gather").unwrap();
    assert_eq!(gather["kind"], "agent.run");
    let save = nodes.iter().find(|n| n["id"] == "save-results").unwrap();
    assert_eq!(save["kind"], "tool.call");
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test graph_api`
Expected: PASS. Confirm `git status --porcelain fixtures/demo` stays clean (read-only).

```bash
git add gateway/src/api/graph.rs gateway/src/api/mod.rs gateway/tests/graph_api.rs
git commit -m "feat(gateway): GET /workflows/:name/graph route + integration test"
```

---

## Task 4: ts-rs export + rust gate

**Files:**
- Regenerated: `web/src/types/{WorkflowNode,WorkflowEdge,WorkflowGraph}.ts`

- [ ] **Step 1: Regenerate** — `cargo build -p fake-tau-serve && cargo test -p tau-gateway` → PASS; new files under `web/src/types/`. Confirm `git status --porcelain fixtures/demo` is empty.

- [ ] **Step 2: Verify** — `ls web/src/types/ | grep -E "WorkflowNode|WorkflowEdge|WorkflowGraph"` → all three present. `cat web/src/types/WorkflowGraph.ts` should reference `WorkflowNode` and `WorkflowEdge`.

- [ ] **Step 3: Full rust gate** — `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green. Fix fmt minimally with `cargo fmt --all` if needed. The pre-existing ts-rs serde-attr note is benign.

- [ ] **Step 4: Commit**

```bash
git add web/src/types gateway/
git commit -m "chore(gateway): export workflow graph TS bindings + fmt/clippy"
```

---

## Task 5: Frontend — `api/graph.ts` + pure `layout.ts`

**Files:**
- Create: `web/src/api/graph.ts`, `web/src/graph/layout.ts`, `web/src/graph/layout.test.ts`

- [ ] **Step 1: Create `web/src/api/graph.ts`**

```ts
import type { WorkflowGraph } from "../types/WorkflowGraph";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getWorkflowGraph = (name: string) =>
  fetch(scopedPath(`/workflows/${name}/graph`)).then(json<WorkflowGraph>);
```

- [ ] **Step 2: Write the failing `layout.test.ts` `web/src/graph/layout.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { workflowToFlow } from "./layout";
import type { WorkflowGraph } from "../types/WorkflowGraph";

const nightly: WorkflowGraph = {
  workflow: "nightly-research",
  nodes: [
    { id: "gather", kind: "agent.run", label: "gather", agent: "researcher", tool: null, input: "${input}" },
    { id: "summarise", kind: "agent.run", label: "summarise", agent: "greeter", tool: null, input: "${steps.gather.output}" },
    { id: "save-results", kind: "tool.call", label: "save-results", agent: null, tool: "fs-write", input: "${steps.summarise.output}" },
  ],
  edges: [
    { source: "gather", target: "summarise" },
    { source: "summarise", target: "save-results" },
  ],
};

const disconnected: WorkflowGraph = {
  workflow: "build-report",
  nodes: [
    { id: "collect", kind: "agent.run", label: "collect", agent: "researcher", tool: null, input: null },
    { id: "render", kind: "tool.call", label: "render", agent: null, tool: "fs-write", input: null },
  ],
  edges: [],
};

describe("workflowToFlow", () => {
  it("lays out a chain left-to-right by dependency depth", () => {
    const { nodes, edges } = workflowToFlow(nightly);
    expect(nodes.map((n) => n.position.x)).toEqual([0, 220, 440]);
    expect(nodes[0].data.kind).toBe("agent.run");
    expect(nodes[2].data.tool).toBe("fs-write");
    expect(edges).toHaveLength(2);
    expect(edges[0].id).toBe("gather->summarise");
  });

  it("stacks disconnected nodes at depth 0", () => {
    const { nodes, edges } = workflowToFlow(disconnected);
    expect(nodes.every((n) => n.position.x === 0)).toBe(true);
    expect(nodes.map((n) => n.position.y)).toEqual([0, 70]);
    expect(edges).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Create `web/src/graph/layout.ts`**

```ts
import type { Node, Edge } from "@xyflow/react";
import type { WorkflowGraph } from "../types/WorkflowGraph";

export interface StepNodeData extends Record<string, unknown> {
  label: string;
  kind: string; // "agent.run" | "tool.call"
  agent: string | null;
  tool: string | null;
  input: string | null;
}

const X_GAP = 220;
const Y_GAP = 70;

/**
 * Deterministic DAG layout: x = dependency depth (longest path from a root),
 * y = order within a depth. Assumes an acyclic graph (workflow DAG).
 */
export function workflowToFlow(graph: WorkflowGraph): {
  nodes: Node<StepNodeData>[];
  edges: Edge[];
} {
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
  }

  const depthCache = new Map<string, number>();
  const depth = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const srcs = incoming.get(id) ?? [];
    const d = srcs.length === 0 ? 0 : Math.max(...srcs.map(depth)) + 1;
    depthCache.set(id, d);
    return d;
  };

  const seenAtDepth = new Map<number, number>();
  const nodes: Node<StepNodeData>[] = graph.nodes.map((n) => {
    const d = depth(n.id);
    const order = seenAtDepth.get(d) ?? 0;
    seenAtDepth.set(d, order + 1);
    return {
      id: n.id,
      type: "step",
      position: { x: d * X_GAP, y: order * Y_GAP },
      data: { label: n.label, kind: n.kind, agent: n.agent, tool: n.tool, input: n.input },
    };
  });

  const edges: Edge[] = graph.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
  }));

  return { nodes, edges };
}
```

- [ ] **Step 4: Run + commit**

Run: `cd web && pnpm test -- src/graph/layout.test.ts && pnpm typecheck`
Expected: green.

```bash
git add web/src/api/graph.ts web/src/graph/layout.ts web/src/graph/layout.test.ts
git commit -m "feat(web): workflow graph api + pure layout"
```

---

## Task 6: Frontend — `StepNode` + `GraphCanvas` + `GraphEditor` + routing

**Files:**
- Create: `web/src/graph/StepNode.tsx`, `web/src/graph/GraphCanvas.tsx`, `web/src/graph/GraphEditor.tsx`, `web/src/graph/GraphEditor.test.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Create `web/src/graph/StepNode.tsx`**

```tsx
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StepNodeData } from "./layout";

export function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const tool = data.kind === "tool.call";
  const who = data.agent ?? data.tool;
  return (
    <div
      className={`min-w-[130px] rounded-lg border px-2.5 py-1.5 text-xs ${
        tool ? "border-st-running/40 bg-st-running-soft" : "border-accent/40 bg-accent/5"
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold">{data.label}</div>
      <div className="text-muted">
        {data.kind}
        {who ? ` · ${who}` : ""}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/graph/GraphCanvas.tsx`**

```tsx
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import { StepNode } from "./StepNode";

const nodeTypes = { step: StepNode };

export function GraphCanvas({
  nodes,
  edges,
  editable,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelect,
}: {
  nodes: Node[];
  edges: Edge[];
  editable: boolean;
  onNodesChange: (c: NodeChange[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="h-[420px] w-full rounded-md border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={editable}
        nodesConnectable={editable}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

(The `@xyflow/react` stylesheet is already imported globally in `web/src/main.tsx` — do not import it here.)

- [ ] **Step 3: Write the failing `GraphEditor` test `web/src/graph/GraphEditor.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GraphEditor } from "./GraphEditor";

// The React Flow canvas needs real layout (jsdom can't) — mock it out; the live
// canvas is covered by the e2e test.
vi.mock("./GraphCanvas", () => ({ GraphCanvas: () => <div data-testid="canvas" /> }));

const graph = {
  workflow: "nightly-research",
  nodes: [
    { id: "gather", kind: "agent.run", label: "gather", agent: "researcher", tool: null, input: "${input}" },
    { id: "summarise", kind: "agent.run", label: "summarise", agent: "greeter", tool: null, input: "${steps.gather.output}" },
    { id: "save-results", kind: "tool.call", label: "save-results", agent: null, tool: "fs-write", input: "${steps.summarise.output}" },
  ],
  edges: [
    { source: "gather", target: "summarise" },
    { source: "summarise", target: "save-results" },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/graph"))
        return Promise.resolve({ ok: true, json: async () => graph });
      if (url.includes("/workflows"))
        return Promise.resolve({ ok: true, json: async () => ({ workflows: ["nightly-research", "build-report"] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
});

describe("GraphEditor", () => {
  it("loads the graph, shows a disabled gated Build button + the first step inspector", async () => {
    render(<GraphEditor />);
    await waitFor(() => expect(screen.getByRole("combobox", { name: /workflow/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /build from ir/i })).toBeDisabled();
    // default-selected first node → inspector shows "gather" (canvas is mocked, so this is unique)
    await waitFor(() => expect(screen.getByText("gather")).toBeInTheDocument());
  });

  it("toggles edit mode (local banner + add-step palette)", async () => {
    const user = userEvent.setup();
    render(<GraphEditor />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByText(/changes are local/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\+ agent\.run/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Create `web/src/graph/GraphEditor.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import type { WorkflowGraph } from "../types/WorkflowGraph";
import { getWorkflows } from "../api/client";
import { getWorkflowGraph } from "../api/graph";
import { workflowToFlow, type StepNodeData } from "./layout";
import { GraphCanvas } from "./GraphCanvas";

export function GraphEditor() {
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [nodes, setNodes] = useState<Node<StepNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [edit, setEdit] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [counter, setCounter] = useState(0);

  useEffect(() => {
    getWorkflows()
      .then((ws) => {
        setWorkflows(ws);
        setSelected((cur) => cur || ws[0] || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    getWorkflowGraph(selected)
      .then((g: WorkflowGraph) => {
        const flow = workflowToFlow(g);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setSelId(flow.nodes[0]?.id ?? null);
        setEdit(false);
      })
      .catch(() => {});
  }, [selected]);

  const onNodesChange = useCallback(
    (c: NodeChange[]) => setNodes((ns) => applyNodeChanges(c, ns) as Node<StepNodeData>[]),
    [],
  );
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((es) => applyEdgeChanges(c, es)), []);
  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge(c, es)), []);

  function addStep(kind: "agent.run" | "tool.call") {
    const id = `step-${counter + 1}`;
    setCounter((n) => n + 1);
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "step",
        position: { x: 40, y: 40 + ns.length * 20 },
        data: {
          label: id,
          kind,
          agent: kind === "agent.run" ? "researcher" : null,
          tool: kind === "tool.call" ? "fs-write" : null,
          input: null,
        },
      },
    ]);
  }

  const current = nodes.find((n) => n.id === selId) ?? null;

  function updateCurrent(patch: Partial<StepNodeData>) {
    if (!current) return;
    setNodes((ns) =>
      ns.map((n) => (n.id === current.id ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  }

  const inputCls = "mt-0.5 w-full rounded border border-border px-1.5 py-0.5 text-xs";

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Workflows / Graph</h2>
        <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">
          gated
        </span>
        <select
          aria-label="workflow"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="ml-2 rounded-md border border-border bg-surface px-2 py-1 text-xs"
        >
          {workflows.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <button
          onClick={() => setEdit((v) => !v)}
          className={`rounded-md px-3 py-1 text-xs font-semibold ${
            edit ? "bg-accent text-accent-fg" : "border border-border text-muted hover:text-fg"
          }`}
        >
          {edit ? "Done" : "Edit"}
        </button>
        <button
          disabled
          title="waits on tau β.2"
          className="ml-auto cursor-not-allowed rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 opacity-80"
        >
          🔒 Build from IR
        </button>
      </div>

      {edit && (
        <div className="rounded-md border border-dashed border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Edit mode — changes are local; Save → IR waits on tau β.2.
        </div>
      )}

      <div className="grid grid-cols-[1fr_190px] gap-3">
        <GraphCanvas
          nodes={nodes}
          edges={edges}
          editable={edit}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelect={setSelId}
        />
        <div className="space-y-2 text-xs">
          {edit && (
            <div className="space-y-1">
              <div className="text-[9px] uppercase text-muted">add step</div>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => addStep("agent.run")}
                  className="rounded-md border border-accent/40 px-2 py-0.5 text-[10px] text-accent"
                >
                  + agent.run
                </button>
                <button
                  onClick={() => addStep("tool.call")}
                  className="rounded-md border border-st-running/40 px-2 py-0.5 text-[10px] text-st-running"
                >
                  + tool.call
                </button>
              </div>
            </div>
          )}
          <div className="text-[9px] uppercase text-muted">step</div>
          {current ? (
            edit ? (
              <div className="space-y-1.5">
                <label className="block text-muted">
                  label
                  <input
                    value={current.data.label}
                    onChange={(e) => updateCurrent({ label: e.target.value })}
                    className={inputCls}
                  />
                </label>
                {current.data.kind === "agent.run" ? (
                  <label className="block text-muted">
                    agent
                    <input
                      value={current.data.agent ?? ""}
                      onChange={(e) => updateCurrent({ agent: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                ) : (
                  <label className="block text-muted">
                    tool
                    <input
                      value={current.data.tool ?? ""}
                      onChange={(e) => updateCurrent({ tool: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                <div className="font-semibold">{current.data.label}</div>
                <div className="text-muted">{current.data.kind}</div>
                <div className="text-muted">
                  {current.data.kind === "agent.run"
                    ? `agent ${current.data.agent}`
                    : `tool ${current.data.tool}`}
                </div>
                {current.data.input && (
                  <div className="font-mono text-[10px] text-muted">{current.data.input}</div>
                )}
              </div>
            )
          ) : (
            <div className="text-muted">Select a node.</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the route in `web/src/App.tsx` + remove the unused `StubPage` import**

Add the import near the other page imports (after the existing `ShipPage`/`HealthPage` imports):

```tsx
import { GraphEditor } from "./graph/GraphEditor";
```

Replace the existing `/workflows` route (it renders `<StubPage title="Workflows" subtitle="Author & run workflows — coming soon." gated="β.2 (visual graph)" />`) with:

```tsx
          <Route path="workflows" element={<GraphEditor />} />
```

Then **remove the now-unused import** at the top of `App.tsx`:

```tsx
import { StubPage } from "./app/StubPage";
```

(`/workflows` was the last `StubPage` route; removing the import keeps `pnpm lint` green. Do NOT delete `web/src/app/StubPage.tsx` or its test — the component stays a tested utility.)

- [ ] **Step 6: Run + commit**

Run: `cd web && pnpm test -- src/graph/GraphEditor.test.tsx && pnpm test && pnpm typecheck`
Expected: all green. (If `pnpm typecheck` flags the `applyNodeChanges` cast, the `as Node<StepNodeData>[]` is already in the code above — keep it.)

```bash
git add web/src/graph/StepNode.tsx web/src/graph/GraphCanvas.tsx web/src/graph/GraphEditor.tsx web/src/graph/GraphEditor.test.tsx web/src/App.tsx
git commit -m "feat(web): workflow graph editor (view + local edit, gated build)"
```

---

## Task 7: E2e + final gate

**Files:**
- Modify: `web/e2e/run.spec.ts`

- [ ] **Step 1: Append the spec**

```ts
test("workflows: graph editor renders + edit mode is gated", async ({ page }) => {
  await page.goto("/projects/demo/workflows");
  await expect(page.getByRole("combobox", { name: /workflow/i })).toBeVisible({ timeout: 5000 });
  // React Flow rendered the workflow nodes (assert the canvas node class — "gather"
  // text appears in both the canvas and the inspector, so don't match on it).
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 5000 });
  // enter edit mode → local banner + the gated Build button
  await page.getByRole("button", { name: /^edit$/i }).click();
  await expect(page.getByText(/changes are local/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /build from ir/i })).toBeDisabled();
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. Real ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; else `pnpm exec playwright test --list` and note e2e deferred to CI. A strict-mode "N elements" error → fix the selector minimally (`exact:true`/`.first()`), report the fix.

- [ ] **Step 3: Restore fixtures** (the graph surface is read-only, but other specs mutate `fixtures/demo/tau.toml` + may leave skill dirs):

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 4: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green. If format:check fails, `pnpm format`, re-check, include in the commit.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (git status)
git commit -m "test(web): e2e workflow graph editor"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-02-workflow-graph-editor-design.md`):
- §2 types (`WorkflowNode`/`WorkflowEdge`/`WorkflowGraph`) → Task 1. §3.1 `WorkflowGraphSource`/`MockGraph` (2 demo workflows w/ correct node kinds + edge structure; unknown empty)/`CliGraph` → Task 1. §3.2 AppState wrapper + `GET /workflows/:name/graph` → Tasks 2–3. ts-rs/CI (§6) → Task 4. §4.1 `api/graph.ts` → Task 5. §4.2 `workflowToFlow` layout → Task 5; `StepNode`/`GraphCanvas`/`GraphEditor` (toolbar, mode toggle, inspector, palette, gated Build, local banner) → Task 6. §4.4 route swap + StubPage import removal (Sidebar unchanged) → Task 6. §5 tests → Tasks 1, 3, 5, 6, 7. All covered.

**Placeholder scan:** none — every step has complete code.

**Type consistency:** `WorkflowNode { id, kind, label, agent?, tool?, input? }`, `WorkflowEdge { source, target }`, `WorkflowGraph { workflow, nodes, edges }` are used identically across the module, the AppState wrapper, the handler, the integration test, and the frontend. `StepNodeData { label, kind, agent: string|null, tool: string|null, input: string|null }` is consistent between `layout.ts`, `StepNode.tsx`, and `GraphEditor.tsx`. `workflowToFlow(WorkflowGraph) -> {nodes, edges}` and `getWorkflowGraph(name)` signatures match callers. The `GET /workflows/:name/graph` path matches `getWorkflowGraph` (`scopedPath(\`/workflows/${name}/graph\`)`). `getWorkflows()` returns `string[]` (existing). `MockGraph`/`CliGraph` are unit structs (`Box::new(graph::MockGraph)`).

**Note for executor:** `/workflows/:name/graph` is read-only (pure mock) — `git status --porcelain fixtures/demo` stays clean; other e2e specs mutate fixtures, so Task 6 Step 3 restores them. **React Flow testing:** the `@xyflow/react` canvas is never asserted in jsdom — the `GraphEditor.test.tsx` mocks `./GraphCanvas` (so "gather" appears only in the inspector → single match), the pure `workflowToFlow` is unit-tested, and the **e2e** asserts the live canvas via `.react-flow__node` (NOT the text "gather", which appears in both the canvas node and the inspector). The `StubPage` import MUST be removed from `App.tsx` in Task 6 Step 5 (last consumer) or `pnpm lint` fails; the `StubPage.tsx` component + its test stay.
