import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Footer } from "./Footer";
import { useStore } from "../store/store";

describe("Footer", () => {
  it("shows version, gateway status, and a GitHub link", () => {
    useStore.setState({
      health: { gateway_ok: true, engine_ok: true, tau_bin: "x", tau_version: "0.0.0-mock" },
    });
    render(<Footer />);
    expect(screen.getByText(/0\.0\.0-mock/)).toBeInTheDocument();
    expect(screen.getByText(/gateway ok/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /github/i }).getAttribute("href")).toContain(
      "github.com",
    );
  });

  it("explains the reason + last contact in the dot tooltip when down", () => {
    useStore.setState({
      health: { gateway_ok: false, engine_ok: false, tau_bin: "x", tau_version: "0.0.0-mock" },
      healthError: "Failed to fetch",
      healthCheckedAt: Date.now() - 60_000,
    });
    render(<Footer />);
    const dot = screen.getByTitle(/unreachable — Failed to fetch/i);
    expect(dot).toBeInTheDocument();
    expect(dot.getAttribute("title")).toMatch(/last ok/i);
  });
});
