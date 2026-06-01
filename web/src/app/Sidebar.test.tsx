import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ runs: [] }));

function renderAt(pid = "demo") {
  render(
    <MemoryRouter initialEntries={[`/projects/${pid}/runs`]}>
      <Routes>
        <Route path="/projects/:pid/*" element={<Sidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("renders the Build and Operate group labels", () => {
    renderAt();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Operate")).toBeInTheDocument();
  });

  it("renders all surface links scoped to the active project", () => {
    renderAt();
    const expected: [RegExp, string][] = [
      [/dashboard/i, "/projects/demo/dashboard"],
      [/agents/i, "/projects/demo/agents"],
      [/workflows/i, "/projects/demo/workflows"],
      [/tools/i, "/projects/demo/tools"],
      [/packages/i, "/projects/demo/packages"],
      [/config/i, "/projects/demo/config"],
      [/runs/i, "/projects/demo/runs"],
      [/ship/i, "/projects/demo/ship"],
      [/health/i, "/projects/demo/health"],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("badges the partially-gated areas (Workflows, Config, Ship)", () => {
    renderAt();
    expect(screen.getAllByText(/gated/i)).toHaveLength(3);
  });

  it("shows a running-count badge on Runs when runs are in flight", () => {
    useStore.setState({
      runs: [{ id: "a", status: "running" } as never, { id: "b", status: "completed" } as never],
    });
    renderAt();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
