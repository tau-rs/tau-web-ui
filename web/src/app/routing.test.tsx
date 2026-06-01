import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { useStore } from "../store/store";

beforeEach(() =>
  useStore.setState({
    currentTrace: null,
    runs: [],
    projects: [
      { meta: { id: "demo", name: "demo", path: "/p", source: { kind: "local" } }, summary: {} } as never,
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
    expect(screen.getByText(/projects home/i)).toBeInTheDocument();
  });

  it("renders the Runs page at /projects/demo/runs", () => {
    at("/projects/demo/runs");
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });

  it("renders the Dashboard at /projects/demo/dashboard", () => {
    at("/projects/demo/dashboard");
    expect(screen.getByText(/success rate/i)).toBeInTheDocument();
  });

  it("renders stub pages for the new Build/Operate surfaces", () => {
    at("/projects/demo/agents");
    expect(screen.getByText(/author agents/i)).toBeInTheDocument();
  });

  it("renders the Workflows stub as gated", () => {
    at("/projects/demo/workflows");
    expect(screen.getByText(/waits on tau/i)).toBeInTheDocument();
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
    expect(screen.getByText(/projects home/i)).toBeInTheDocument();
  });
});
