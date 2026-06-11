import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Launcher } from "./Launcher";
import { useStore } from "../store/store";
import { ProjectProvider } from "../app/project-context";

beforeEach(() => {
  useStore.setState({
    project: { project_path: "/p", agents: ["greeter"], tau_version: "x" },
    workflows: ["nightly-research"],
  });
});

describe("Launcher", () => {
  it("switches to Workflow mode and calls launchWorkflow", async () => {
    const launchWorkflow = vi.fn().mockResolvedValue("R1");
    useStore.setState({ launchWorkflow });
    render(
      <ProjectProvider pid="demo">
        <MemoryRouter>
          <Launcher />
        </MemoryRouter>
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Workflow" }));
    expect(screen.getByRole("option", { name: "nightly-research" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("prompt"), { target: { value: "q3" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(launchWorkflow).toHaveBeenCalledWith("demo", "nightly-research", "q3");
  });
});
