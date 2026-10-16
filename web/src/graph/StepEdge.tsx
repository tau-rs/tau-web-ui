import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { useGraphActions } from "./GraphActions";

export function StepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
  const actions = useGraphActions();
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      {actions.editable && (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="insert step here"
            aria-label="insert step"
            onClick={(ev) => {
              ev.stopPropagation();
              actions.onRequestInsert(id, { x: ev.clientX, y: ev.clientY });
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-accent bg-surface text-xs font-bold text-accent"
          >
            +
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
