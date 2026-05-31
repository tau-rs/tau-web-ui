import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunsView } from "./RunsView";
import { useStore } from "../store/store";
import type { Run } from "../types/Run";

function run(id: string, source: Run["source"], agent: string): Run {
  return {
    id,
    agent_id: agent,
    prompt: "p",
    substrate: "host",
    mode: "dev",
    status: "completed",
    started_at: "2026-05-31T00:00:00Z",
    ended_at: "2026-05-31T00:00:01Z",
    total_turns: 1,
    token_usage: null,
    stop_reason: "end_turn",
    error: null,
    source,
  };
}

describe("RunsView filter", () => {
  it("filters to workflows / agents", () => {
    useStore.setState({
      runs: [run("a", "serve", "greeter"), run("b", "log", "nightly-research")],
    });
    render(
      <MemoryRouter>
        <RunsView />
      </MemoryRouter>,
    );
    expect(screen.getByText("greeter")).toBeInTheDocument();
    expect(screen.getByText("nightly-research")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Workflows" }));
    expect(screen.queryByText("greeter")).toBeNull();
    expect(screen.getByText("nightly-research")).toBeInTheDocument();
  });
});
