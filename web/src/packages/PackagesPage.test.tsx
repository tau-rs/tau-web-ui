import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PackagesPage } from "./PackagesPage";

beforeEach(() => vi.restoreAllMocks());

describe("PackagesPage", () => {
  it("lists packages and installs a new one", async () => {
    let list = [
      { name: "anthropic", version: "0.1.0", source: "github.com/tau/anthropic", status: "ok" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith("/api/packages") && (!init || init.method !== "POST"))
          return Promise.resolve({ ok: true, json: async () => ({ packages: list }) });
        if (url.endsWith("/api/packages/install")) {
          list = [
            ...list,
            {
              name: "cooltool",
              version: "1.0.0",
              source: "github.com/acme/cooltool",
              status: "ok",
            },
          ];
          return Promise.resolve({ ok: true, json: async () => ({ package: list[1] }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );
    render(<PackagesPage />);
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("install git url"), {
      target: { value: "https://github.com/acme/cooltool.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(screen.getByText("cooltool")).toBeInTheDocument());
  });
});
