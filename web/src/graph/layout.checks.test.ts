import { describe, it, expect } from "vitest";
import { projectChecks, applyChecksSelection } from "./layout";
import type { Node, Edge } from "@xyflow/react";
import type { StepNodeData } from "./layout";
import {
  RESEARCH_CHECKS,
  RESEARCH_BUILD,
  PRODUCER_OF,
  RUN_RETRY_MET,
} from "../api/fixtures/postconditions";

const baseNodes = (): Node<StepNodeData>[] => [
  {
    id: "gather",
    type: "step",
    position: { x: 0, y: 0 },
    data: {
      label: "gather",
      kind: "agent.run",
      agent: "gather",
      tool: null,
      input: null,
      provider: "anthropic",
      tools: [],
    },
  },
  {
    id: "writer",
    type: "step",
    position: { x: 220, y: 0 },
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
];

describe("projectChecks", () => {
  it("adds a check node for the deliverable, a goal badge on its producer, and a rewind edge", () => {
    const { nodes, edges } = projectChecks(
      baseNodes(),
      [],
      {
        checks: RESEARCH_CHECKS,
        build: RESEARCH_BUILD,
        producerOf: PRODUCER_OF,
      },
      RUN_RETRY_MET,
    );
    const checkNode = nodes.find((n) => n.id === "check-report");
    expect(checkNode?.type).toBe("check");
    expect(checkNode?.data.runStatus).toBe("met");
    expect(checkNode?.data.attemptCount).toBe(2);
    const writer = nodes.find((n) => n.id === "writer")!;
    expect(writer.data.goalBadges?.[0].id).toBe("has_sources");
    const rewind = edges.find((e) => e.type === "rewind");
    expect(rewind?.source).toBe("check-report");
    expect(rewind?.target).toBe("writer");
  });

  it("does not mutate the caller's input nodes", () => {
    const input = baseNodes();
    projectChecks(
      input,
      [],
      { checks: RESEARCH_CHECKS, build: RESEARCH_BUILD, producerOf: PRODUCER_OF },
      [],
    );
    const writer = input.find((n) => n.id === "writer")!;
    expect(writer.data.goalBadges).toBeUndefined();
  });

  it("applyChecksSelection dims rewind edges not belonging to the selected check", () => {
    const edges: Edge[] = [
      {
        id: "check-report->writer",
        source: "check-report",
        target: "writer",
        type: "rewind",
        data: { attempts: 2 },
      },
      {
        id: "check-other->x",
        source: "check-other",
        target: "x",
        type: "rewind",
        data: { attempts: 1 },
      },
    ];
    const out = applyChecksSelection(edges, "check-report");
    expect((out[0].data as { dimmed?: boolean }).dimmed).toBe(false);
    expect((out[1].data as { dimmed?: boolean }).dimmed).toBe(true);
  });
});
