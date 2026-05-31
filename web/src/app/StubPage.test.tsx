import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StubPage } from "./StubPage";

describe("StubPage", () => {
  it("renders title and subtitle", () => {
    render(<StubPage title="Agents" subtitle="Author agents — coming soon." />);
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText(/author agents/i)).toBeInTheDocument();
    expect(screen.queryByText(/gated/i)).toBeNull();
  });
  it("shows a gated badge + gate note when gated is set", () => {
    render(<StubPage title="Workflows" subtitle="x" gated="β.2" />);
    expect(screen.getByText(/gated/i)).toBeInTheDocument();
    expect(screen.getByText(/waits on tau β\.2/i)).toBeInTheDocument();
  });
});
