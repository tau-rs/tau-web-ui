import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PackagesPage } from "./PackagesPage";
import { setActiveProject } from "../api/client";

beforeEach(() => {
  vi.restoreAllMocks();
  setActiveProject("demo");
});

describe("PackagesPage", () => {
  it("lists packages and installs a new one", async () => {
    let list = [
      {
        name: "anthropic",
        version: "0.1.0",
        source: "github.com/tau/anthropic",
        scope: "project",
        version_count: 1,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (
          url.includes("/packages") &&
          !url.includes("/install") &&
          (!init || init.method !== "POST")
        )
          return Promise.resolve({ ok: true, json: async () => ({ packages: list }) });
        if (url.includes("/packages/install")) {
          list = [
            ...list,
            {
              name: "cooltool",
              version: "1.0.0",
              source: "github.com/acme/cooltool",
              scope: "project",
              version_count: 1,
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
