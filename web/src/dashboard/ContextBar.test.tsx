import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextBar } from "./ContextBar";

describe("ContextBar", () => {
  it("shows WIP when no context data", () => {
    render(<ContextBar />);
    expect(screen.getByText(/wip/i)).toBeInTheDocument();
  });
  it("shows a percentage when context is present", () => {
    render(<ContextBar context={{ pct: 0.62 }} />);
    expect(screen.getByText("62%")).toBeInTheDocument();
  });
});
