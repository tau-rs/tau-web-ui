import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

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
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.6,
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
          strokeWidth: 1.6,
          strokeDasharray: "6 4",
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
