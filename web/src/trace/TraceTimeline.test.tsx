import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TraceTimeline } from "./TraceTimeline";
import { useStore } from "../store/store";
import type { Span } from "../types/Span";

function span(id: string, parent: string | null): Span {
  return {
    id,
    parent_id: parent,
    run_id: "R1",
    kind: "tool_call",
    name: id,
    status: "ok",
    started_at: "2026-05-31T00:00:00.000Z",
    ended_at: "2026-05-31T00:00:01.000Z",
    attributes: {},
  };
}

beforeEach(() => useStore.setState({ selectedSpanId: null }));

describe("TraceTimeline", () => {
  it("renders a row per span and selects on click", () => {
    render(<TraceTimeline spans={[span("turn1", null), span("fs-read", "turn1")]} />);
    expect(screen.getByText("turn1")).toBeInTheDocument();
    const row = screen.getByText("fs-read");
    fireEvent.click(row);
    expect(useStore.getState().selectedSpanId).toBe("fs-read");
  });

  it("exposes each row as a focusable button that selects on Enter and Space", () => {
    render(<TraceTimeline spans={[span("turn1", null), span("fs-read", "turn1")]} />);
    const leaf = screen.getByRole("button", { name: /select span fs-read/i });
    expect(leaf).toHaveAttribute("tabindex", "0");

    // fireEvent returns false when a handler called preventDefault — Space must
    // preventDefault so activating a focused row never scrolls the page.
    expect(fireEvent.keyDown(leaf, { key: "Enter" })).toBe(false);
    expect(useStore.getState().selectedSpanId).toBe("fs-read");

    const other = screen.getByRole("button", { name: /select span turn1/i });
    expect(fireEvent.keyDown(other, { key: " " })).toBe(false);
    expect(useStore.getState().selectedSpanId).toBe("turn1");
  });
});
