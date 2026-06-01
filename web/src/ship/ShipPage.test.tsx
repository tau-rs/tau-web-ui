import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShipPage } from "./ShipPage";

const targets = [
  { name: "host", substrate: "native", status: "ready", gate: null },
  { name: "wasm", substrate: "wasm32", status: "gated", gate: "γ" },
];
const bundles = [
  {
    artifact: "demo.tau",
    target: "host",
    size_bytes: 2_310_004,
    hash: "sha256:seedhash00",
    drift: "drifted",
    built_at: "1d ago",
    steps: [{ name: "compile", status: "ok", duration_ms: 2100 }],
  },
];
const newBundle = {
  artifact: "demo.tau",
  target: "host",
  size_bytes: 2_460_512,
  hash: "sha256:freshbuild9",
  drift: "clean",
  built_at: "just now",
  steps: [
    { name: "resolve deps", status: "ok", duration_ms: 118 },
    { name: "compile", status: "ok", duration_ms: 2087 },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/targets"))
        return Promise.resolve({ ok: true, json: async () => targets });
      if (url.includes("/bundles"))
        return Promise.resolve({ ok: true, json: async () => bundles });
      if (url.includes("/build"))
        return Promise.resolve({ ok: true, json: async () => newBundle });
      return Promise.resolve({ ok: true, json: async () => [] });
    }),
  );
});

describe("ShipPage", () => {
  it("renders targets + bundles; gated target is not buildable", async () => {
    render(<ShipPage />);
    // target cards rendered — assert on the substrate (unique; "host"/"wasm"
    // also appear as a <select> option and a bundle-row target cell).
    await waitFor(() => expect(screen.getByText(/native/)).toBeInTheDocument());
    expect(screen.getByText(/wasm32/)).toBeInTheDocument();
    // the seeded bundle shows its short hash + drift
    expect(screen.getByText("seedhash")).toBeInTheDocument();
    expect(screen.getByText("drifted")).toBeInTheDocument();
    // only ready targets are build options (role-scoped: avoids the card/cell matches)
    expect(screen.getByRole("option", { name: "host" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "wasm" })).not.toBeInTheDocument();
  });

  it("builds and prepends the new bundle with its step timeline", async () => {
    const user = userEvent.setup();
    render(<ShipPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^build$/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^build$/i }));
    // the freshly built bundle (unique short hash) appears
    await waitFor(() => expect(screen.getByText("freshbui")).toBeInTheDocument());
    // its step timeline shows "resolve deps"
    expect(screen.getByText("resolve deps")).toBeInTheDocument();
  });
});
