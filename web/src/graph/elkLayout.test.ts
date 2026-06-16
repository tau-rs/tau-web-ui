import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { elkLayout } from "./elkLayout";

const fakeElk = {
  layout: async (g: { children: { id: string }[] }) => ({
    children: g.children.map((c, i) => ({ id: c.id, x: i * 200, y: 0 })),
  }),
};

describe("elkLayout", () => {
  it("maps ELK-assigned positions back onto the nodes", async () => {
    const nodes = [
      { id: "a", type: "step", position: { x: 0, y: 0 }, data: {} },
      { id: "b", type: "step", position: { x: 0, y: 0 }, data: {} },
    ] as unknown as Node[];
    const edges = [{ id: "a->b", source: "a", target: "b" }] as unknown as Edge[];
    const out = await elkLayout(nodes, edges, fakeElk);
    expect(out.find((n) => n.id === "a")!.position.x).toBe(0);
    expect(out.find((n) => n.id === "b")!.position.x).toBe(200);
  });

  it("preserves a node's prior position when ELK returns none", async () => {
    const elk = { layout: async () => ({ children: [] }) };
    const nodes = [
      { id: "a", type: "step", position: { x: 9, y: 9 }, data: {} },
    ] as unknown as Node[];
    const out = await elkLayout(nodes, [], elk);
    expect(out[0].position).toEqual({ x: 9, y: 9 });
  });
});
