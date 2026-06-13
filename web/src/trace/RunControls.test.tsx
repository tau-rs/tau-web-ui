import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunControls } from "./RunControls";
import { ProjectProvider } from "../app/project-context";
import { useStore } from "../store/store";

const failedRun = {
  id: "R1",
  agent_id: "greeter",
  prompt: "hi",
  substrate: "host" as const,
  mode: "dev" as const,
  status: "failed" as const,
  started_at: "t",
  ended_at: "t2",
  total_turns: 1,
  token_usage: null,
  stop_reason: null,
  error: { kind: "FatalError", detail: "tool timed out after 30s" },
  source: "serve" as const,
};

describe("RunControls failure detail", () => {
  beforeEach(() => {
    useStore.setState({ currentTrace: { run: failedRun, spans: [], events: [] } });
  });
  it("shows the error kind and detail prominently when the run failed", () => {
    render(
      <MemoryRouter>
        <ProjectProvider pid="demo">
          <RunControls />
        </ProjectProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText(/FatalError/)).toBeInTheDocument();
    expect(screen.getByText(/tool timed out after 30s/)).toBeInTheDocument();
  });
});
