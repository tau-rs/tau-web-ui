import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import type { StepNodeData } from "./layout";
import {
  addNextStep,
  insertStepOnEdge,
  deleteNode,
  duplicateNode,
  toggleDisabled,
  nextStepId,
} from "./edit";

function n(id: string, x = 0, y = 0): Node<StepNodeData> {
  return {
    id,
    type: "step",
    position: { x, y },
    data: {
      label: id,
      kind: "agent.run",
      agent: "researcher",
      tool: null,
      input: null,
      provider: "anthropic",
      tools: [],
    },
  };
}
const e = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: "step",
});

describe("edit helpers", () => {
  it("nextStepId returns step-(max+1)", () => {
    expect(nextStepId([n("gather"), n("step-2")])).toBe("step-3");
    expect(nextStepId([n("gather")])).toBe("step-1");
  });

  it("addNextStep appends a node + a connecting edge from the source", () => {
    const { nodes, edges } = addNextStep([n("a")], [], "a", { kind: "agent.run" }, "anthropic");
    expect(nodes).toHaveLength(2);
    const added = nodes[1];
    expect(added.id).toBe("step-1");
    expect(added.data.kind).toBe("agent.run");
    expect(added.data.provider).toBe("anthropic"); // re-resolved to recommended
    expect(edges).toEqual([{ id: "a->step-1", source: "a", target: "step-1", type: "step" }]);
  });

  it("addNextStep with a tool.call pick has a null provider", () => {
    const { nodes } = addNextStep([n("a")], [], "a", { kind: "tool.call" }, "anthropic");
    expect(nodes[1].data.kind).toBe("tool.call");
    expect(nodes[1].data.provider).toBeNull();
    expect(nodes[1].data.tool).toBe("fs-write");
  });

  it("addNextStep with a specific agent presets it", () => {
    const { nodes } = addNextStep(
      [n("a")],
      [],
      "a",
      { kind: "agent.run", agent: "greeter" },
      "anthropic",
    );
    expect(nodes[1].data.agent).toBe("greeter");
  });

  it("addNextStep on a missing source is a no-op", () => {
    const before = { nodes: [n("a")], edges: [] as Edge[] };
    const after = addNextStep(
      before.nodes,
      before.edges,
      "nope",
      { kind: "agent.run" },
      "anthropic",
    );
    expect(after.nodes).toHaveLength(1);
    expect(after.edges).toHaveLength(0);
  });

  it("insertStepOnEdge replaces A->B with A->new->B (net +1 node, +1 edge)", () => {
    const nodes = [n("a", 0, 0), n("b", 440, 0)];
    const edges = [e("a", "b")];
    const out = insertStepOnEdge(nodes, edges, "a->b", { kind: "agent.run" }, "anthropic");
    expect(out.nodes).toHaveLength(3);
    const mid = out.nodes[2];
    expect(mid.id).toBe("step-1");
    expect(mid.position.x).toBe(220); // midpoint of 0 and 440
    expect(out.edges.map((x) => x.id).sort()).toEqual(["a->step-1", "step-1->b"]);
  });

  it("insertStepOnEdge on a missing edge is a no-op", () => {
    const out = insertStepOnEdge(
      [n("a")],
      [e("a", "b")],
      "x->y",
      { kind: "agent.run" },
      "anthropic",
    );
    expect(out.nodes).toHaveLength(1);
    expect(out.edges).toHaveLength(1);
  });

  it("deleteNode removes the node and its connected edges", () => {
    const nodes = [n("a"), n("b"), n("c")];
    const edges = [e("a", "b"), e("b", "c")];
    const out = deleteNode(nodes, edges, "b");
    expect(out.nodes.map((x) => x.id)).toEqual(["a", "c"]);
    expect(out.edges).toHaveLength(0);
  });

  it("duplicateNode clones with a fresh id + offset, no edges", () => {
    const out = duplicateNode([n("a", 10, 10)], "a");
    expect(out.newId).toBe("step-1");
    expect(out.nodes).toHaveLength(2);
    const copy = out.nodes[1];
    expect(copy.id).toBe("step-1");
    expect(copy.data.label).toBe("step-1");
    expect(copy.position).toEqual({ x: 50, y: 60 });
  });

  it("toggleDisabled flips the disabled flag on the matching node only", () => {
    const out = toggleDisabled([n("a"), n("b")], "a");
    expect(out[0].data.disabled).toBe(true);
    expect(out[1].data.disabled).toBeFalsy();
    expect(toggleDisabled(out, "a")[0].data.disabled).toBe(false);
  });
});
