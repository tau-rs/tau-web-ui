import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
      capabilities: [],
    },
    transcript: [
      { direction: "out", method: "meta.handshake", payload: { protocol_version: 1 } },
      {
        direction: "in",
        method: "result",
        payload: { provides: "Tool", protocol_version: 1 },
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
    describe: { port: "LlmBackend", protocol_version: 1, tool: null, capabilities: [] },
    transcript: [
      { direction: "out", method: "meta.handshake", payload: { protocol_version: 1 } },
      { direction: "in", method: "result", payload: { plugin_name: "anthropic" } },
    ],
  },
];

function stub(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

beforeEach(() => {
  stub({ plugins, errors: [] });
});

describe("PluginsTab", () => {
  it("lists plugins, selects the first by default, shows describe + transcript, no mock banner", async () => {
    render(
      <ProjectProvider pid="demo">
        <PluginsTab />
      </ProjectProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /fs-read/i })).toBeInTheDocument(),
    );
    // mock banner is gone now that the real path is the default
    expect(screen.queryByText(/mock data/i)).not.toBeInTheDocument();
    expect(screen.getByText(/fs-read\(path: string\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /meta\.handshake/i })).toBeInTheDocument();
  });

  it("renders an error row for a plugin that failed to introspect", async () => {
    stub({
      plugins: [],
      errors: [{ package: "shell", kind: "timeout", message: "describe timed out" }],
    });
    render(
      <ProjectProvider pid="demo">
        <PluginsTab />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("shell")).toBeInTheDocument());
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByText(/describe timed out/)).toBeInTheDocument();
    expect(screen.getByText(/no plugins/i)).toBeInTheDocument();
  });
});
