import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("surfaces an error and clears busy when launch rejects", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("agent not found"));
    useStore.setState({ launch });
    render(
      <ProjectProvider pid="demo">
        <MemoryRouter>
          <Launcher />
        </MemoryRouter>
      </ProjectProvider>,
    );
    fireEvent.change(screen.getByLabelText("prompt"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("agent not found")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Run" })).not.toBeDisabled());
  });

  it("surfaces an error when launchWorkflow rejects", async () => {
    const launchWorkflow = vi.fn().mockRejectedValue(new Error("workflow missing"));
    useStore.setState({ launchWorkflow });
    render(
      <ProjectProvider pid="demo">
        <MemoryRouter>
          <Launcher />
        </MemoryRouter>
      </ProjectProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Workflow" }));
    fireEvent.change(screen.getByLabelText("prompt"), { target: { value: "q3" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("workflow missing")).toBeInTheDocument();
  });
});
