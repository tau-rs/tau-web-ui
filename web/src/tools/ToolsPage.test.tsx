import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ToolsPage } from "./ToolsPage";
import { ProjectProvider } from "../app/project-context";

beforeEach(() => {
  // SkillsIndex wants an array; ToolsTab/PluginsTab want their envelopes.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          url.endsWith("/skills")
            ? []
            : url.endsWith("/tools")
              ? { tools: [], error_count: 0 }
              : { plugins: [], errors: [] },
      }),
    ),
  );
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
  it("switches Skills → Tools → Plugins (no longer gated)", async () => {
    const user = userEvent.setup();
    renderAt();
    // Skills tab shows the import-skill control
    expect(screen.getByLabelText("import skill git url")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^tools$/i }));
    // Tools tab shows the tools table header "provides"
    expect(screen.getByText("provides")).toBeInTheDocument();
    expect(screen.queryByLabelText("import skill git url")).not.toBeInTheDocument();

    // Plugins is a real tab now: empty envelope → "No plugins.", and no gated badge.
    await user.click(screen.getByRole("button", { name: /plugins/i }));
    expect(screen.getByText(/no plugins/i)).toBeInTheDocument();
    expect(screen.queryByText(/gated/i)).toBeNull();
  });
});
