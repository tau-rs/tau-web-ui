import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LogStream } from "./LogStream";
import type { LogEntry } from "./types";

const entries: LogEntry[] = [
  { id: "1", ts: "t1", level: "info", source: "R1", kind: "tool_started", label: "▶ fs-read" },
  { id: "2", ts: "t2", level: "error", source: "R1", kind: "fatal_error", label: "fatal: Timeout" },
  {
    id: "3",
    ts: "t3",
    level: "debug",
    source: "R1",
    kind: "text_delta",
    label: "assistant output",
  },
];

describe("LogStream", () => {
  it("renders info and error entries but hides debug by default", () => {
    render(<LogStream entries={entries} />);
    expect(screen.getByText("▶ fs-read")).toBeInTheDocument();
    expect(screen.getByText("fatal: Timeout")).toBeInTheDocument();
    expect(screen.queryByText("assistant output")).not.toBeInTheDocument();
  });

  it("filters by full-text query", () => {
    render(<LogStream entries={entries} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "fatal" } });
    expect(screen.queryByText("▶ fs-read")).not.toBeInTheDocument();
    expect(screen.getByText("fatal: Timeout")).toBeInTheDocument();
  });

  it("toggles a level filter off", () => {
    render(<LogStream entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: /error/i }));
    expect(screen.queryByText("fatal: Timeout")).not.toBeInTheDocument();
  });

  it("calls onEntryClick when a row is clicked", () => {
    const onEntryClick = vi.fn();
    render(<LogStream entries={entries} onEntryClick={onEntryClick} />);
    fireEvent.click(screen.getByText("▶ fs-read"));
    expect(onEntryClick).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
  });

  it("shows an empty state when nothing matches", () => {
    render(<LogStream entries={[]} />);
    expect(screen.getByText(/no log entries/i)).toBeInTheDocument();
  });
});
