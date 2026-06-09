import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CredentialChainEditor } from "./CredentialChainEditor";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          backend: "anthropic",
          sources: [{ kind: "local", ref: null, configured: true, gated: false }],
          resolved: true,
          resolved_via: "local",
        }),
        text: async () => "",
      }),
    ),
  );
});

describe("CredentialChainEditor", () => {
  it("adds a Local source, captures a write-only value, and PUTs it", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={onSaved} />);

    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.type(screen.getByLabelText("local secret value"), "sk-demo");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
      .mock.calls;
    const putCall = calls.find(
      ([u, o]) => u.includes("/api/credentials/anthropic") && o?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    const body = JSON.parse(putCall![1]!.body as string);
    expect(body.sources).toEqual([{ kind: "local", ref: null }]);
    expect(body.local_value).toBe("sk-demo");
  });

  it("disables gated source kinds in the add menu", () => {
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: "Env" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Local" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Vault" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Token broker" })).toBeDisabled();
  });
});
