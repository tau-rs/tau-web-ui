import { describe, it, expect, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { GraphCanvas } from "./GraphCanvas";
import type { Node, Edge } from "@xyflow/react";

// React Flow uses ResizeObserver internally; jsdom doesn't provide one.
beforeAll(() => {
  if (typeof window.ResizeObserver === "undefined") {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverMock;
  }
});

const noop = () => {};
const actions = {
  editable: false,
  onInspect: noop,
  onDisable: noop,
  onDuplicate: noop,
  onDelete: noop,
  onRequestAdd: noop,
  onRequestInsert: noop,
};

describe("GraphCanvas with checks", () => {
  it("renders a check node and a rewind edge without throwing", () => {
    const nodes: Node[] = [
      {
        id: "writer",
        type: "step",
        position: { x: 0, y: 0 },
        data: {
          label: "writer",
          kind: "agent.run",
          agent: "writer",
          tool: null,
          input: null,
          provider: "anthropic",
          tools: [],
        },
      },
      {
        id: "check-report",
        type: "check",
        position: { x: 220, y: 0 },
        data: {
          label: "report",
          kind: "check.deliverable",
          agent: null,
          tool: null,
          input: null,
          provider: null,
          tools: [],
          checkKind: "deliverable",
          runStatus: "met",
          attemptCount: 2,
        },
      },
    ];
    const edges: Edge[] = [
      {
        id: "check-report->writer",
        source: "check-report",
        target: "writer",
        type: "rewind",
        data: { attempts: 2 },
      },
    ];
    const { container } = render(
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        editable={false}
        actions={actions}
        onNodesChange={noop}
        onEdgesChange={noop}
        onConnect={noop}
        onSelect={noop}
      />,
    );
    expect(container.querySelector(".react-flow")).not.toBeNull();
  });
});
