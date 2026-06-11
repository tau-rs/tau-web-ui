import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { AgentEditorPage } from "./AgentEditorPage";
import { ProjectProvider } from "../app/project-context";

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="loc">{pathname}</div>;
}

function renderAt(path: string) {
  render(
    <ProjectProvider pid="demo">
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/projects/:pid/agents/new"
            element={
              <>
                <AgentEditorPage />
                <Probe />
              </>
            }
          />
          <Route
            path="/projects/:pid/agents/:agentId"
            element={
              <>
                <AgentEditorPage />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </ProjectProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AgentEditorPage", () => {
  it("create mode PUTs a new agent with ?create=1", async () => {
    const f = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => (url.includes("/providers") ? [] : {}),
        text: async () => String(init?.body ?? ""),
      }),
    );
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderAt("/projects/demo/agents/new");

    await user.type(screen.getByLabelText("agent id"), "writer");
    await user.type(screen.getByLabelText("display name"), "Writer");
    await user.type(screen.getByLabelText("system prompt"), "you are a writer");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const putCall = () => f.mock.calls.find((c) => String(c[0]).includes("/agents/writer"));
    await waitFor(() => expect(putCall()).toBeTruthy());
    const put = putCall()!;
    expect(put[0]).toBe("/api/projects/demo/agents/writer?create=1");
    const body = JSON.parse(String(put[1]?.body));
    expect(body.id).toBe("writer");
    expect(body.display_name).toBe("Writer");
    expect(body.prompt.system).toBe("you are a writer");
  });

  it("edit mode loads the agent then saves without ?create", async () => {
    const existing = {
      id: "greeter",
      display_name: "Greeter",
      package: null,
      llm_backend: "anthropic",
      prompt: { system: "hello", system_file: null },
      requires_tools: [],
    };
    const f = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: async () => (url.includes("/providers") ? [] : existing),
        text: async () => String(init?.body ?? ""),
      }),
    );
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderAt("/projects/demo/agents/greeter");

    await waitFor(() => expect(screen.getByLabelText("display name")).toHaveValue("Greeter"));
    expect(screen.getByLabelText("agent id")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    const putCall = () =>
      f.mock.calls.find((c) => String(c[0]).includes("/agents/greeter") && c[1]?.method === "PUT");
    await waitFor(() => expect(putCall()).toBeTruthy());
    expect(putCall()![0]).toBe("/api/projects/demo/agents/greeter");
  });

  it("rejects an invalid id in create mode", async () => {
    const f = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => (url.includes("/providers") ? [] : {}),
      }),
    );
    vi.stubGlobal("fetch", f);
    const user = userEvent.setup();
    renderAt("/projects/demo/agents/new");
    await user.type(screen.getByLabelText("agent id"), "bad id!");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(screen.getByText(/invalid id/i)).toBeInTheDocument();
    // the only network call is the provider list load; no save was attempted
    expect(f.mock.calls.some((c) => /\/agents\//.test(String(c[0])))).toBe(false);
  });
});
