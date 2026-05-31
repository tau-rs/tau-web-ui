import { describe, it, expect } from "vitest";
import { computeMetrics } from "./metrics";
import type { Run } from "../types/Run";

const T = (s: number) => `2026-05-31T00:00:0${s}.000Z`;
function run(p: Partial<Run>): Run {
  return {
    id: "x",
    agent_id: "greeter",
    prompt: "p",
    substrate: "host",
    mode: "dev",
    status: "completed",
    started_at: T(0),
    ended_at: T(1),
    total_turns: 1,
    token_usage: null,
    stop_reason: "end_turn",
    error: null,
    source: "serve",
    ...p,
  };
}

describe("computeMetrics", () => {
  const runs: Run[] = [
    run({
      id: "a",
      agent_id: "greeter",
      status: "completed",
      started_at: T(0),
      ended_at: T(1),
      token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
    run({
      id: "b",
      agent_id: "researcher",
      status: "failed",
      started_at: T(1),
      ended_at: T(2),
      token_usage: null,
      error: { kind: "rpc:-32008", detail: "tool" },
    }),
    run({ id: "c", agent_id: "greeter", status: "running", started_at: T(2), ended_at: null }),
  ];

  it("counts, success rate, tokens, durations", () => {
    const m = computeMetrics(runs, T(2));
    expect(m.total).toBe(3);
    expect(m.byStatus).toEqual({ running: 1, completed: 1, failed: 1, cancelled: 0 });
    expect(m.successRate).toBeCloseTo(0.5, 5);
    expect(m.tokens).toEqual({ input: 10, output: 5, total: 15 });
    expect(m.durations).toEqual({ p50: 1000, p90: 1000, p99: 1000 });
  });

  it("per-agent rollup sorted by runs desc", () => {
    const m = computeMetrics(runs, T(2));
    expect(m.byAgent[0].agent).toBe("greeter");
    expect(m.byAgent[0].runs).toBe(2);
    expect(m.byAgent[0].successRate).toBe(1);
    expect(m.byAgent.find((a) => a.agent === "researcher")!.successRate).toBe(0);
  });

  it("top errors group failed runs", () => {
    const m = computeMetrics(runs, T(2));
    expect(m.topErrors).toEqual([{ reason: "rpc:-32008", count: 1 }]);
  });

  it("over-time has `buckets` entries summing to the in-window count", () => {
    const m = computeMetrics(runs, T(2), 6);
    expect(m.overTime).toHaveLength(6);
    expect(m.overTime.reduce((s, b) => s + b.count, 0)).toBe(3);
  });

  it("empty input is safe", () => {
    const m = computeMetrics([], T(2));
    expect(m.total).toBe(0);
    expect(m.successRate).toBeNull();
    expect(m.durations).toBeNull();
  });

  it("counts by kind (workflow vs agent)", () => {
    const m = computeMetrics(runs, T(2));
    expect(m.byKind).toEqual({ workflow: 0, agent: 3 });
  });
});
