import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useStore } from "../store/store";

describe("Navbar", () => {
  it("shows the project path and tau version", () => {
    useStore.setState({
      project: { project_path: "/p/demo", agents: ["greeter"], tau_version: "0.0.0-mock" },
    });
    render(
      <MemoryRouter initialEntries={["/runs"]}>
        <Navbar />
      </MemoryRouter>,
    );
    expect(screen.getByText(/\/p\/demo/)).toBeInTheDocument();
    expect(screen.getByText(/0\.0\.0-mock/)).toBeInTheDocument();
  });
});
