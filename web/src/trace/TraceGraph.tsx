import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import type { Span } from "../types/Span";
import { spansToFlow, type SpanNodeData } from "./layout";
import { useStore } from "../store/store";

const STATUS_FILL: Record<string, string> = {
  running: "#dbeafe",
  ok: "#dcfce7",
  error: "#fee2e2",
};

function SpanNode({ data, id }: NodeProps<Node<SpanNodeData>>) {
  const selected = useStore((s) => s.selectedSpanId === id);
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        fontSize: 12,
        background: STATUS_FILL[data.status] ?? "#f3f4f6",
        border: selected ? "2px solid #2563eb" : "1px solid #cbd5e1",
        minWidth: 120,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontWeight: 600 }}>{data.label}</div>
      <div style={{ color: "#64748b" }}>
        {data.kind} · {data.status}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { span: SpanNode };

export function TraceGraph({ spans }: { spans: Span[] }) {
  const select = useStore((s) => s.selectSpan);
  const { nodes, edges } = useMemo(() => spansToFlow(spans), [spans]);
  return (
    <div style={{ height: "100%", width: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
