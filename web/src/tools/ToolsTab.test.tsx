import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToolsTab } from "./ToolsTab";
import { ProjectProvider } from "../app/project-context";

const tools = [
  {
    name: "fs-read",
    version: "1.0.0",
    source: "github.com/tau/fs-read",
    provides: "tool",
    plugin_kind: "rust-cargo",
    binary: "fs-read",
    capabilities: [{ kind: "fs.read", fields: { paths: ["/x/**"] } }],
    used_by: [{ kind: "skill", name: "critic" }],
  },
  {
    name: "shell",
    version: "0.2.0",
    source: "github.com/tau/shell",
    provides: "tool",
    plugin_kind: "rust-cargo",
    binary: "shell",
    capabilities: [{ kind: "process.spawn", fields: { commands: ["sh"] } }],
    used_by: [],
  },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tools, error_count: 0 }) }),
  );
});

describe("ToolsTab", () => {
  it("lists tools and expands one to show capability + used_by", async () => {
    const user = userEvent.setup();
    render(
      <ProjectProvider pid="demo">
        <ToolsTab />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("fs-read")).toBeInTheDocument());
    expect(screen.getByText("shell")).toBeInTheDocument();

    // expand fs-read → the expanded detail shows the capability fields + used_by
    await user.click(screen.getByRole("button", { name: /fs-read/i }));
    expect(screen.getByText(/paths=\[/)).toBeInTheDocument();
    expect(screen.getByText("critic")).toBeInTheDocument();
  });

  it("shows 'unused' for a tool with no users when expanded", async () => {
    const user = userEvent.setup();
    render(
      <ProjectProvider pid="demo">
        <ToolsTab />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("shell")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /shell/i }));
    expect(screen.getByText(/unused/i)).toBeInTheDocument();
  });

  it("shows a failed-introspection notice when error_count > 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tools: [], error_count: 2 }) }),
    );
    render(
      <ProjectProvider pid="demo">
        <ToolsTab />
      </ProjectProvider>,
    );
    await waitFor(() =>
      expect(screen.getByText(/2 plugins failed to introspect/i)).toBeInTheDocument(),
    );
  });
});
