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
