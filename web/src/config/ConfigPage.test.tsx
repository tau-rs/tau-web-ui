import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfigPage } from "./ConfigPage";
import { setActiveProject } from "../api/client";

beforeEach(() => {
  vi.restoreAllMocks();
  setActiveProject("demo");
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
    render(<ConfigPage />);
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
});
