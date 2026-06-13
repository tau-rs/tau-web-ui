import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TraceView } from "./TraceView";
import { ProjectProvider } from "../app/project-context";
import { useStore } from "../store/store";

vi.mock("./AgentMapView", () => ({ AgentMap: () => null }));

function seed() {
  useStore.setState({
    currentTrace: {
      run: {
        id: "R1",
        agent_id: "greeter",
        prompt: "hi",
        substrate: "host",
        mode: "dev",
        status: "completed",
        started_at: "t",
        ended_at: "t2",
        total_turns: 1,
        token_usage: null,
        stop_reason: null,
        error: null,
        source: "serve",
      },
      spans: [],
      events: [
        {
          run_id: "R1",
          span_id: "s1",
          ts: "t1",
          kind: "tool_started",
          payload: { tool: "fs-read" },
        },
      ],
    },
    selectedSpanId: null,
  });
}

describe("TraceView Logs tab", () => {
  beforeEach(seed);
  it("shows the event stream when the Logs tab is selected", () => {
    render(
      <MemoryRouter>
        <ProjectProvider pid="demo">
          <TraceView />
        </ProjectProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Logs" }));
    expect(screen.getByText("▶ fs-read")).toBeInTheDocument();
  });
});
