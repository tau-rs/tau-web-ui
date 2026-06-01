import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { Navbar } from "./Navbar";
import { useStore } from "../store/store";

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="loc">{pathname}</div>;
}

function setup() {
  useStore.setState({
    project: null,
    activeProjectId: "demo",
    projects: [
      {
        meta: { id: "demo", name: "demo", path: "/p", source: { kind: "local" } },
        summary: {},
      } as never,
      {
        meta: { id: "acme-bot", name: "acme-bot", path: "/q", source: { kind: "local" } },
        summary: {},
      } as never,
    ],
  });
  render(
    <MemoryRouter initialEntries={["/projects/demo/runs"]}>
      <Routes>
        <Route
          path="/projects/:pid/*"
          element={
            <>
              <Navbar />
              <Probe />
            </>
          }
        />
        <Route path="/" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("project switcher", () => {
  it("switches to another project preserving the sub-route", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByLabelText("project switcher"));
    await user.click(screen.getByRole("button", { name: "acme-bot" }));
    expect(screen.getByTestId("loc")).toHaveTextContent("/projects/acme-bot/runs");
  });
});
