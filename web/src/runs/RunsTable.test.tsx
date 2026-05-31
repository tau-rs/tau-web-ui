import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunsTable } from "./RunsTable";
import type { Run } from "../types/Run";

const run: Run = {
  id: "R1",
  agent_id: "greeter",
  prompt: "hi",
  substrate: "host",
  mode: "dev",
  status: "completed",
  started_at: "2026-05-31T00:00:00Z",
  ended_at: "2026-05-31T00:00:02Z",
  total_turns: 1,
  token_usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
  stop_reason: "end_turn",
  error: null,
  source: "serve",
};

describe("RunsTable", () => {
  it("renders a row and fires onOpen on click", () => {
    const onOpen = vi.fn();
    render(<RunsTable runs={[run]} onOpen={onOpen} />);
    expect(screen.getByText("greeter")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("host · dev")).toBeInTheDocument();
    fireEvent.click(screen.getByText("greeter"));
    expect(onOpen).toHaveBeenCalledWith("R1");
  });

  it("shows an empty state when no runs", () => {
    render(<RunsTable runs={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
  });
});
