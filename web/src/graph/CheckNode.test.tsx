import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider, type Node, type NodeProps } from "@xyflow/react";
import { CheckNode } from "./CheckNode";
import { GraphActionsContext } from "./GraphActions";
import type { StepNodeData } from "./layout";

const actions = {
  editable: false,
  onInspect: () => {},
  onDisable: () => {},
  onDuplicate: () => {},
  onDelete: () => {},
  onRequestAdd: () => {},
  onRequestInsert: () => {},
};
function renderNode(data: Partial<StepNodeData>) {
  const full: StepNodeData = {
    label: "report",
    kind: "check.deliverable",
    agent: null,
    tool: null,
    input: null,
    provider: null,
    tools: [],
    checkKind: "deliverable",
    ...data,
  };
  const props: NodeProps<Node<StepNodeData>> = {
    id: "check-report",
    data: full,
    selected: false,
    type: "check",
    dragging: false,
    draggable: false,
    selectable: false,
    deletable: false,
    zIndex: 0,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
  return render(
    <ReactFlowProvider>
      <GraphActionsContext.Provider value={actions}>
        <CheckNode {...props} />
      </GraphActionsContext.Provider>
    </ReactFlowProvider>,
  );
}

describe("CheckNode", () => {
  it("shows ◇ validated when no run + no build error", () => {
    renderNode({});
    expect(screen.getByText(/validated/i)).toBeInTheDocument();
  });
  it("shows the build error state", () => {
    renderNode({ buildError: "gate after producer" });
    expect(screen.getByText(/build error/i)).toBeInTheDocument();
  });
  it("shows runtime met + ×N when retried", () => {
    renderNode({ runStatus: "met", attemptCount: 2 });
    expect(screen.getByText("met")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
  });
});
