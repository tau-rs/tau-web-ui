import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PackagesPage } from "./PackagesPage";
import { ProjectProvider } from "../app/project-context";

beforeEach(() => {
  vi.restoreAllMocks();
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
    render(
      <ProjectProvider pid="demo">
        <PackagesPage />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("install git url"), {
      target: { value: "https://github.com/acme/cooltool.git" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(screen.getByText("cooltool")).toBeInTheDocument());
  });

  it("does not render a failed/drift package status in the success tone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/packages/verify"))
          return Promise.resolve({
            ok: true,
            json: async () => ({ results: [{ name: "anthropic", status: "drift" }] }),
          });
        if (url.includes("/packages"))
          return Promise.resolve({
            ok: true,
            json: async () => ({
              packages: [
                {
                  name: "anthropic",
                  version: "0.1.0",
                  source: "github.com/tau/anthropic",
                  scope: "project",
                  version_count: 1,
                },
              ],
            }),
          });
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }),
    );
    render(
      <ProjectProvider pid="demo">
        <PackagesPage />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("anthropic")).toBeInTheDocument());
    // Before verify runs, the "—" placeholder means "not verified yet" — it must
    // be neutral, never borrow the success green.
    const placeholder = screen.getByText("—");
    expect(placeholder.className).not.toContain("text-st-ok");
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    const drift = await screen.findByText("drift");
    // A drift/failed/stale status is not a success and must not render green.
    expect(drift.className).toContain("text-st-error");
    expect(drift.className).not.toContain("text-st-ok");
  });
});
