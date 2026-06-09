import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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
        <MiniMap pannable zoomable className="!bg-surface" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
