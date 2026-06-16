import { Handle, Position, NodeToolbar, type Node, type NodeProps } from "@xyflow/react";
import type { StepNodeData } from "./layout";
import { useGraphActions } from "./GraphActions";

export function CheckNode({ id, data, selected }: NodeProps<Node<StepNodeData>>) {
  const actions = useGraphActions();
  const handle = "!h-2 !w-2 !border !border-border !bg-muted !opacity-40"; // inspect-only: dimmed
  const border = data.buildError ? "border-st-error border-dashed" : "border-accent/50";
  return (
    <>
      <NodeToolbar
        isVisible={selected}
        position={Position.Top}
        className="flex gap-0.5 rounded-md bg-fg px-1 py-0.5 text-bg"
      >
        <button
          type="button"
          title="inspect"
          aria-label="inspect"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10"
          onClick={() => actions.onInspect(id)}
        >
          ⊙
        </button>
      </NodeToolbar>
      <div
        className={`relative flex min-w-[150px] items-center gap-2 rounded-lg border bg-surface px-2.5 py-2 text-xs shadow-sm ${
          selected ? "ring-2 ring-accent" : ""
        } ${border}`}
      >
        <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
        <div
          aria-hidden
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-accent text-sm text-white"
        >
          ⬇
        </div>
        <div className="min-w-0">
          <div className="truncate font-semibold">{data.label}</div>
          <div className="flex items-center gap-1 text-muted">
            <span className="text-[9px] uppercase tracking-wide">deliverable</span>
          </div>
        </div>
        <div className="absolute -right-2 -top-2 flex gap-1">
          {data.buildError ? (
            <span className="rounded-full border border-st-error bg-st-error-soft px-1.5 text-[9px] font-semibold text-st-error">
              ✕ build error
            </span>
          ) : data.runStatus ? (
            <>
              {data.attemptCount && data.attemptCount > 1 && (
                <span className="rounded-full border border-amber-600 bg-amber-100 px-1.5 text-[9px] font-semibold text-amber-800">
                  ×{data.attemptCount}
                </span>
              )}
              <span
                className={`rounded-full px-1.5 text-[9px] font-semibold ${
                  data.runStatus === "met"
                    ? "border border-st-ok bg-st-ok-soft text-st-ok"
                    : "border border-st-error bg-st-error-soft text-st-error"
                }`}
              >
                {data.runStatus}
              </span>
            </>
          ) : (
            <span className="rounded-full border border-accent/50 bg-accent/10 px-1.5 text-[9px] font-semibold text-accent">
              ◇ validated
            </span>
          )}
        </div>
        <Handle type="source" position={Position.Right} className={handle} isConnectable={false} />
      </div>
    </>
  );
}
