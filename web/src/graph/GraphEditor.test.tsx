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
      if (url.includes("/targets"))
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              triple: "darwin-native-strict",
              platform: "darwin",
              adapter_family: "native",
              tier: "tier1",
              status: "available",
              required_shapes: [],
            },
          ],
        });
      if (url.includes("/build"))
        return Promise.resolve({
          ok: true,
          json: async () => ({
            path: "dist/demo.tau",
            sha256: "abc123def456",
            size_bytes: 1024,
            built_at: null,
          }),
        });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
});

describe("GraphEditor", () => {
  it("builds via the ship endpoint and shows the reproducibility hash", async () => {
    const user = userEvent.setup();
    render(
      <ProjectProvider pid="demo">
        <GraphEditor />
      </ProjectProvider>,
    );
    const buildBtn = await screen.findByRole("button", { name: /^build$/i });
    expect(buildBtn).not.toBeDisabled();
    await user.click(buildBtn);
    await waitFor(() => expect(screen.getByText(/abc123de/)).toBeInTheDocument());
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
