import { describe, it, expect } from "vitest";
import type { Span } from "../types/Span";
import { buildAgentMap, agentSummary, ROOT_AGENT_ID } from "./agentMap";

function span(p: Partial<Span> & Pick<Span, "id" | "kind">): Span {
  return {
    parent_id: null,
    run_id: "R",
    name: p.id,
    status: "ok",
    started_at: "t",
    ended_at: null,
    attributes: {},
    ...p,
  } as Span;
}

// turn → [fs-read(tool), summarizer(agent), factcheck(agent)]
const spans: Span[] = [
  span({ id: "turn", kind: "turn", attributes: { usage: { total_tokens: 62 } } }),
  span({ id: "c1", kind: "tool_call", parent_id: "turn", name: "fs-read" }),
  span({
    id: "sp1",
    kind: "agent",
    parent_id: "turn",
    name: "agent.summarizer.spawn",
    attributes: { result: { usage: { total_tokens: 180 } } },
  }),
  span({
    id: "sp2",
    kind: "agent",
    parent_id: "turn",
    name: "agent.factcheck.spawn",
    status: "running",
  }),
];

describe("buildAgentMap", () => {
  it("builds a root + one node per spawned agent, with spawn edges", () => {
    const { agents, edges } = buildAgentMap(spans, "researcher", "running");
    const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
    expect(byId[ROOT_AGENT_ID].name).toBe("researcher");
    expect(byId[ROOT_AGENT_ID].parentAgentId).toBeNull();
    expect(byId[ROOT_AGENT_ID].toolCount).toBe(1); // owns fs-read
    expect(byId[ROOT_AGENT_ID].tokens).toBe(62); // the turn's usage
    expect(byId["sp1"].name).toBe("summarizer");
    expect(byId["sp1"].parentAgentId).toBe(ROOT_AGENT_ID);
    expect(byId["sp1"].depth).toBe(1);
    expect(byId["sp1"].tokens).toBe(180);
    expect(byId["sp2"].name).toBe("factcheck");
    expect(byId["sp2"].status).toBe("running");
    expect(byId["sp2"].tokens).toBeNull(); // no usage
    expect(edges).toEqual([
      { source: ROOT_AGENT_ID, target: "sp1" },
      { source: ROOT_AGENT_ID, target: "sp2" },
    ]);
  });

  it("nests a spawn under another spawn (general over depth)", () => {
    const nested: Span[] = [
      span({ id: "a", kind: "agent", name: "agent.outer.spawn" }),
      span({ id: "b", kind: "agent", parent_id: "a", name: "agent.inner.spawn" }),
      span({ id: "t", kind: "tool_call", parent_id: "b", name: "x" }),
    ];
    const { agents } = buildAgentMap(nested, "root", "ok");
    const byId = Object.fromEntries(agents.map((x) => [x.id, x]));
    expect(byId["a"].parentAgentId).toBe(ROOT_AGENT_ID);
    expect(byId["b"].parentAgentId).toBe("a"); // nearest agent ancestor
    expect(byId["b"].depth).toBe(2);
    expect(byId["b"].toolCount).toBe(1); // owns tool t
  });

  it("agentSummary returns depth + direct sub-agent count for an agent span", () => {
    const s = agentSummary(spans, "sp1");
    expect(s).toEqual({ depth: 1, children: 0 });
    const nested = agentSummary(
      [
        span({ id: "a", kind: "agent", name: "agent.a.spawn" }),
        span({ id: "b", kind: "agent", parent_id: "a", name: "agent.b.spawn" }),
        span({ id: "c", kind: "agent", parent_id: "a", name: "agent.c.spawn" }),
      ],
      "a",
    );
    expect(nested).toEqual({ depth: 1, children: 2 });
  });
});
