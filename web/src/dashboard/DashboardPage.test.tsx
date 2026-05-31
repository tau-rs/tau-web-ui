import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";
import { useStore } from "../store/store";
import type { Run } from "../types/Run";

function run(p: Partial<Run>): Run {
  return {
    id: "x",
    agent_id: "greeter",
    prompt: "p",
    substrate: "host",
    mode: "dev",
    status: "completed",
    started_at: "2026-05-31T00:00:00.000Z",
    ended_at: "2026-05-31T00:00:01.000Z",
    total_turns: 1,
    token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    stop_reason: "end_turn",
    error: null,
    source: "serve",
    ...p,
  };
}

beforeEach(() =>
  useStore.setState({ runs: [run({ id: "a" }), run({ id: "b", agent_id: "researcher" })] }),
);

describe("DashboardPage", () => {
  it("renders headline stats, an agent row, and the context WIP marker", () => {
    render(<DashboardPage />);
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("researcher")).toBeInTheDocument();
    expect(screen.getAllByText(/wip/i).length).toBeGreaterThan(0);
  });
});
