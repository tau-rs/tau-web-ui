import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ runs: [], activeProjectId: "demo" }));

function renderSidebar() {
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("always shows a Projects item linking to /", () => {
    renderSidebar();
    expect(screen.getByRole("link", { name: /projects/i })).toHaveAttribute("href", "/");
  });

  it("renders surface links scoped to the active project", () => {
    renderSidebar();
    const expected: [RegExp, string][] = [
      [/dashboard/i, "/projects/demo/dashboard"],
      [/agents/i, "/projects/demo/agents"],
      [/packages/i, "/projects/demo/packages"],
      [/runs/i, "/projects/demo/runs"],
      [/health/i, "/projects/demo/health"],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("greys (disables) the scoped groups when no project is active", () => {
    useStore.setState({ runs: [], activeProjectId: "" });
    renderSidebar();
    expect(screen.getByRole("link", { name: /projects/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the running badge inside a project", () => {
    useStore.setState({
      runs: [{ id: "a", status: "running" } as never],
      activeProjectId: "demo",
    });
    renderSidebar();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
