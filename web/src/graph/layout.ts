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
