import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProvidersPage } from "./ProvidersPage";

const providers = [
  {
    name: "anthropic",
    installed: true,
    recommended: true,
    source: "well-known",
    credentials_gated: true,
  },
  {
    name: "openai",
    installed: false,
    recommended: false,
    source: "well-known",
    credentials_gated: true,
  },
];
const credentials = [
  {
    backend: "anthropic",
    sources: [{ kind: "local", ref: null, configured: true }],
    resolved: true,
    resolved_via: "local",
  },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/api/credentials"))
        return Promise.resolve({ ok: true, json: async () => credentials, text: async () => "" });
      if (url.includes("/providers"))
        return Promise.resolve({ ok: true, json: async () => providers, text: async () => "" });
      if (url.includes("/packages/install"))
        return Promise.resolve({
          ok: true,
          json: async () => ({ package: { name: "added" } }),
          text: async () => "",
        });
      return Promise.resolve({ ok: true, json: async () => ({}), text: async () => "" });
    }),
  );
});

describe("ProvidersPage", () => {
  it("renders providers with their credential status badge", async () => {
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    expect(screen.getByText("✓ via local")).toBeInTheDocument();
    expect(screen.getByText("🔒 none")).toBeInTheDocument();
  });

  it("expands a row into the credential chain editor", async () => {
    const user = userEvent.setup();
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    await user.click(screen.getAllByRole("button", { name: "set credential" })[0]);
    expect(screen.getByText(/credential chain — anthropic/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("Add provider posts an install", async () => {
    const user = userEvent.setup();
    render(<ProvidersPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    await user.type(
      screen.getByLabelText("add provider git url"),
      "https://github.com/org/llm.git",
    );
    await user.click(screen.getByRole("button", { name: "Add provider" }));
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
        .mock.calls;
      expect(calls.some(([u, o]) => u.includes("/packages/install") && o?.method === "POST")).toBe(
        true,
      );
    });
  });
});
