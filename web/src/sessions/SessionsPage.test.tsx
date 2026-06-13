import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SessionsPage } from "./SessionsPage";
import { ProjectProvider } from "../app/project-context";

const rows = Array.from({ length: 30 }, (_, i) => ({
  id: `018f5a2c-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`,
  prefix: `018f5a${String(i).padStart(2, "0")}`,
  agent: i % 2 === 0 ? "coder" : "reviewer",
  created_at: "2026-06-12T14:33:21Z",
  turns: i,
}));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => rows }));
});

function renderAt() {
  render(
    <ProjectProvider pid="demo">
      <MemoryRouter initialEntries={["/projects/demo/sessions"]}>
        <Routes>
          <Route path="/projects/:pid/sessions" element={<SessionsPage />} />
        </Routes>
      </MemoryRouter>
    </ProjectProvider>,
  );
}

describe("SessionsPage", () => {
  it("renders the first page (25 rows) with id links", async () => {
    renderAt();
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(25));
    const first = screen.getAllByRole("link")[0];
    expect(first).toHaveAttribute(
      "href",
      "/projects/demo/sessions/018f5a2c-0000-0000-0000-000000000000",
    );
  });

  it("filters by agent", async () => {
    renderAt();
    await waitFor(() => expect(screen.getAllByRole("link").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("filter by agent"), {
      target: { value: "reviewer" },
    });
    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(15));
  });
});
