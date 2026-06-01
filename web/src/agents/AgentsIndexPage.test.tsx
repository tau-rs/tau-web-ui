import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AgentsIndexPage } from "./AgentsIndexPage";

const agents = [
  {
    id: "greeter",
    display_name: "Greeter",
    package: null,
    llm_backend: "anthropic",
    prompt: { system: null, system_file: null },
    requires_tools: [],
  },
  {
    id: "researcher",
    display_name: "Researcher",
    package: "fs-read@^0.1",
    llm_backend: "anthropic",
    prompt: { system: "x", system_file: null },
    requires_tools: [{ name: "fs-read", source: "s", version: null }],
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => agents }));
});

function renderAt() {
  render(
    <MemoryRouter initialEntries={["/projects/demo/agents"]}>
      <Routes>
        <Route path="/projects/:pid/agents" element={<AgentsIndexPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AgentsIndexPage", () => {
  it("lists agents and links to the editor + new", async () => {
    renderAt();
    await waitFor(() => expect(screen.getByText("greeter")).toBeInTheDocument());
    expect(screen.getByText("researcher")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new agent/i })).toHaveAttribute(
      "href",
      "/projects/demo/agents/new",
    );
    expect(screen.getByRole("link", { name: "researcher" })).toHaveAttribute(
      "href",
      "/projects/demo/agents/researcher",
    );
  });
});
