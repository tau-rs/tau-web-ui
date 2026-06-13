import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { useStore } from "../store/store";

// React Flow needs real layout (jsdom can't) — mock the canvas so the
// /workflows route can mount in this routing smoke test.
vi.mock("../graph/GraphCanvas", () => ({ GraphCanvas: () => <div data-testid="canvas" /> }));

beforeEach(() =>
  useStore.setState({
    currentTrace: null,
    runs: [],
    runsLoaded: true,
    projects: [
      {
        meta: { id: "demo", name: "demo", path: "/p", source: { kind: "local" } },
        summary: {},
      } as never,
    ],
  }),
);

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("routing", () => {
  it("renders the Projects home at /", () => {
    at("/");
    expect(screen.getByRole("heading", { name: /^projects$/i })).toBeInTheDocument();
  });

  it("renders the Runs page at /projects/demo/runs", () => {
    at("/projects/demo/runs");
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });

  it("renders the Dashboard at /projects/demo/dashboard", () => {
    at("/projects/demo/dashboard");
    expect(screen.getByText(/success rate/i)).toBeInTheDocument();
  });

  it("renders the Agents index page at /projects/demo/agents", () => {
    at("/projects/demo/agents");
    expect(screen.getByRole("heading", { name: /^agents$/i })).toBeInTheDocument();
  });

  it("renders the Workflows graph editor as gated", () => {
    at("/projects/demo/workflows");
    expect(screen.getByRole("heading", { name: /workflows \/ graph/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^build$/i })).not.toBeDisabled();
  });

  it("renders the Packages page", () => {
    at("/projects/demo/packages");
    expect(screen.getByRole("heading", { name: /packages/i })).toBeInTheDocument();
  });

  it("shows not-found for an unknown project id", () => {
    at("/projects/ghost/runs");
    expect(screen.getByText(/project not found/i)).toBeInTheDocument();
  });

  it("redirects unknown top-level paths to the home", () => {
    at("/nope");
    expect(screen.getByRole("heading", { name: /^projects$/i })).toBeInTheDocument();
  });
});
