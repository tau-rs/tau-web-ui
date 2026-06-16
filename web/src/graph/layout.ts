import type { Node, Edge } from "@xyflow/react";
import type { WorkflowGraph } from "../types/WorkflowGraph";
import type { CompiledIr } from "../types/CompiledIr";

export interface StepNodeData extends Record<string, unknown> {
  label: string;
  kind: string; // "agent.run" | "tool.call"
  agent: string | null;
  tool: string | null;
  input: string | null;
  provider: string | null;
  tools: string[];
  caps?: string[]; // tool.call nodes (compiled IR view): capability requirements
  disabled?: boolean;
  // --- postcondition checks (mock) ---
  checkKind?: "goal" | "deliverable"; // set on CheckNode (type "check")
  buildError?: string; // design-time: dashed-red border + message
  runStatus?: "met" | "failed" | "aborted" | null; // runtime corner badge
  attemptCount?: number; // runtime: ×N when > 1
  goalBadges?: { id: string; status: "met" | "failed" | "validated" }[]; // on producer StepNodes
}

export const X_GAP = 220;
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
      data: {
        label: n.label,
        kind: n.kind,
        agent: n.agent,
        tool: n.tool,
        input: n.input,
        provider: n.provider,
        tools: n.tools,
      },
    };
  });

  const edges: Edge[] = graph.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    type: "step",
  }));

  return { nodes, edges };
}

/**
 * Lay out the compiled project IR: agents as `agent.run` nodes, tools as
 * `tool.call` nodes, subflow edges between them. Agents NOT in `workflowAgents`
 * are dimmed (they belong to the project but not the selected workflow).
 */
export function irToFlow(
  ir: CompiledIr,
  workflowAgents: Set<string>,
): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const graph: WorkflowGraph = {
    workflow: "",
    nodes: [
      ...ir.agents.map((a) => ({
        id: a.id,
        kind: "agent.run",
        label: a.id,
        agent: a.id,
        tool: null,
        input: null,
        provider: a.llm_backend,
        tools: a.tools,
      })),
      ...ir.tools.map((t) => ({
        id: t.id,
        kind: "tool.call",
        label: t.id,
        agent: null,
        tool: t.id,
        input: null,
        provider: null,
        tools: [],
      })),
    ],
    edges: ir.edges.map((e) => ({ source: e.from, target: e.to })),
  };
  const flow = workflowToFlow(graph);
  const caps = new Map(ir.tools.map((t) => [t.id, t.capabilities]));
  flow.nodes = flow.nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      caps: n.data.kind === "tool.call" ? (caps.get(n.id) ?? []) : undefined,
    },
    style: n.data.kind === "agent.run" && !workflowAgents.has(n.id) ? { opacity: 0.4 } : undefined,
  }));
  return flow;
}
