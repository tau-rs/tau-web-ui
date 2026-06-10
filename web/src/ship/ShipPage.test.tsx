import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShipPage } from "./ShipPage";

const shapes = ["fs.r", "fs.w", "exec", "net.http"];
const targets = [
  {
    triple: "darwin-native-strict",
    platform: "darwin",
    adapter_family: "native",
    tier: "strict",
    status: "available",
    required_shapes: shapes,
  },
  {
    triple: "windows-native-strict",
    platform: "windows",
    adapter_family: "native",
    tier: "strict",
    status: "reserved",
    required_shapes: shapes,
  },
];
const bundles = [
  {
    path: "demo.tau",
    sha256: "seedhash00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    size_bytes: 2_310_004,
    built_at: "1d ago",
  },
];
const newBundle = {
  path: "demo.tau",
  sha256: "freshbui9bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  size_bytes: 2_460_512,
  built_at: "just now",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/targets")) return Promise.resolve({ ok: true, json: async () => targets });
      if (url.includes("/bundles")) return Promise.resolve({ ok: true, json: async () => bundles });
      if (url.includes("/build")) return Promise.resolve({ ok: true, json: async () => newBundle });
      return Promise.resolve({ ok: true, json: async () => [] });
    }),
  );
});

describe("ShipPage", () => {
  it("renders targets + bundles; reserved target is not buildable", async () => {
    render(<ShipPage />);
    // target cards rendered — the reserved card shows its status text
    await waitFor(() => expect(screen.getByText(/reserved/)).toBeInTheDocument());
    // the seeded bundle shows its short hash (first 8 of the sha256 hex)
    expect(screen.getByText("seedhash")).toBeInTheDocument();
    expect(screen.getByText("demo.tau")).toBeInTheDocument();
    // only available targets are build options
    expect(screen.getByRole("option", { name: "darwin-native-strict" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "windows-native-strict" })).not.toBeInTheDocument();
  });

  it("builds and prepends the new bundle", async () => {
    const user = userEvent.setup();
    render(<ShipPage />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^build$/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /^build$/i }));
    // the freshly built bundle (unique short hash) appears
    await waitFor(() => expect(screen.getByText("freshbui")).toBeInTheDocument());
    // the last-build line surfaces the artifact path
    expect(screen.getByText(/built demo\.tau/)).toBeInTheDocument();
  });
});
