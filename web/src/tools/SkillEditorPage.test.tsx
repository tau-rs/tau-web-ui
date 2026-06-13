import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SkillEditorPage } from "./SkillEditorPage";
import { ProjectProvider } from "../app/project-context";

function renderAt(path: string) {
  render(
    <ProjectProvider pid="demo">
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:pid/tools/skills/new" element={<SkillEditorPage />} />
          <Route path="/projects/:pid/tools/skills/:name" element={<SkillEditorPage />} />
        </Routes>
      </MemoryRouter>
    </ProjectProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SkillEditorPage", () => {
  it("create mode PUTs a new skill with ?create=1", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderAt("/projects/demo/tools/skills/new");

    await user.type(screen.getByLabelText("skill name"), "summariser");
    await user.type(screen.getByLabelText("SKILL.md body"), "you summarise");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/summariser?create=1");
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.name).toBe("summariser");
    expect(body.content).toBe("you summarise");
  });

  it("installed skill is read-only (no Save/Delete, Export present)", async () => {
    const installed = {
      name: "web-search",
      description: "Search.",
      version: "1.2.0",
      source: "github.com/tau/web-search",
      editable: false,
      content: "search",
      capabilities: [],
      requires_tools: [],
      requires_skills: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => installed }));
    renderAt("/projects/demo/tools/skills/web-search");
    await waitFor(() => expect(screen.getByLabelText("skill name")).toHaveValue("web-search"));
    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export/i })).toBeInTheDocument();
  });

  it("installed skill shows read-only capabilities and requires (B'')", async () => {
    const installed = {
      name: "web-search",
      description: "Search.",
      version: "1.2.0",
      source: "file:///tmp/web-search.git",
      editable: false,
      content: "search",
      capabilities: [{ kind: "net.http", fields: { hosts: ["api.example"] } }],
      requires_tools: [{ name: "fs-read", source: "", version: "^0.1" }],
      requires_skills: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => installed }));
    renderAt("/projects/demo/tools/skills/web-search");
    await waitFor(() => expect(screen.getByLabelText("skill name")).toHaveValue("web-search"));

    // capability + requirement shown read-only
    expect(screen.getByText(/net\.http/)).toBeInTheDocument();
    expect(screen.getByText("fs-read")).toBeInTheDocument();
    // editor affordances absent (read-only)
    expect(screen.queryByRole("button", { name: /add capability/i })).not.toBeInTheDocument();
  });

  it("rejects an invalid name in create mode", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    renderAt("/projects/demo/tools/skills/new");
    await user.type(screen.getByLabelText("skill name"), "Bad Name");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(screen.getByText(/invalid name/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
