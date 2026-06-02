import { describe, it, expect } from "vitest";
import { workflowToFlow } from "./layout";
import type { WorkflowGraph } from "../types/WorkflowGraph";

const nightly: WorkflowGraph = {
  workflow: "nightly-research",
  nodes: [
    { id: "gather", kind: "agent.run", label: "gather", agent: "researcher", tool: null, input: "${input}" },
    { id: "summarise", kind: "agent.run", label: "summarise", agent: "greeter", tool: null, input: "${steps.gather.output}" },
    { id: "save-results", kind: "tool.call", label: "save-results", agent: null, tool: "fs-write", input: "${steps.summarise.output}" },
  ],
  edges: [
    { source: "gather", target: "summarise" },
    { source: "summarise", target: "save-results" },
  ],
};

const disconnected: WorkflowGraph = {
  workflow: "build-report",
  nodes: [
    { id: "collect", kind: "agent.run", label: "collect", agent: "researcher", tool: null, input: null },
    { id: "render", kind: "tool.call", label: "render", agent: null, tool: "fs-write", input: null },
  ],
  edges: [],
};

describe("workflowToFlow", () => {
  it("lays out a chain left-to-right by dependency depth", () => {
    const { nodes, edges } = workflowToFlow(nightly);
    expect(nodes.map((n) => n.position.x)).toEqual([0, 220, 440]);
    expect(nodes[0].data.kind).toBe("agent.run");
    expect(nodes[2].data.tool).toBe("fs-write");
    expect(edges).toHaveLength(2);
    expect(edges[0].id).toBe("gather->summarise");
  });

  it("stacks disconnected nodes at depth 0", () => {
    const { nodes, edges } = workflowToFlow(disconnected);
    expect(nodes.every((n) => n.position.x === 0)).toBe(true);
    expect(nodes.map((n) => n.position.y)).toEqual([0, 70]);
    expect(edges).toHaveLength(0);
  });
});
