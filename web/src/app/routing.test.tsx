import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ currentTrace: null }));

describe("routing", () => {
  it("renders the Runs page at /runs", () => {
    render(
      <MemoryRouter initialEntries={["/runs"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });

  it("renders the Dashboard stub at /dashboard", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("redirects unknown paths to /runs", () => {
    render(
      <MemoryRouter initialEntries={["/nope"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });
});
