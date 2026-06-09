import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StepNodeData } from "./layout";

export function StepNode({ data, selected }: NodeProps<Node<StepNodeData>>) {
  const tool = data.kind === "tool.call";
  const who = data.agent ?? data.tool;
  const handle = "!h-2 !w-2 !border !border-border !bg-muted";
  return (
    <div
      className={`flex min-w-[150px] items-center gap-2 rounded-lg border bg-surface px-2.5 py-2 text-xs shadow-sm ${
        selected ? "ring-2 ring-accent" : ""
      } ${tool ? "border-st-running/40" : "border-accent/40"}`}
    >
      <Handle type="target" position={Position.Left} className={handle} />
      <div
        aria-hidden
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-md text-sm text-white ${
          tool ? "bg-st-running" : "bg-accent"
        }`}
      >
        {tool ? "⚒" : "◆"}
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold">{data.label}</div>
        <div className="flex items-center gap-1 text-muted">
          <span className="truncate">{who ?? data.kind}</span>
          {!tool && data.provider && (
            <span className="flex-none rounded bg-accent/10 px-1 text-[9px] font-medium text-accent">
              ⚡ {data.provider}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={handle} />
    </div>
  );
}
