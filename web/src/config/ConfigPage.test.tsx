import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfigPage } from "./ConfigPage";
import { Toaster } from "../notify/Toaster";
import { useNotifications } from "../notify/notify";
import { ProjectProvider } from "../app/project-context";

beforeEach(() => {
  vi.restoreAllMocks();
  useNotifications.setState({ items: [] });
});

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve({ ok: true, json: async () => handler(url, init), text: async () => "" }),
    ),
  );
}

describe("ConfigPage", () => {
  it("loads config, edits the name, and saves", async () => {
    const calls: { url: string; body?: string }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, body: init?.body as string });
      if (url.includes("/project/config") && (!init || init.method !== "PUT"))
        return {
          name: "demo",
          description: "d",
          agents: [
            { id: "greeter", llm_backend: "anthropic", package: "greeter@^0.1", source: "local" },
          ],
        };
      return { ok: true };
    });
    render(
      <ProjectProvider pid="demo">
        <ConfigPage />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByDisplayValue("demo")).toBeInTheDocument());
    expect(screen.getByText("greeter")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("project name"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes("/project/config") && c.body?.includes("renamed")),
      ).toBe(true),
    );
  });

  it("surfaces an error and does NOT claim saved when the save fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url.includes("/project/config") && init?.method === "PUT")
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({}),
            text: async () => "boom",
          });
        return Promise.resolve({
          ok: true,
          json: async () => ({ name: "demo", description: "d", agents: [] }),
          text: async () => "",
        });
      }),
    );
    render(
      <ProjectProvider pid="demo">
        <ConfigPage />
        <Toaster />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByDisplayValue("demo")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("Failed to save config");
    expect(screen.queryByText(/saved to tau\.toml/)).not.toBeInTheDocument();
  });
});
