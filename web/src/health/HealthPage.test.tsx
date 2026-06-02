import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HealthPage } from "./HealthPage";

const report = {
  categories: [
    { name: "config", errors: 1, warnings: 0, notes: 0 },
    { name: "lockfile", errors: 0, warnings: 1, notes: 0 },
    { name: "pkg", errors: 0, warnings: 0, notes: 0 },
  ],
  findings: [
    {
      category: "config",
      severity: "error",
      rule: "TAU-CONFIG-ENDPOINT",
      message: "inference.endpoint not set",
      location: "tau.toml:3",
    },
    {
      category: "lockfile",
      severity: "warning",
      rule: "TAU-LOCK-STALE",
      message: "stale",
      location: "tau.lock:1",
    },
  ],
  sandbox: { tier: "seatbelt", status: "ready", no_sandbox: false },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => report }));
});

describe("HealthPage", () => {
  it("renders category chips + findings, gated conformance present", async () => {
    render(<HealthPage />);
    await waitFor(() => expect(screen.getByText("TAU-CONFIG-ENDPOINT")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /config/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /lockfile/i })).toBeInTheDocument();
    expect(screen.getByText(/waits on tau β\.6/i)).toBeInTheDocument();
  });

  it("filters the findings table by category chip", async () => {
    const user = userEvent.setup();
    render(<HealthPage />);
    await waitFor(() => expect(screen.getByText("TAU-CONFIG-ENDPOINT")).toBeInTheDocument());
    expect(screen.getByText("TAU-LOCK-STALE")).toBeInTheDocument();
    // filter to lockfile → config finding disappears
    await user.click(screen.getByRole("button", { name: /lockfile/i }));
    expect(screen.getByText("TAU-LOCK-STALE")).toBeInTheDocument();
    expect(screen.queryByText("TAU-CONFIG-ENDPOINT")).not.toBeInTheDocument();
  });
});
