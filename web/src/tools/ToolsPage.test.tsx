import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ToolsPage } from "./ToolsPage";
import { ProjectProvider } from "../app/project-context";

beforeEach(() => {
  // both SkillsIndex and ToolsTab fetch on mount — stub to empty arrays
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
});

function renderAt() {
  render(
    <ProjectProvider pid="demo">
      <MemoryRouter initialEntries={["/projects/demo/tools"]}>
        <Routes>
          <Route path="/projects/:pid/tools" element={<ToolsPage />} />
        </Routes>
      </MemoryRouter>
    </ProjectProvider>,
  );
}

describe("ToolsPage tabs", () => {
  it("switches Skills → Tools → Plugins (gated tab)", async () => {
    const user = userEvent.setup();
    renderAt();
    // Skills tab shows the import-skill control
    expect(screen.getByLabelText("import skill git url")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^tools$/i }));
    // Tools tab shows the tools table header "provides"
    expect(screen.getByText("provides")).toBeInTheDocument();
    expect(screen.queryByLabelText("import skill git url")).not.toBeInTheDocument();

    // Plugins is now a real, navigable tab → renders the gated PluginsTab
    await user.click(screen.getByRole("button", { name: /plugins/i }));
    expect(screen.getByText(/mock data/i)).toBeInTheDocument();
  });
});
