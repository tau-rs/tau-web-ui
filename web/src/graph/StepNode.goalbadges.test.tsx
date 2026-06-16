import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider, type Node, type NodeProps } from "@xyflow/react";
import { StepNode } from "./StepNode";
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
    label: "researcher",
    kind: "agent.run",
    agent: "researcher",
    tool: null,
    input: null,
    provider: null,
    tools: [],
    ...data,
  };
  const props: NodeProps<Node<StepNodeData>> = {
    id: "step-researcher",
    data: full,
    selected: false,
    type: "step",
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
        <StepNode {...props} />
      </GraphActionsContext.Provider>
    </ReactFlowProvider>,
  );
}

describe("StepNode goal badges", () => {
  it("renders goal badge text when goalBadges is set", () => {
    renderNode({ goalBadges: [{ id: "has_sources", status: "met" }] });
    expect(screen.getByText(/goal has_sources/i)).toBeInTheDocument();
  });

  it("does not render badge container when goalBadges is empty", () => {
    renderNode({ goalBadges: [] });
    expect(screen.queryByText(/goal /i)).not.toBeInTheDocument();
  });
});
