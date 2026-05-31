import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectBar } from "./ProjectBar";
import { useStore } from "../store/store";

describe("ProjectBar", () => {
  it("shows project path and tau version from the store", () => {
    useStore.setState({
      project: { project_path: "/p/demo", agents: ["greeter"], tau_version: "0.0.0-mock" },
    });
    render(<ProjectBar />);
    expect(screen.getByText(/\/p\/demo/)).toBeInTheDocument();
    expect(screen.getByText(/0\.0\.0-mock/)).toBeInTheDocument();
  });
});
