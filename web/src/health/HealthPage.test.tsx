import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HealthPage } from "./HealthPage";
import { ProjectProvider } from "../app/project-context";

const report = {
  categories: [
    { name: "config", errors: 1, warnings: 0, needs_setup: 0 },
    { name: "lockfile", errors: 0, warnings: 0, needs_setup: 1 },
    { name: "packages", errors: 0, warnings: 0, needs_setup: 0 },
  ],
  findings: [
    {
      category: "config",
      severity: "error",
      rule: "tau.config.endpoint",
      summary: "inference.endpoint not set",
      detail: null,
      remediation: "set inference.endpoint in tau.toml",
      location: { path: "tau.toml", line: 3 },
    },
    {
      category: "lockfile",
      severity: "needs-setup",
      rule: "tau.lockfile.missing",
      summary: "no lockfile — packages not installed",
      detail: null,
      remediation: "run `tau install`",
      location: null,
    },
    {
      category: "config",
      severity: "critical",
      rule: "tau.critical.unknown",
      summary: "unknown severity from backend",
      detail: null,
      remediation: null,
      location: null,
    },
  ],
  sandbox: { tier: "seatbelt", status: "ready", no_sandbox: false },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => report }));
});

describe("HealthPage", () => {
  it("renders category chips + findings, gated conformance present", async () => {
    render(
      <ProjectProvider pid="demo">
        <HealthPage />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("tau.config.endpoint")).toBeInTheDocument());
    expect(screen.getByText("inference.endpoint not set")).toBeInTheDocument();
    expect(
      screen.getByText("set inference.endpoint in tau.toml", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /config/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /lockfile/i })).toBeInTheDocument();
    expect(screen.getByText(/waits on tau β\.6/i)).toBeInTheDocument();
  });

  it("filters the findings table by category chip", async () => {
    const user = userEvent.setup();
    render(
      <ProjectProvider pid="demo">
        <HealthPage />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("tau.config.endpoint")).toBeInTheDocument());
    expect(screen.getByText("tau.lockfile.missing")).toBeInTheDocument();
    // filter to lockfile → config finding disappears
    await user.click(screen.getByRole("button", { name: /lockfile/i }));
    expect(screen.getByText("tau.lockfile.missing")).toBeInTheDocument();
    expect(screen.queryByText("tau.config.endpoint")).not.toBeInTheDocument();
  });

  it("renders an unknown severity in an escalated tone, never the benign warning tone", async () => {
    render(
      <ProjectProvider pid="demo">
        <HealthPage />
      </ProjectProvider>,
    );
    await waitFor(() => expect(screen.getByText("tau.critical.unknown")).toBeInTheDocument());
    const badge = screen.getByText("critical");
    // An unrecognized severity must escalate (error tone), not silently render as
    // the benign "warning" tone — otherwise a typo or new value downgrades risk.
    expect(badge.className).toContain("text-st-error");
    expect(badge.className).not.toContain("text-st-running");
  });
});
