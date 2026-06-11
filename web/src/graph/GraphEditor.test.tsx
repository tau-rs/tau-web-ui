import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GraphEditor } from "./GraphEditor";
import { ProjectProvider } from "../app/project-context";

// The React Flow canvas needs real layout (jsdom can't) — mock it out; the live
// canvas is covered by the e2e test.
vi.mock("./GraphCanvas", () => ({ GraphCanvas: () => <div data-testid="canvas" /> }));

const graph = {
  workflow: "nightly-research",
  nodes: [
    {
      id: "gather",
      kind: "agent.run",
      label: "gather",
      agent: "researcher",
      tool: null,
      input: "${input}",
      provider: "anthropic",
      tools: ["web-search"],
    },
    {
      id: "summarise",
      kind: "agent.run",
      label: "summarise",
      agent: "greeter",
      tool: null,
      input: "${steps.gather.output}",
      provider: "anthropic",
      tools: [],
    },
    {
      id: "save-results",
      kind: "tool.call",
      label: "save-results",
      agent: null,
      tool: "fs-write",
      input: "${steps.summarise.output}",
      provider: null,
      tools: [],
    },
  ],
  edges: [
    { source: "gather", target: "summarise" },
    { source: "summarise", target: "save-results" },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/graph")) return Promise.resolve({ ok: true, json: async () => graph });
      if (url.includes("/workflows"))
        return Promise.resolve({
          ok: true,
          json: async () => ({ workflows: ["nightly-research", "build-report"] }),
        });
      if (url.includes("/providers"))
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              name: "anthropic",
              installed: true,
              recommended: true,
              source: "well-known",
              credentials_gated: true,
            },
          ],
        });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
});

describe("GraphEditor", () => {
  it("loads the graph, shows a disabled gated Build button + the first step inspector", async () => {
    render(
      <ProjectProvider pid="demo">
        <GraphEditor />
      </ProjectProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /workflow/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /build from ir/i })).toBeDisabled();
    // default-selected first node → inspector shows "gather" (canvas is mocked, so this is unique)
    await waitFor(() => expect(screen.getByText("gather")).toBeInTheDocument());
  });

  it("toggles edit mode (local banner)", async () => {
    const user = userEvent.setup();
    render(
      <ProjectProvider pid="demo">
        <GraphEditor />
      </ProjectProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByText(/changes are local/i)).toBeInTheDocument();
  });

  it("shows the provider pill (recommended) and tools in the inspector", async () => {
    render(
      <ProjectProvider pid="demo">
        <GraphEditor />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("gather")).toBeInTheDocument());
    expect(screen.getByText(/⚡ anthropic/)).toBeInTheDocument();
    expect(screen.getByText(/✓ recommended/)).toBeInTheDocument();
    expect(screen.getByText("web-search")).toBeInTheDocument();
  });
});
