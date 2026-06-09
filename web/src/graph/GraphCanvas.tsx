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
import { StepEdge } from "./StepEdge";
import { GraphActionsContext, type GraphActions } from "./GraphActions";

const nodeTypes = { step: StepNode };
const edgeTypes = { step: StepEdge };

export function GraphCanvas({
  nodes,
  edges,
  editable,
  actions,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onSelect,
}: {
  nodes: Node[];
  edges: Edge[];
  editable: boolean;
  actions: GraphActions;
  onNodesChange: (c: NodeChange[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;
  onSelect: (id: string | null) => void;
}) {
  return (
    <GraphActionsContext.Provider value={actions}>
      <div className="relative h-[420px] w-full rounded-md border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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
    </GraphActionsContext.Provider>
  );
}
