import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("renders nav links with hrefs", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /runs/i })).toHaveAttribute("href", "/runs");
    expect(screen.getByRole("link", { name: /health/i })).toHaveAttribute("href", "/health");
  });
});
