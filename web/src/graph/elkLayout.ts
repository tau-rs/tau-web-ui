import ELKConstructor from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";

/** Minimal shape of the ELK instance we use — lets tests inject a fake. */
export interface ElkLike {
  layout(graph: unknown): Promise<{ children?: { id: string; x?: number; y?: number }[] }>;
}

const NODE_W = 172;
const NODE_H = 52;

const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.feedbackEdges": "true",
  "elk.layered.cycleBreaking.strategy": "GREEDY",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "44",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
};

/**
 * Assign positions to `nodes` with ELK's layered algorithm. Edges (including the
 * cyclic rewind edge) inform layering/spacing; ELK detects the back-edge via
 * cycle-breaking + feedbackEdges. Returns a new array; inputs are not mutated.
 * `elk` is injectable for deterministic tests.
 */
export async function elkLayout(
  nodes: Node[],
  edges: Edge[],
  elk: ElkLike = new ELKConstructor() as unknown as ElkLike,
): Promise<Node[]> {
  const graph = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const res = await elk.layout(graph);
  const pos = new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
}
