import { describe, it, expect } from "vitest";
import { spansToFlow } from "./layout";
import type { Span } from "../types/Span";

function span(id: string, parent: string | null, kind: Span["kind"], status: Span["status"]): Span {
  return {
    id,
    parent_id: parent,
    run_id: "R1",
    kind,
    name: id,
    status,
    started_at: "t",
    ended_at: null,
    attributes: {},
  };
}

describe("spansToFlow", () => {
  it("builds nodes + parent edges and depth-based x", () => {
    const spans = [
      span("t1", null, "turn", "ok"),
      span("tool1", "t1", "tool_call", "ok"),
      span("ag1", "t1", "agent", "running"),
      span("sub1", "ag1", "tool_call", "running"),
    ];
    const { nodes, edges } = spansToFlow(spans);
    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(3); // t1->tool1, t1->ag1, ag1->sub1
    const sub = nodes.find((n) => n.id === "sub1")!;
    const turn = nodes.find((n) => n.id === "t1")!;
    expect(sub.position.x).toBeGreaterThan(turn.position.x);
  });

  it("colors nodes by status", () => {
    const { nodes } = spansToFlow([span("t1", null, "turn", "error")]);
    expect(nodes[0].data.status).toBe("error");
  });

  it("tolerates orphan parent ids (missing parent) without dropping the node", () => {
    const { nodes, edges } = spansToFlow([span("x", "ghost", "tool_call", "ok")]);
    expect(nodes).toHaveLength(1);
    expect(edges).toHaveLength(0); // edge skipped because parent absent
  });
});
