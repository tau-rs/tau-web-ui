import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import { CredentialChainEditor } from "./CredentialChainEditor";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          backend: "anthropic",
          sources: [],
          resolved: false,
          resolved_via: null,
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
    const put = calls.find(
      ([u, o]) => u.includes("/api/credentials/anthropic") && o?.method === "PUT",
    );
    const body = JSON.parse(put![1]!.body as string);
    expect(body.sources).toEqual([{ kind: "local", ref: null }]);
    expect(body.local_value).toBe("sk-demo");
  });

  it("ungates the SecretManager kinds; only token-broker/workload-identity disabled", () => {
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={() => {}} />);
    for (const name of ["Env", "Local", "Vault", "AWS KV", "GCP KV", "Azure KV"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(screen.getByRole("button", { name: "Token broker" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Workload identity" })).toBeDisabled();
  });

  it("adds a Vault source with a ref and PUTs the path", async () => {
    const user = userEvent.setup();
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Vault" }));
    await user.type(screen.getByLabelText("Vault ref 0"), "secret/data/anthropic");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
        .mock.calls;
      const put = calls.find(
        ([u, o]) => u.includes("/api/credentials/anthropic") && o?.method === "PUT",
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(put![1]!.body as string).sources).toEqual([
        { kind: "vault", ref: "secret/data/anthropic" },
      ]);
    });
  });

  it("shows the per-source detail hint for an unconfigured source", () => {
    const status: BackendCredentialStatus = {
      backend: "anthropic",
      sources: [
        {
          kind: "vault",
          ref: "secret/data/anthropic",
          configured: false,
          gated: false,
          detail: "VAULT_ADDR not set",
        },
      ],
      resolved: false,
      resolved_via: null,
    };
    render(<CredentialChainEditor backend="anthropic" status={status} onSaved={() => {}} />);
    expect(screen.getByText(/VAULT_ADDR not set/)).toBeInTheDocument();
  });
});
