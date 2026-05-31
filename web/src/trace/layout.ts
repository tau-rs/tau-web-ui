import type { Node, Edge } from "@xyflow/react";
import type { Span } from "../types/Span";

export interface SpanNodeData extends Record<string, unknown> {
  label: string;
  kind: Span["kind"];
  status: Span["status"];
}

const X_GAP = 220;
const Y_GAP = 70;

/** Deterministic tree layout: x = depth, y = order within a depth-first walk. */
export function spansToFlow(spans: Span[]): { nodes: Node<SpanNodeData>[]; edges: Edge[] } {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const childrenOf = new Map<string | null, Span[]>();
  for (const s of spans) {
    const key = s.parent_id && byId.has(s.parent_id) ? s.parent_id : null;
    const list = childrenOf.get(key) ?? [];
    list.push(s);
    childrenOf.set(key, list);
  }

  const nodes: Node<SpanNodeData>[] = [];
  const edges: Edge[] = [];
  let row = 0;

  function walk(parent: string | null, depth: number) {
    for (const s of childrenOf.get(parent) ?? []) {
      nodes.push({
        id: s.id,
        position: { x: depth * X_GAP, y: row * Y_GAP },
        data: { label: s.name, kind: s.kind, status: s.status },
        type: "span",
      });
      if (s.parent_id && byId.has(s.parent_id)) {
        edges.push({ id: `${s.parent_id}->${s.id}`, source: s.parent_id, target: s.id });
      }
      row += 1;
      walk(s.id, depth + 1);
    }
  }
  walk(null, 0);
  return { nodes, edges };
}
