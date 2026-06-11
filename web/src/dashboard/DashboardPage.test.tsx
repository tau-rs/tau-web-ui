import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardPage } from "./DashboardPage";
import { useStore } from "../store/store";
import { ProjectProvider } from "../app/project-context";
import type { Run } from "../types/Run";

function run(p: Partial<Run>): Run {
  return {
    id: "x",
    agent_id: "greeter",
    prompt: "p",
    substrate: "host",
    mode: "dev",
    status: "completed",
    started_at: "2026-05-31T00:00:00.000Z",
    ended_at: "2026-05-31T00:00:01.000Z",
    total_turns: 1,
    token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    stop_reason: "end_turn",
    error: null,
    source: "serve",
    ...p,
  };
}

beforeEach(() =>
  useStore.setState({
    runs: [run({ id: "a" }), run({ id: "b", agent_id: "researcher" })],
    runsLoaded: true,
    runsError: null,
  }),
);

describe("DashboardPage", () => {
  it("renders headline stats, an agent row, and the context WIP marker", () => {
    render(
      <ProjectProvider pid="demo">
        <DashboardPage />
      </ProjectProvider>,
    );
    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("researcher")).toBeInTheDocument();
    expect(screen.getAllByText(/wip/i).length).toBeGreaterThan(0);
  });

  it("shows a loading skeleton before the first runs load (distinct from empty)", () => {
    useStore.setState({ runs: [], runsLoaded: false, runsError: null });
    render(
      <ProjectProvider pid="demo">
        <DashboardPage />
      </ProjectProvider>,
    );
    expect(screen.getByTestId("dashboard-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
  });

  it("shows an empty hint when loaded with zero runs", () => {
    useStore.setState({ runs: [], runsLoaded: true, runsError: null });
    render(
      <ProjectProvider pid="demo">
        <DashboardPage />
      </ProjectProvider>,
    );
    expect(screen.getByText(/no runs yet — launch/i)).toBeInTheDocument();
  });

  it("shows an outage banner with the reason when the first load failed (not the empty hint)", () => {
    useStore.setState({ runs: [], runsLoaded: true, runsError: "500: gateway down" });
    render(
      <ProjectProvider pid="demo">
        <DashboardPage />
      </ProjectProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/500: gateway down/);
    expect(screen.queryByText(/no runs yet — launch/i)).not.toBeInTheDocument();
  });
});
