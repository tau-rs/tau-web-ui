import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ currentTrace: null, runs: [] }));

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("routing", () => {
  it("renders the Runs page at /runs", () => {
    at("/runs");
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });

  it("renders the Dashboard at /dashboard", () => {
    at("/dashboard");
    expect(screen.getByText(/success rate/i)).toBeInTheDocument();
  });

  it("renders stub pages for the new Build/Operate surfaces", () => {
    at("/agents");
    expect(screen.getByText(/author agents/i)).toBeInTheDocument();
  });

  it("renders the Workflows stub as gated", () => {
    at("/workflows");
    expect(screen.getByText(/waits on tau/i)).toBeInTheDocument();
  });

  it("renders the Packages page", () => {
    at("/packages");
    expect(screen.getByRole("heading", { name: /packages/i })).toBeInTheDocument();
  });

  it("renders the Ship stub", () => {
    at("/ship");
    expect(screen.getByText(/targets, build/i)).toBeInTheDocument();
  });

  it("redirects unknown paths to /runs", () => {
    at("/nope");
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });
});
