import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PluginsTab } from "./PluginsTab";
import { ProjectProvider } from "../app/project-context";

const plugins = [
  {
    name: "fs-read",
    version: "1.0.0",
    source: "github.com/tau/fs-read",
    kind: "rust-cargo",
    binary: "fs-read",
    port: "Tool",
    protocol_version: 1,
    describe: {
      port: "Tool",
      protocol_version: 1,
      tool: { name: "fs-read", input_schema: { path: "string" } },
      capabilities: [{ kind: "fs.read", fields: { paths: ["/x/**"] } }],
    },
    transcript: [
      { direction: "out", method: "meta.handshake", payload: { protocol_version: 1 } },
      {
        direction: "in",
        method: "result",
        payload: { ok: true, content: [{ type: "text", text: "# tau" }] },
      },
    ],
  },
  {
    name: "anthropic",
    version: "0.1.0",
    source: "github.com/tau/anthropic",
    kind: "rust-cargo",
    binary: "anthropic",
    port: "LlmBackend",
    protocol_version: 1,
    describe: {
      port: "LlmBackend",
      protocol_version: 1,
      tool: null,
      capabilities: [{ kind: "net.http", fields: { hosts: ["api.anthropic.com"] } }],
    },
    transcript: [
      { direction: "out", method: "llm.generate", payload: { model: "claude-opus-4" } },
      { direction: "in", method: "result", payload: { content: [], usage: { input_tokens: 10 } } },
    ],
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => plugins }));
});

describe("PluginsTab", () => {
  it("lists plugins, selects the first by default, shows describe + transcript", async () => {
    render(
      <ProjectProvider pid="demo">
        <PluginsTab />
      </ProjectProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /fs-read/i })).toBeInTheDocument(),
    );
    // gated banner always present
    expect(screen.getByText(/mock data/i)).toBeInTheDocument();
    // default selection = fs-read → tool schema + a frame method
    expect(screen.getByText(/fs-read\(path: string\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /meta\.handshake/i })).toBeInTheDocument();
  });

  it("switches selection and expands a frame to show JSON", async () => {
    const user = userEvent.setup();
    render(
      <ProjectProvider pid="demo">
        <PluginsTab />
      </ProjectProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /anthropic/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /anthropic/i }));
    const frameBtn = screen.getByRole("button", { name: /llm\.generate/i });
    expect(frameBtn).toBeInTheDocument();
    await user.click(frameBtn);
    // expanded pretty JSON contains the model. Match the pretty form ("model": …
    // with a space) so we hit only the expanded <pre>, not the one-line preview
    // (which renders {"model":"claude-opus-4"} with no space).
    expect(screen.getByText(/"model": "claude-opus-4"/)).toBeInTheDocument();
  });
});
