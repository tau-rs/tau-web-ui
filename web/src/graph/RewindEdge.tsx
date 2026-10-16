import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function RewindEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
    offset: 28,
  });
  const dimmed = (data as { dimmed?: boolean } | undefined)?.dimmed;
  const attempts = (data as { attempts?: number } | undefined)?.attempts ?? 1;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: "#d29922",
          strokeWidth: 2,
          strokeDasharray: "7 4",
          opacity: dimmed ? 0.25 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
            opacity: dimmed ? 0.25 : 1,
          }}
          className="rounded-full border border-amber-700 bg-amber-100 px-1.5 text-[9px] font-semibold text-amber-800"
        >
          ↻ retry ×{attempts}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
