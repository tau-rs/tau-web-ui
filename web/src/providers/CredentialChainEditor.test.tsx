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

function putBody(): { sources: { kind: string; ref: string | null }[]; local_value?: string } {
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock
    .calls;
  const put = calls.find(
    ([u, o]) => u.includes("/api/credentials/anthropic") && o?.method === "PUT",
  );
  return JSON.parse(put![1]!.body as string);
}

describe("CredentialChainEditor", () => {
  it("adds a Local source, captures a write-only value, and PUTs it", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={onSaved} />);
    await user.click(screen.getByRole("button", { name: "Local" }));
    await user.type(screen.getByLabelText("local secret value"), "sk-demo");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(putBody().sources).toEqual([{ kind: "local", ref: null }]);
    expect(putBody().local_value).toBe("sk-demo");
  });

  it("suppresses autocomplete/spellcheck on the write-only secret input", async () => {
    const user = userEvent.setup();
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Local" }));
    const input = screen.getByLabelText("local secret value");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("makes all eight kinds addable (no disabled group)", () => {
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={() => {}} />);
    for (const name of [
      "Env",
      "Local",
      "Vault",
      "AWS KV",
      "GCP KV",
      "Azure KV",
      "Token broker",
      "Workload identity",
    ]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  it("adds a Token broker with a URL ref and PUTs it", async () => {
    const user = userEvent.setup();
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Token broker" }));
    await user.type(screen.getByLabelText("Token broker ref 0"), "https://gw.example/v1");
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(putBody().sources).toEqual([{ kind: "token_broker", ref: "https://gw.example/v1" }]),
    );
  });

  it("adds a ref-less Workload identity (no input) and PUTs ref:null", async () => {
    const user = userEvent.setup();
    render(<CredentialChainEditor backend="anthropic" status={undefined} onSaved={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Workload identity" }));
    expect(screen.queryByLabelText(/Workload identity ref/)).not.toBeInTheDocument();
    expect(screen.getByText(/uses this machine.s ambient identity/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(putBody().sources).toEqual([{ kind: "workload_identity", ref: null }]),
    );
  });

  it("renders the neutral 'resolved by tau at runtime' note (not an amber warning)", () => {
    const status: BackendCredentialStatus = {
      backend: "anthropic",
      sources: [
        {
          kind: "token_broker",
          ref: "https://b",
          configured: false,
          detail: "resolved by tau at runtime",
        },
      ],
      resolved: false,
      resolved_via: null,
    };
    render(<CredentialChainEditor backend="anthropic" status={status} onSaved={() => {}} />);
    const note = screen.getByText(/resolved by tau at runtime/);
    expect(note).toBeInTheDocument();
    expect(note.textContent).toContain("↗");
    expect(note).toHaveClass("text-accent");
  });
});
