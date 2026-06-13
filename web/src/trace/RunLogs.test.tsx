import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunLogs } from "./RunLogs";
import type { Event } from "../types/Event";

const events: Event[] = [
  { run_id: "R1", span_id: "s1", ts: "t1", kind: "tool_started", payload: { tool: "fs-read" } },
  { run_id: "R1", span_id: null, ts: "t2", kind: "fatal_error", payload: { variant: "Timeout" } },
];

describe("RunLogs", () => {
  it("renders mapped event entries", () => {
    render(<RunLogs events={events} />);
    expect(screen.getByText("▶ fs-read")).toBeInTheDocument();
    expect(screen.getByText("fatal: Timeout")).toBeInTheDocument();
  });

  it("renders empty state with no events", () => {
    render(<RunLogs events={[]} />);
    expect(screen.getByText(/no log entries/i)).toBeInTheDocument();
  });
});
