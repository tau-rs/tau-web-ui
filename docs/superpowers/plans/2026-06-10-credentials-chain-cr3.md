# Credentials chain — CR-3 (TokenBroker / WorkloadIdentity, UI-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ungate the last two credential kinds (`token_broker`, `workload_identity`) as a *configuration surface only* — TokenBroker takes a URL `ref`, WorkloadIdentity is ref-less, and both report **"resolved by tau at runtime"** (the gateway performs no detection); retire the now-empty `gated` concept.

**Architecture:** UI-only — the gateway never resolves these two (that's tau's runtime job). In `gateway/src/credentials/mod.rs`: `source_detail` returns "resolved by tau at runtime" for them; the `gated()` method, `SourceStatus.gated` field, and the `put` gated-rejection are removed; `put` ref-exempts Local **and** WorkloadIdentity. The editor makes all eight kinds addable and renders a neutral "↗ resolved by tau at runtime" note for the two. No SDKs, no new resolution logic.

**Tech Stack:** Rust (axum, serde, ts-rs); React 18, TS, Tailwind, Vitest, Playwright. Spec: `docs/superpowers/specs/2026-06-10-credentials-chain-cr3-tokenbroker-workloadidentity-design.md`. Builds on CR-1/CR-2.

---

## File Structure

**Gateway — Modify:** `gateway/src/credentials/mod.rs` (retire `gated`, runtime-resolved detail, put ref-exemption, update unit tests), `gateway/tests/credentials_api.rs` (flip token_broker→422 to 200; drop `gated` assertions). **Regenerated:** `web/src/types/SourceStatus.ts` (loses `gated`).
**Frontend — Modify:** `web/src/providers/CredentialChainEditor.tsx` (ungate the 2, TokenBroker ref input, WorkloadIdentity no-ref, runtime note, save mapping), `web/src/providers/CredentialChainEditor.test.tsx` (drop `gated` fixture; new tests), `web/src/providers/ProvidersPage.test.tsx` (drop `gated` from a fixture source), `web/e2e/run.spec.ts` (e2e).

---

## Task 1: Gateway — retire `gated`, runtime-resolved detail, put ref-exemption

**Files:** Modify `gateway/src/credentials/mod.rs`.

- [ ] **Step 1: Update the module doc comment** (lines 1-6) — replace the `//! ... CR-1 shipped Env + Local; CR-2 ungated the SecretManagers ... remain gated (CR-3) ...` block with:

```rust
//! LLM-backend credentials: an ordered source **chain** (first-resolves-wins),
//! tau's "provider chain, never a vault" model with the gateway as the parent-app
//! resolver. Env / Local resolve here; SecretManagers (Vault / AWS / GCP / Azure KV)
//! resolve by ambient-env presence; TokenBroker / WorkloadIdentity are configured
//! here but **resolved by tau at runtime** (UI-only). The store is global (per
//! gateway `data_root`); secret values are write-only and never echoed.
```

- [ ] **Step 2: Remove the `gated()` method** — delete the entire `impl SourceKind { ... gated ... }` block:

```rust
impl SourceKind {
    /// Not yet wired (the TokenBroker/WorkloadIdentity path is CR-3).
    pub fn gated(self) -> bool {
        matches!(self, SourceKind::TokenBroker | SourceKind::WorkloadIdentity)
    }
}
```

(Delete those 6 lines entirely.)

- [ ] **Step 3: Remove the `gated` field from `SourceStatus`** — delete the `pub gated: bool,` line so the struct is:

```rust
pub struct SourceStatus {
    pub kind: SourceKind,
    #[serde(rename = "ref")]
    #[ts(rename = "ref")]
    pub reference: Option<String>,
    pub configured: bool,
    pub detail: Option<String>, // non-secret hint; "resolved by tau at runtime" for broker/WI
}
```

- [ ] **Step 4: Update `source_detail`** — change the TokenBroker/WorkloadIdentity arm (was `Some("waits on CR-3")`):

```rust
        SourceKind::TokenBroker | SourceKind::WorkloadIdentity => {
            Some("resolved by tau at runtime".to_string())
        }
```

(Leave the rest of `source_detail` unchanged. Also update the `source_configured` inline comment on the TokenBroker|WorkloadIdentity arm from `// gated (CR-3)` to `// resolution deferred to tau at runtime`.)

- [ ] **Step 5: Drop `gated` from `status_for`** — remove the `gated: s.kind.gated(),` line from the `SourceStatus { … }` construction so it reads:

```rust
            .map(|s| SourceStatus {
                kind: s.kind,
                reference: s.reference.clone(),
                configured: source_configured(s, has_local, &env_get),
                detail: source_detail(s, has_local, &env_get),
            })
```

- [ ] **Step 6: Update `put`** — remove the gated-rejection block and ref-exempt WorkloadIdentity. Replace the first two `if` checks in the validation loop:

```rust
            if s.kind.gated() {
                return Err(PutError::Invalid(format!(
                    "source kind {:?} is gated",
                    s.kind
                )));
            }
            if !matches!(s.kind, SourceKind::Local)
                && s.reference.as_deref().unwrap_or("").is_empty()
            {
                return Err(PutError::Invalid(
                    "this source kind requires a non-empty ref".to_string(),
                ));
            }
```

with (the gated check is gone; Local **and** WorkloadIdentity are ref-exempt):

```rust
            if !matches!(s.kind, SourceKind::Local | SourceKind::WorkloadIdentity)
                && s.reference.as_deref().unwrap_or("").is_empty()
            {
                return Err(PutError::Invalid(
                    "this source kind requires a non-empty ref".to_string(),
                ));
            }
```

Also update the `PutError::Invalid` doc comment (it says "Bad request (gated kind, duplicate kind, empty env ref)") to:

```rust
    /// Bad request (duplicate kind, or an empty ref on a ref-required kind) → HTTP 422.
```

- [ ] **Step 7: Update the two now-invalid unit tests.** In `mod resolver_tests`, REPLACE `gated_kinds_are_only_broker_and_workload` (it calls the deleted `gated()`) with:

```rust
    #[test]
    fn token_broker_and_workload_identity_defer_to_tau() {
        let tb = src(SourceKind::TokenBroker, Some("https://broker"));
        let wi = src(SourceKind::WorkloadIdentity, None);
        // the gateway never resolves these — resolution is tau's at runtime
        assert!(!source_configured(&tb, true, &no_env));
        assert!(!source_configured(&wi, true, &no_env));
        assert_eq!(source_detail(&tb, false, &no_env).as_deref(), Some("resolved by tau at runtime"));
        assert_eq!(source_detail(&wi, false, &no_env).as_deref(), Some("resolved by tau at runtime"));
        // a chain of only these resolves to nothing in the gateway
        assert_eq!(resolve(&[tb, wi], true, &no_env), (false, None));
    }
```

In `mod store_tests`, REPLACE `put_rejects_gated_duplicate_and_empty_ref` (it asserts a TokenBroker PUT errors and reads `.gated`) with:

```rust
    #[test]
    fn put_validates_ref_and_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        // duplicate kind → rejected
        assert!(c
            .put("x", vec![cfg(SourceKind::Env, Some("A")), cfg(SourceKind::Env, Some("B"))], None)
            .is_err());
        // empty ref on a ref-required kind → rejected (Env, SecretManager, TokenBroker)
        assert!(c.put("x", vec![cfg(SourceKind::Env, None)], None).is_err());
        assert!(c.put("x", vec![cfg(SourceKind::Vault, None)], None).is_err());
        assert!(c.put("x", vec![cfg(SourceKind::TokenBroker, None)], None).is_err());
        // accepted: SecretManager with a ref, TokenBroker with a URL, ref-less WorkloadIdentity
        let v = c.put("a", vec![cfg(SourceKind::Vault, Some("secret/x"))], None).unwrap();
        assert_eq!(v.sources[0].kind, SourceKind::Vault);
        assert!(!v.sources[0].configured);
        assert!(v.sources[0].detail.is_some());
        assert!(c.put("b", vec![cfg(SourceKind::TokenBroker, Some("https://b"))], None).is_ok());
        let wi = c.put("c", vec![cfg(SourceKind::WorkloadIdentity, None)], None).unwrap();
        assert_eq!(wi.sources[0].detail.as_deref(), Some("resolved by tau at runtime"));
    }
```

- [ ] **Step 8: Run + build** — `cargo test -p tau-gateway --lib credentials` → PASS; `cargo build -p tau-gateway` clean (only the pre-existing ts-rs "failed to parse serde attribute" notes). Confirm no `gated` references remain in the module: `grep -n "gated" gateway/src/credentials/mod.rs` should return nothing.

- [ ] **Step 9: Commit**

```bash
git add gateway/src/credentials/mod.rs
git commit -m "feat(gateway): ungate TokenBroker/WorkloadIdentity (UI-only, resolved by tau); retire gated"
```

---

## Task 2: Integration test + ts-rs binding + rust gate

**Files:** Modify `gateway/tests/credentials_api.rs`; regenerated `web/src/types/SourceStatus.ts`.

- [ ] **Step 1: Drop the two `gated` assertions** in `gateway/tests/credentials_api.rs`:
- Remove the line `assert_eq!(st2["sources"][0]["gated"], false);` (after the openai env PUT).
- Remove the line `assert_eq!(vst["sources"][0]["gated"], false);` (after the vault PUT). Update the adjacent comment `// CR-2: a vault source is now accepted (200), ungated, with a detail hint.` to `// A vault source is accepted (200) with a detail hint.`

- [ ] **Step 2: Replace the token_broker→422 block** — find the block commented `// a gated kind (token_broker) → 422` (PUTs `token_broker` and asserts 422). REPLACE it with:

```rust
    // CR-3: token_broker (with a URL ref) is accepted (200) and deferred to tau.
    let tb = http
        .put(format!("{base}/api/credentials/brokered"))
        .json(&serde_json::json!({ "sources": [{ "kind": "token_broker", "ref": "https://b" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(tb.status(), reqwest::StatusCode::OK);
    let tbst: serde_json::Value = tb.json().await.unwrap();
    assert_eq!(tbst["sources"][0]["detail"], "resolved by tau at runtime");
    assert_eq!(tbst["sources"][0]["configured"], false);

    // CR-3: workload_identity is ref-less → accepted (200), deferred to tau.
    let wi = http
        .put(format!("{base}/api/credentials/wid"))
        .json(&serde_json::json!({ "sources": [{ "kind": "workload_identity" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(wi.status(), reqwest::StatusCode::OK);
    let wist: serde_json::Value = wi.json().await.unwrap();
    assert_eq!(wist["sources"][0]["detail"], "resolved by tau at runtime");

    // token_broker with an empty ref → 422 (a broker needs a URL)
    let tbempty = http
        .put(format!("{base}/api/credentials/x"))
        .json(&serde_json::json!({ "sources": [{ "kind": "token_broker" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(tbempty.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);
```

(Leave the existing `// a manager with an empty ref → 422` vault block that follows — it still asserts 422 and is unchanged.)

- [ ] **Step 3: Build mock + run gateway tests (regenerates ts-rs)** — `cargo build -p fake-tau-serve && cargo test -p tau-gateway` → PASS. Confirm `git status --porcelain fixtures/demo` empty.

- [ ] **Step 4: Verify the binding** — `cat web/src/types/SourceStatus.ts` → now `{ kind: SourceKind, ref: string | null, configured: boolean, detail: string | null, }` (NO `gated`).

- [ ] **Step 5: Rust gate** — `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green (run `cargo fmt --all` first if needed; fix any clippy warning in the new code — NOT the pre-existing ts-rs notes).

- [ ] **Step 6: Commit**

```bash
git add gateway/tests/credentials_api.rs web/src/types/SourceStatus.ts
git commit -m "test(gateway): credentials integration accepts broker/WI (resolved by tau); SourceStatus drops gated"
```

---

## Task 3: Editor — ungate the two + TokenBroker ref + WorkloadIdentity no-ref + runtime note

**Files:** Modify `web/src/providers/CredentialChainEditor.tsx`, `web/src/providers/CredentialChainEditor.test.tsx`, `web/src/providers/ProvidersPage.test.tsx`.

- [ ] **Step 1: Update consts in `CredentialChainEditor.tsx`.** Replace the `ADDABLE_KINDS` / `GATED_KINDS` consts (KIND_LABEL unchanged) with:

```tsx
const ADDABLE_KINDS: SourceKind[] = [
  "env",
  "local",
  "vault",
  "aws_kv",
  "gcp_kv",
  "azure_kv",
  "token_broker",
  "workload_identity",
];
// kinds the gateway does NOT resolve — tau resolves them at runtime (shown neutrally)
const RUNTIME_RESOLVED: SourceKind[] = ["token_broker", "workload_identity"];
```

And add `token_broker` to `KIND_PLACEHOLDER` (the map keeps env/vault/aws_kv/gcp_kv/azure_kv; add):

```tsx
  token_broker: "https://gateway.ai.cloudflare.com/v1/…",
```

(`local` and `workload_identity` have no placeholder — they render no input.)

- [ ] **Step 2: Update the save mapping** — ref is `null` for Local **and** WorkloadIdentity:

```tsx
    const sources: SourceConfig[] = rows.map((r) => ({
      kind: r.kind,
      ref: r.kind === "local" || r.kind === "workload_identity" ? null : r.ref,
    }));
```

- [ ] **Step 3: Update the per-row input + detail hint.** Replace the input/text conditional (the `{r.kind === "local" ? (<span…>) : (<input…/>)}` block) AND the detail-hint span beneath it with:

```tsx
              {r.kind === "local" ? (
                <span className="flex-1 text-[10px] text-muted">resolves from the local store</span>
              ) : r.kind === "workload_identity" ? (
                <span className="flex-1 text-[10px] text-muted">
                  uses this machine&apos;s ambient identity
                </span>
              ) : (
                <input
                  aria-label={`${KIND_LABEL[r.kind]} ref ${i}`}
                  placeholder={KIND_PLACEHOLDER[r.kind]}
                  value={r.ref}
                  onChange={(e) => setRef(i, e.target.value)}
                  className={`flex-1 font-mono ${field}`}
                />
              )}
              {st &&
                !st.configured &&
                st.detail &&
                (RUNTIME_RESOLVED.includes(r.kind) ? (
                  <span className="flex-none text-[9px] text-accent">↗ {st.detail}</span>
                ) : (
                  <span className="flex-none text-[9px] text-amber-700">⚠ {st.detail}</span>
                ))}
```

- [ ] **Step 4: Remove the gated-button group from the add-source menu.** Delete the entire `{GATED_KINDS.map((k) => ( … ))}` block (the disabled buttons with the 🔒 span). The `ADDABLE_KINDS.filter((k) => !used.has(k)).map(...)` block above it now renders all eight addable kinds.

- [ ] **Step 5: Replace the test file `CredentialChainEditor.test.tsx` ENTIRELY** with:

```tsx
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
  const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
    .mock.calls;
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
    // no ref input for workload identity
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
    expect(note.className).toContain("text-accent");
  });
});
```

- [ ] **Step 6: Drop the stale `gated` field from `ProvidersPage.test.tsx`** — the credentials fixture has `sources: [{ kind: "local", ref: null, configured: true, gated: false }]`; remove `, gated: false` so it reads `{ kind: "local", ref: null, configured: true }` (the `SourceStatus` type no longer has `gated`, so the literal would be an excess-property type error).

- [ ] **Step 7: Run + typecheck + prettier** — `cd web && npx vitest run src/providers/` → PASS (5 editor + 3 ProvidersPage). `pnpm typecheck` clean. `npx prettier --write src/providers/CredentialChainEditor.tsx src/providers/CredentialChainEditor.test.tsx src/providers/ProvidersPage.test.tsx`.

- [ ] **Step 8: Commit**

```bash
git add web/src/providers/CredentialChainEditor.tsx web/src/providers/CredentialChainEditor.test.tsx web/src/providers/ProvidersPage.test.tsx
git commit -m "feat(web): ungate TokenBroker/WorkloadIdentity in the chain editor (resolved-by-tau note)"
```

---

## Task 4: E2e + final gate

**Files:** Modify `web/e2e/run.spec.ts`.

- [ ] **Step 1: Append the e2e spec** (read the file first):

```ts
test("providers: add TokenBroker + WorkloadIdentity — addable, resolved by tau at runtime", async ({
  page,
}) => {
  await page.goto("/projects/demo/providers");
  const row = page.getByRole("row").filter({ hasText: "anthropic" });
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.getByRole("button", { name: "set credential" }).click();
  await expect(page.getByText(/credential chain — anthropic/i)).toBeVisible();
  // every kind is addable now — Workload identity is enabled (no disabled group)
  await expect(page.getByRole("button", { name: "Workload identity" })).toBeEnabled();
  // add a Token broker (URL ref, located by placeholder — robust to row index) + a Workload identity
  await page.getByRole("button", { name: "Token broker" }).click();
  await page.getByPlaceholder(/gateway\.ai\.cloudflare/).fill("https://gateway.example/v1");
  await page.getByRole("button", { name: "Workload identity" }).click();
  await page.getByRole("button", { name: /^save$/i }).click();
  // both persist; the neutral runtime note appears
  await expect(page.getByText(/resolved by tau at runtime/i).first()).toBeVisible();
});
```

- [ ] **Step 2: Clear the dev credential store, kill stale servers, rebuild, run e2e**

The dev gateway `data_root` is `$HOME/.tau-web-ui`. Clear it so `anthropic`'s chain starts empty (and `token_broker` isn't already present, which would hide its add-button):

```bash
rm -f "$HOME/.tau-web-ui/credentials.toml" "$HOME/.tau-web-ui/credentials.secrets.json"
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. `web/playwright.config.ts` auto-starts the servers (`reuseExistingServer: !CI`). REAL ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; else `pnpm exec playwright test --list` to confirm parse + defer e2e to CI, then proceed with Steps 3–5 (unit gate must be green).

(Note: earlier e2e tests in the suite — CR-1 Local, CR-2 Vault — leave `anthropic`'s chain with `[local, vault]`, so this test's Token broker lands at a non-zero row index. The placeholder locator and `.first()` on the note are index-robust by design.)

- [ ] **Step 3: Restore fixtures** (mandatory even if e2e fails)

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 4: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm format && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green (run `pnpm format` FIRST; include any formatting in the commit).

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (check git status)
git commit -m "test(web): e2e add TokenBroker + WorkloadIdentity (resolved by tau at runtime)"
```

---

## Self-Review

**Spec coverage** (`2026-06-09…cr3…design.md`):
- §2/§3 retire `gated` (method + `SourceStatus.gated` field + put gated-rejection); `source_detail` "resolved by tau at runtime"; `put` ref-exempts Local + WorkloadIdentity → Task 1. ✓
- §4 ts-rs `SourceStatus` without `gated` → Task 2 (regen + verify). ✓
- §5 editor: all eight addable (no disabled group), TokenBroker URL ref input, WorkloadIdentity no-ref label, neutral ↗ runtime note vs amber ⚠, save sends `ref:null` for Local+WI → Task 3. ✓
- §6 tests: resolver/store units (Task 1), integration token_broker→200 + WI→200 + empty-broker-ref→422 (Task 2), editor + ProvidersPage fixture (Task 3), e2e (Task 4). ✓
- §7 out of scope (real exchange/attestation, gateway-as-broker, per-source connection) — not implemented; documented.

**Placeholder scan:** none.

**Type consistency:** `SourceStatus` drops `gated` (Rust + ts-rs `{kind, ref, configured, detail}`); every consumer updated — `status_for` no longer sets it, the editor never read it (used the `GATED_KINDS` const, now removed), and the two test fixtures (`CredentialChainEditor.test.tsx`, `ProvidersPage.test.tsx`) drop the `gated` key. `source_detail` returns `"resolved by tau at runtime"` for `TokenBroker|WorkloadIdentity` — matched verbatim in the gateway unit test, the integration test, and the editor's neutral-note test (`RUNTIME_RESOLVED` + `text-accent` + `↗`). `put` ref-exemption (`Local | WorkloadIdentity`) matches the editor's `ref: local||workload_identity ? null : r.ref` save mapping and the integration test (WI no-ref → 200, TokenBroker empty-ref → 422). `ADDABLE_KINDS` (8 kinds) / `KIND_PLACEHOLDER` (token_broker URL added) / `RUNTIME_RESOLVED` use the snake_case `SourceKind` union.

**Note for executor:** after Task 1, `grep -n "gated" gateway/src/credentials/mod.rs` must be empty (catches a missed reference). The unrelated `gated` usages elsewhere (Sidebar, ShipPage, StubPage, GraphEditor, `Provider.credentials_gated`, etc.) are different features — do NOT touch them. The e2e locates the TokenBroker ref input by placeholder (not `ref 0`) because prior suite tests leave `anthropic` with a non-empty chain.
