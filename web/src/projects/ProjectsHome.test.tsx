import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectsHome } from "./ProjectsHome";
import { useStore } from "../store/store";

function summary() {
  return {
    runs: 3,
    running: 0,
    failed_24h: 0,
    success_rate: 1,
    tokens: 0,
    last_activity: null,
    agents: 1,
    engine_ok: true,
  };
}

beforeEach(() => {
  useStore.setState({
    projects: [
      {
        meta: { id: "workspace", name: "workspace", path: "/w", source: { kind: "workspace" } },
        summary: summary(),
      },
      {
        meta: { id: "demo", name: "demo", path: "/p/demo", source: { kind: "local" } },
        summary: summary(),
      },
    ] as never,
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

describe("ProjectsHome", () => {
  it("renders the Unsaved card + real project cards + global summary", () => {
    render(
      <MemoryRouter>
        <ProjectsHome />
      </MemoryRouter>,
    );
    expect(screen.getByText(/working environment/i)).toBeInTheDocument();
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(screen.getByText("demo")).toBeInTheDocument();
    expect(screen.getByLabelText("project path")).toBeInTheDocument();
    // The workspace renders as the Unsaved card, NOT as a normal ProjectCard
    // (there must be no card titled "workspace").
    expect(screen.queryByText("workspace")).not.toBeInTheDocument();
  });
});
