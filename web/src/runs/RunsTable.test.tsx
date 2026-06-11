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

  it("exposes each row as a focusable button", () => {
    render(<RunsTable runs={[run]} onOpen={() => {}} />);
    const row = screen.getByRole("button", { name: /open run greeter/i });
    expect(row).toHaveAttribute("tabindex", "0");
  });

  it("fires onOpen when a focused row is activated with Enter or Space", () => {
    const onOpen = vi.fn();
    render(<RunsTable runs={[run]} onOpen={onOpen} />);
    const row = screen.getByRole("button", { name: /open run greeter/i });
    // fireEvent returns false when a handler called preventDefault — Space must
    // preventDefault so activating a focused row never scrolls the page.
    expect(fireEvent.keyDown(row, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(row, { key: " " })).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith("R1");
  });

  it("shows an empty state when no runs", () => {
    render(<RunsTable runs={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
  });
});
