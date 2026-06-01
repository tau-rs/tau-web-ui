import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useStore } from "../store/store";

function renderAt(pid = "demo") {
  render(
    <MemoryRouter initialEntries={[`/projects/${pid}/runs`]}>
      <Routes>
        <Route path="/projects/:pid/*" element={<Navbar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Navbar", () => {
  it("shows the project path and tau version", () => {
    useStore.setState({
      project: { project_path: "/p/demo", agents: ["greeter"], tau_version: "0.0.0-mock" },
      projects: [],
    });
    renderAt();
    expect(screen.getByText(/\/p\/demo/)).toBeInTheDocument();
    expect(screen.getByText(/0\.0\.0-mock/)).toBeInTheDocument();
  });
});
