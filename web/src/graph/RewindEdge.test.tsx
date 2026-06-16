import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider, type Edge, type Node, Position } from "@xyflow/react";
import { RewindEdge } from "./RewindEdge";

beforeAll(() => {
  // React Flow needs ResizeObserver under jsdom
  if (!("ResizeObserver" in globalThis)) {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  }
});

// EdgeLabelRenderer portals into a DOM node created by <ReactFlow>; under jsdom
// without a measured viewport that node is never populated (edges never mount).
// Stub it to render children directly so the label is testable.
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// Direct render props for RewindEdge (bypasses React Flow's node-measurement gating)
const directProps = {
  id: "test-edge",
  sourceX: 0,
  sourceY: 0,
  targetX: 0,
  targetY: 160,
  sourcePosition: Position.Bottom,
  targetPosition: Position.Top,
  source: "b",
  target: "a",
  selected: false,
  animated: false,
  interactionWidth: 20,
  markerStart: undefined,
  markerEnd: undefined,
  style: {},
  label: undefined,
  labelStyle: {},
  labelShowBg: false,
  labelBgStyle: {},
  labelBgPadding: [2, 4] as [number, number],
  labelBgBorderRadius: 2,
  data: { attempts: 2 },
  deletable: true,
  selectable: true,
  focusable: true,
  pathOptions: undefined,
};

describe("RewindEdge", () => {
  it("renders the retry label with the attempt count", () => {
    render(
      <ReactFlowProvider>
        <svg>
          <g>
            <RewindEdge {...directProps} />
          </g>
        </svg>
      </ReactFlowProvider>,
    );
    expect(screen.getByText(/↻ retry ×2/)).toBeInTheDocument();
  });

  it("draws an orthogonal path (not a pure bezier)", () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <g>
            <RewindEdge {...directProps} />
          </g>
        </svg>
      </ReactFlowProvider>,
    );
    // getSmoothStepPath produces L/H/V commands; getBezierPath produces only C/M
    const path = container.querySelector("path.react-flow__edge-path") as SVGPathElement | null;
    expect(path).not.toBeNull();
    expect(path!.getAttribute("d") ?? "").toMatch(/[HVL]/);
  });
});

// Smoke test: ReactFlow mounts without error when rewind edge type is registered
const nodes: Node[] = [
  { id: "a", position: { x: 0, y: 0 }, data: {} },
  { id: "b", position: { x: 0, y: 160 }, data: {} },
];
const edges: Edge[] = [
  { id: "b->a", source: "b", target: "a", type: "rewind", data: { attempts: 2 } },
];

describe("RewindEdge via ReactFlow", () => {
  it("mounts without throwing", () => {
    const { container } = render(
      <div style={{ width: 400, height: 300 }}>
        <ReactFlow nodes={nodes} edges={edges} edgeTypes={{ rewind: RewindEdge }} fitView />
      </div>,
    );
    expect(container.querySelector(".react-flow")).not.toBeNull();
  });
});
