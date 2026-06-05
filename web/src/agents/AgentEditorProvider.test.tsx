import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AgentEditorPage } from "./AgentEditorPage";

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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/providers"))
        return Promise.resolve({ ok: true, json: async () => providers });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }),
  );
});

function renderNew() {
  render(
    <MemoryRouter initialEntries={["/projects/demo/agents/new"]}>
      <Routes>
        <Route path="/projects/:pid/agents/new" element={<AgentEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AgentEditor provider combobox", () => {
  it("offers providers, marks the recommended, and pre-fills a new agent", async () => {
    renderNew();
    // datalist option for a provider
    await waitFor(() => expect(document.querySelector('option[value="anthropic"]')).toBeTruthy());
    expect(document.querySelector('option[value="openai"]')).toBeTruthy();
    // recommended chip
    expect(screen.getByRole("button", { name: /recommended: anthropic/i })).toBeInTheDocument();
    // new agent pre-filled with the recommended provider
    await waitFor(() =>
      expect((screen.getByLabelText("llm backend") as HTMLInputElement).value).toBe("anthropic"),
    );
  });
});
