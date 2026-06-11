import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SkillsIndex } from "./SkillsIndex";
import { ProjectProvider } from "../app/project-context";

const skills = [
  {
    name: "critic",
    version: "0.1.0",
    source: "local://critic",
    editable: true,
    capability_kinds: [],
    requires_count: 1,
  },
  {
    name: "web-search",
    version: "1.2.0",
    source: "github.com/tau/web-search",
    editable: false,
    capability_kinds: ["net.http"],
    requires_count: 0,
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => skills }));
});

function renderAt() {
  render(
    <ProjectProvider pid="demo">
      <MemoryRouter initialEntries={["/projects/demo/tools"]}>
        <Routes>
          <Route path="/projects/:pid/tools" element={<SkillsIndex />} />
        </Routes>
      </MemoryRouter>
    </ProjectProvider>,
  );
}

describe("SkillsIndex", () => {
  it("lists local + installed skills with links + New", async () => {
    renderAt();
    await waitFor(() => expect(screen.getByRole("link", { name: "critic" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "critic" })).toHaveAttribute(
      "href",
      "/projects/demo/tools/skills/critic",
    );
    expect(screen.getByText("web-search")).toBeInTheDocument();
    expect(screen.getByText("installed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new skill/i })).toHaveAttribute(
      "href",
      "/projects/demo/tools/skills/new",
    );
  });
});
