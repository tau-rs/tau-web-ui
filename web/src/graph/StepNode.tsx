import { Handle, Position, NodeToolbar, type Node, type NodeProps } from "@xyflow/react";
import type { StepNodeData } from "./layout";
import { useGraphActions } from "./GraphActions";

export function StepNode({ id, data, selected }: NodeProps<Node<StepNodeData>>) {
  const tool = data.kind === "tool.call";
  const who = data.agent ?? data.tool;
  const actions = useGraphActions();
  const handle = "!h-2 !w-2 !border !border-border !bg-muted";
  const tbtn = "rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10";
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
          className={tbtn}
          onClick={() => actions.onInspect(id)}
        >
          ⊙
        </button>
        {actions.editable && (
          <>
            <button
              type="button"
              title={data.disabled ? "enable" : "disable"}
              aria-label={data.disabled ? "enable" : "disable"}
              className={tbtn}
              onClick={() => actions.onDisable(id)}
            >
              {data.disabled ? "▶" : "⏸"}
            </button>
            <button
              type="button"
              title="duplicate"
              aria-label="duplicate"
              className={tbtn}
              onClick={() => actions.onDuplicate(id)}
            >
              ⧉
            </button>
            <button
              type="button"
              title="delete"
              aria-label="delete"
              className={tbtn}
              onClick={() => actions.onDelete(id)}
            >
              🗑
            </button>
          </>
        )}
      </NodeToolbar>
      <div
        className={`relative flex min-w-[150px] items-center gap-2 rounded-lg border bg-surface px-2.5 py-2 text-xs shadow-sm ${
          selected ? "ring-2 ring-accent" : ""
        } ${tool ? "border-st-running/40" : "border-accent/40"} ${data.disabled ? "opacity-50" : ""}`}
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
          <div className={`truncate font-semibold ${data.disabled ? "line-through" : ""}`}>
            {data.label}
          </div>
          <div className="flex items-center gap-1 text-muted">
            <span className="truncate">{who ?? data.kind}</span>
            {!tool && data.provider && (
              <span className="flex-none rounded bg-accent/10 px-1 text-[9px] font-medium text-accent">
                ⚡ {data.provider}
              </span>
            )}
          </div>
          {data.goalBadges && data.goalBadges.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {data.goalBadges.map((g) => (
                <span
                  key={g.id}
                  className={`rounded-full px-1.5 text-[9px] font-semibold ${
                    g.status === "met"
                      ? "border border-st-ok bg-st-ok-soft text-st-ok"
                      : g.status === "failed"
                        ? "border border-st-error bg-st-error-soft text-st-error"
                        : "border border-accent/50 bg-accent/10 text-accent"
                  }`}
                >
                  {g.status === "failed" ? "✕" : "✓"} goal {g.id}
                </span>
              ))}
            </div>
          )}
        </div>
        {actions.editable && (
          <button
            type="button"
            title="add next step"
            aria-label="add next step"
            onClick={(ev) => {
              ev.stopPropagation();
              actions.onRequestAdd(id, { x: ev.clientX, y: ev.clientY });
            }}
            className="absolute -right-3 top-1/2 z-10 -mt-2.5 flex h-5 w-5 items-center justify-center rounded-full border border-accent bg-surface text-xs font-bold text-accent"
          >
            +
          </button>
        )}
        <Handle type="source" position={Position.Right} className={handle} />
      </div>
    </>
  );
}
