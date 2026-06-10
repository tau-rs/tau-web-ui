# Credentials chain — CR-2 (SecretManager providers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ungate the four SecretManager source kinds (`vault`, `aws_kv`, `gcp_kv`, `azure_kv`) in the CR-1 credential chain — each references a secret path, resolves "configured" via a pure ambient-env presence check, and surfaces a per-source `detail` hint — with no secret ever fetched or stored.

**Architecture:** Extend the pure resolver in `gateway/src/credentials/mod.rs` with four per-manager arms + a `source_detail` helper; shrink `gated()` to only TokenBroker/WorkloadIdentity; add `SourceStatus.detail`. The `CredentialChainEditor` ungates the four (addable with a `ref` input + placeholder) and renders the `detail` hint. No new routes, no SDKs; resolution = presence/validation (the real fetch/use stays the runtime seam, same as CR-1).

**Tech Stack:** Rust (axum, serde, ts-rs); React 18, TS, Tailwind, Vitest, Playwright. Spec: `docs/superpowers/specs/2026-06-09-credentials-chain-cr2-secretmanagers-design.md`. Builds on CR-1 (`gateway/src/credentials/mod.rs`, `web/src/providers/CredentialChainEditor.tsx`).

---

## File Structure

**Gateway — Modify:** `gateway/src/credentials/mod.rs` (resolver arms + `source_detail` + `SourceStatus.detail` + `status_for` + `put` validation + update the now-invalid CR-1 unit tests), `gateway/tests/credentials_api.rs` (update the gated assertion). **Regenerated:** `web/src/types/SourceStatus.ts`.
**Frontend — Modify:** `web/src/providers/CredentialChainEditor.tsx` (ungate + ref inputs + detail hint), `web/src/providers/CredentialChainEditor.test.tsx` (update gating test + add manager/detail tests), `web/e2e/run.spec.ts` (e2e).

---

## Task 1: Gateway resolver — ungate managers + `source_detail` + `SourceStatus.detail`

**Files:** Modify `gateway/src/credentials/mod.rs`.

- [ ] **Step 1: Shrink `gated()`** — replace the `gated` method body:

```rust
impl SourceKind {
    /// Not yet wired (the TokenBroker/WorkloadIdentity path is CR-3).
    pub fn gated(self) -> bool {
        matches!(self, SourceKind::TokenBroker | SourceKind::WorkloadIdentity)
    }
}
```

- [ ] **Step 2: Add `detail` to `SourceStatus`** — add the field (after `gated`):

```rust
pub struct SourceStatus {
    pub kind: SourceKind,
    #[serde(rename = "ref")]
    #[ts(rename = "ref")]
    pub reference: Option<String>,
    pub configured: bool,
    pub gated: bool,
    pub detail: Option<String>, // non-secret hint, e.g. "VAULT_ADDR not set"; None when configured
}
```

- [ ] **Step 3: Replace `source_configured` with the four manager arms** (exhaustive match, no catch-all):

```rust
/// Whether one source can resolve, given local-secret presence + an env lookup.
/// CR-2: SecretManager kinds are "configured" when their `ref` is set AND the
/// manager's ambient-connection env is present (no secret is fetched).
pub fn source_configured(
    s: &SourceConfig,
    has_local: bool,
    env_get: &dyn Fn(&str) -> Option<String>,
) -> bool {
    let ref_present = s.reference.as_deref().map(|r| !r.is_empty()).unwrap_or(false);
    let env_set = |k: &str| env_get(k).map(|v| !v.is_empty()).unwrap_or(false);
    match s.kind {
        SourceKind::Local => has_local,
        SourceKind::Env => s
            .reference
            .as_deref()
            .and_then(env_get)
            .map(|v| !v.is_empty())
            .unwrap_or(false),
        SourceKind::Vault => ref_present && env_set("VAULT_ADDR"),
        SourceKind::AwsKv => ref_present && (env_set("AWS_REGION") || env_set("AWS_DEFAULT_REGION")),
        SourceKind::GcpKv => {
            ref_present
                && (env_set("GOOGLE_APPLICATION_CREDENTIALS") || env_set("GOOGLE_CLOUD_PROJECT"))
        }
        SourceKind::AzureKv => ref_present && env_set("AZURE_KEYVAULT_URL"),
        SourceKind::TokenBroker | SourceKind::WorkloadIdentity => false, // gated (CR-3)
    }
}
```

- [ ] **Step 4: Add `source_detail`** (immediately after `source_configured`):

```rust
/// A non-secret hint about why a source is (un)configured. `None` when configured.
pub fn source_detail(
    s: &SourceConfig,
    has_local: bool,
    env_get: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    if source_configured(s, has_local, env_get) {
        return None;
    }
    let ref_empty = s.reference.as_deref().map(|r| r.is_empty()).unwrap_or(true);
    let missing = |label: &str| Some(format!("{label} not set"));
    match s.kind {
        SourceKind::Local => Some("no value stored".to_string()),
        SourceKind::Env if ref_empty => Some("ref is empty".to_string()),
        SourceKind::Env => missing(s.reference.as_deref().unwrap_or("")),
        _ if ref_empty => Some("ref is empty".to_string()),
        SourceKind::Vault => missing("VAULT_ADDR"),
        SourceKind::AwsKv => missing("AWS_REGION"),
        SourceKind::GcpKv => missing("GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_CLOUD_PROJECT"),
        SourceKind::AzureKv => missing("AZURE_KEYVAULT_URL"),
        SourceKind::TokenBroker | SourceKind::WorkloadIdentity => Some("waits on CR-3".to_string()),
    }
}
```

- [ ] **Step 5: Populate `detail` in `status_for`** — add the field to the `SourceStatus { … }` construction:

```rust
            .map(|s| SourceStatus {
                kind: s.kind,
                reference: s.reference.clone(),
                configured: source_configured(s, has_local, &env_get),
                gated: s.kind.gated(),
                detail: source_detail(s, has_local, &env_get),
            })
```

- [ ] **Step 6: Update `put` validation** — require a non-empty `ref` for every kind except Local (replaces the Env-only check). Replace the Env empty-ref block:

```rust
            if !matches!(s.kind, SourceKind::Local)
                && s.reference.as_deref().unwrap_or("").is_empty()
            {
                return Err(PutError::Invalid(
                    "this source kind requires a non-empty ref".to_string(),
                ));
            }
```

Also update the gated-rejection message (drop the stale "in CR-1"):

```rust
            if s.kind.gated() {
                return Err(PutError::Invalid(format!("source kind {:?} is gated", s.kind)));
            }
```

- [ ] **Step 7: Update the now-invalid CR-1 unit tests + add CR-2 tests.** In `mod resolver_tests`, REPLACE the `gated_never_resolves` test with:

```rust
    #[test]
    fn gated_kinds_are_only_broker_and_workload() {
        // gated kinds never resolve, even with a ref
        let tb = [src(SourceKind::TokenBroker, Some("https://broker"))];
        assert_eq!(resolve(&tb, true, &no_env), (false, None));
        assert!(SourceKind::TokenBroker.gated());
        assert!(SourceKind::WorkloadIdentity.gated());
        // CR-2: the SecretManager kinds are NOT gated
        for k in [SourceKind::Vault, SourceKind::AwsKv, SourceKind::GcpKv, SourceKind::AzureKv] {
            assert!(!k.gated());
        }
        assert!(!SourceKind::Env.gated());
        assert!(!SourceKind::Local.gated());
    }

    #[test]
    fn managers_resolve_with_ref_and_ambient_env() {
        let vault = src(SourceKind::Vault, Some("secret/data/x"));
        let addr = |k: &str| (k == "VAULT_ADDR").then(|| "http://v:8200".to_string());
        assert!(source_configured(&vault, false, &addr));
        assert!(!source_configured(&vault, false, &no_env)); // VAULT_ADDR missing
        assert!(!source_configured(&src(SourceKind::Vault, None), false, &addr)); // ref missing

        let aws = src(SourceKind::AwsKv, Some("prod/key"));
        assert!(source_configured(&aws, false, &|k: &str| (k == "AWS_REGION").then(|| "us-east-1".to_string())));
        assert!(source_configured(&aws, false, &|k: &str| (k == "AWS_DEFAULT_REGION").then(|| "eu-west-1".to_string())));

        let gcp = src(SourceKind::GcpKv, Some("projects/p/secrets/x"));
        assert!(source_configured(&gcp, false, &|k: &str| (k == "GOOGLE_CLOUD_PROJECT").then(|| "p".to_string())));

        let azure = src(SourceKind::AzureKv, Some("x"));
        assert!(source_configured(&azure, false, &|k: &str| (k == "AZURE_KEYVAULT_URL").then(|| "https://v.vault.azure.net".to_string())));
    }

    #[test]
    fn source_detail_explains_status() {
        let vault = src(SourceKind::Vault, Some("secret/x"));
        assert_eq!(source_detail(&vault, false, &no_env).as_deref(), Some("VAULT_ADDR not set"));
        let addr = |k: &str| (k == "VAULT_ADDR").then(|| "http://v".to_string());
        assert_eq!(source_detail(&vault, false, &addr), None); // configured → no detail
        assert_eq!(
            source_detail(&src(SourceKind::Vault, None), false, &addr).as_deref(),
            Some("ref is empty"),
        );
        assert_eq!(
            source_detail(&src(SourceKind::AwsKv, Some("k")), false, &no_env).as_deref(),
            Some("AWS_REGION not set"),
        );
        assert_eq!(
            source_detail(&src(SourceKind::TokenBroker, Some("https://b")), false, &no_env).as_deref(),
            Some("waits on CR-3"),
        );
    }
```

(The existing `local_resolves_when_value_present`, `env_resolves_when_var_set`, `first_match_wins`, `empty_chain_unresolved` tests are unchanged and still pass.)

In `mod store_tests`, REPLACE `put_rejects_gated_and_duplicate_kinds` with:

```rust
    #[test]
    fn put_rejects_gated_duplicate_and_empty_ref() {
        let dir = tempfile::tempdir().unwrap();
        let c = Credentials::new(dir.path().to_path_buf());
        // gated (token_broker / workload_identity) → rejected
        assert!(c.put("x", vec![cfg(SourceKind::TokenBroker, Some("https://b"))], None).is_err());
        // duplicate kind → rejected
        assert!(c
            .put("x", vec![cfg(SourceKind::Env, Some("A")), cfg(SourceKind::Env, Some("B"))], None)
            .is_err());
        // empty ref on a non-Local kind → rejected (Env and managers alike)
        assert!(c.put("x", vec![cfg(SourceKind::Env, None)], None).is_err());
        assert!(c.put("x", vec![cfg(SourceKind::Vault, None)], None).is_err());
        // CR-2: a SecretManager WITH a ref is accepted
        let st = c.put("x", vec![cfg(SourceKind::Vault, Some("secret/x"))], None).unwrap();
        assert_eq!(st.sources[0].kind, SourceKind::Vault);
        assert!(!st.sources[0].gated);
        assert!(!st.sources[0].configured); // no VAULT_ADDR in the test env
        assert!(st.sources[0].detail.is_some());
    }
```

- [ ] **Step 8: Run the unit tests** — `cargo test -p tau-gateway --lib credentials` → PASS (the resolver + store suites, now including the 3 updated/new tests). `cargo build -p tau-gateway` clean.

- [ ] **Step 9: Commit**

```bash
git add gateway/src/credentials/mod.rs
git commit -m "feat(gateway): ungate SecretManager credential sources + per-source detail"
```

---

## Task 2: Integration test + ts-rs binding + rust gate

**Files:** Modify `gateway/tests/credentials_api.rs`; regenerated `web/src/types/SourceStatus.ts`.

- [ ] **Step 1: Replace the gated assertion in `gateway/tests/credentials_api.rs`.** Find the existing block that PUTs a `vault` source and asserts 422, and replace it with the CR-2 assertions (a vault source is now accepted; `token_broker` is the gated one; an empty manager ref is rejected):

```rust
    // CR-2: a vault source is now accepted (200), ungated, with a detail hint.
    let v = http
        .put(format!("{base}/api/credentials/vaulted"))
        .json(&serde_json::json!({ "sources": [{ "kind": "vault", "ref": "secret/data/x" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(v.status(), reqwest::StatusCode::OK);
    let vst: serde_json::Value = v.json().await.unwrap();
    assert_eq!(vst["sources"][0]["gated"], false);
    // VAULT_ADDR is typically unset in CI → not configured + a detail hint. Don't hard-assert
    // the ambient-env-dependent `configured`; just check that an unconfigured source has a detail.
    if vst["sources"][0]["configured"] == false {
        assert!(vst["sources"][0]["detail"].is_string());
    }

    // a gated kind (token_broker) → 422
    let gated = http
        .put(format!("{base}/api/credentials/x"))
        .json(&serde_json::json!({ "sources": [{ "kind": "token_broker", "ref": "https://b" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(gated.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);

    // a manager with an empty ref → 422
    let empty = http
        .put(format!("{base}/api/credentials/x"))
        .json(&serde_json::json!({ "sources": [{ "kind": "vault" }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(empty.status(), reqwest::StatusCode::UNPROCESSABLE_ENTITY);
```

(Leave the rest of the test — the anthropic local PUT/GET/DELETE assertions — unchanged. The `vaulted` backend is a fresh name in the same ephemeral tempdir; no collision.)

- [ ] **Step 2: Build mock + run gateway tests (regenerates ts-rs)** — `cargo build -p fake-tau-serve && cargo test -p tau-gateway` → PASS (lib `credentials` + `credentials_api` + all existing). Confirm `git status --porcelain fixtures/demo` empty.

- [ ] **Step 3: Verify the binding** — `cat web/src/types/SourceStatus.ts` → now includes `detail: string | null,` alongside `kind, ref, configured, gated`.

- [ ] **Step 4: Rust gate** — `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green (run `cargo fmt --all` first if needed; fix any clippy warning in the new code — NOT the pre-existing ts-rs "failed to parse serde attribute" notes).

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/credentials_api.rs web/src/types/SourceStatus.ts
git commit -m "test(gateway): credentials integration covers ungated managers + SourceStatus.detail binding"
```

---

## Task 3: Frontend editor — ungate managers + ref inputs + detail hint

**Files:** Modify `web/src/providers/CredentialChainEditor.tsx`, `web/src/providers/CredentialChainEditor.test.tsx`.

- [ ] **Step 1: Update the kind groups + add placeholders** in `CredentialChainEditor.tsx`. Replace the `REAL_KINDS`/`GATED_KINDS` consts (the `KIND_LABEL` map is unchanged) with:

```tsx
const ADDABLE_KINDS: SourceKind[] = ["env", "local", "vault", "aws_kv", "gcp_kv", "azure_kv"];
const GATED_KINDS: SourceKind[] = ["token_broker", "workload_identity"];
const KIND_PLACEHOLDER: Partial<Record<SourceKind, string>> = {
  env: "ANTHROPIC_API_KEY",
  vault: "secret/data/anthropic",
  aws_kv: "prod/anthropic-key",
  gcp_kv: "projects/PROJECT/secrets/anthropic",
  azure_kv: "anthropic",
};
```

- [ ] **Step 2: Add the per-kind status lookup** — after the `used` line (`const used = …`), add:

```tsx
  const statusByKind = new Map((status?.sources ?? []).map((s) => [s.kind, s]));
```

- [ ] **Step 3: Update the save mapping** — a `ref` is sent for everything except Local. Change the `sources` map in `save()`:

```tsx
    const sources: SourceConfig[] = rows.map((r) => ({
      kind: r.kind,
      ref: r.kind === "local" ? null : r.ref,
    }));
```

- [ ] **Step 4: Render a ref input for env + all managers (only Local stays text), plus the detail hint.** Replace the row's input/text block + the remove button (the `{r.kind === "env" ? (<input…/>) : (<span…/>)}` through the remove `<button>`) with:

```tsx
            {r.kind === "local" ? (
              <span className="flex-1 text-[10px] text-muted">resolves from the local store</span>
            ) : (
              <input
                aria-label={`${KIND_LABEL[r.kind]} ref ${i}`}
                placeholder={KIND_PLACEHOLDER[r.kind]}
                value={r.ref}
                onChange={(e) => setRef(i, e.target.value)}
                className={`flex-1 font-mono ${field}`}
              />
            )}
            {(() => {
              const st = statusByKind.get(r.kind);
              return st && !st.configured && st.detail ? (
                <span className="flex-none text-[9px] text-amber-700">⚠ {st.detail}</span>
              ) : null;
            })()}
            <button
              type="button"
              aria-label={`remove ${KIND_LABEL[r.kind]}`}
              onClick={() => remove(i)}
              className="text-xs text-muted hover:text-st-error"
            >
              ✕
            </button>
```

- [ ] **Step 5: Update the add-source menu** — change the addable list from `REAL_KINDS` to `ADDABLE_KINDS` (the gated block already maps `GATED_KINDS`, now just the 2):

```tsx
        {ADDABLE_KINDS.filter((k) => !used.has(k)).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => add(k)}
            className="rounded border border-accent/40 px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent/10"
          >
            {KIND_LABEL[k]}
          </button>
        ))}
```

(The gated `GATED_KINDS.map(...)` block below it is unchanged — it now renders only Token broker / Workload identity, disabled.)

- [ ] **Step 6: Update the test `CredentialChainEditor.test.tsx`.** Keep test 1 ("adds a Local source…") unchanged. REPLACE test 2 ("disables gated source kinds…") with the new gating assertion, and ADD a Vault-add test + a detail-hint test. The full `describe` block becomes:

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
    const put = calls.find(([u, o]) => u.includes("/api/credentials/anthropic") && o?.method === "PUT");
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
      const put = calls.find(([u, o]) => u.includes("/api/credentials/anthropic") && o?.method === "PUT");
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
        { kind: "vault", ref: "secret/data/anthropic", configured: false, gated: false, detail: "VAULT_ADDR not set" },
      ],
      resolved: false,
      resolved_via: null,
    };
    render(<CredentialChainEditor backend="anthropic" status={status} onSaved={() => {}} />);
    expect(screen.getByText(/VAULT_ADDR not set/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run + typecheck + prettier** — `cd web && npx vitest run src/providers/CredentialChainEditor.test.tsx` → PASS (4 tests); `pnpm typecheck` clean; `npx prettier --write src/providers/CredentialChainEditor.tsx src/providers/CredentialChainEditor.test.tsx`.

- [ ] **Step 8: Commit**

```bash
git add web/src/providers/CredentialChainEditor.tsx web/src/providers/CredentialChainEditor.test.tsx
git commit -m "feat(web): ungate SecretManager sources in the chain editor + detail hints"
```

---

## Task 4: E2e + final gate

**Files:** Modify `web/e2e/run.spec.ts`.

- [ ] **Step 1: Append the e2e spec** (read the file first for conventions):

```ts
test("providers: add a Vault source — ungated, shows the ambient-env hint", async ({ page }) => {
  await page.goto("/projects/demo/providers");
  const row = page.getByRole("row").filter({ hasText: "anthropic" });
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.getByRole("button", { name: "set credential" }).click();
  await expect(page.getByText(/credential chain — anthropic/i)).toBeVisible();
  // Token broker stays gated; Vault is now addable
  await expect(page.getByRole("button", { name: "Token broker" })).toBeDisabled();
  await page.getByRole("button", { name: "Vault" }).click();
  await page.getByLabel("Vault ref 0").fill("secret/data/anthropic");
  await page.getByRole("button", { name: /^save$/i }).click();
  // VAULT_ADDR is unset in the dev env → the saved source shows its ambient-env hint
  await expect(page.getByText(/VAULT_ADDR not set/i)).toBeVisible();
});
```

- [ ] **Step 2: Clear the dev credential store, kill stale servers, rebuild, run e2e**

The dev gateway's `data_root` is `$HOME/.tau-web-ui` (no `--data-dir` in `web/playwright.config.ts`). A previous run may have left an `anthropic` credential, which would make the editor open with an existing chain (so the "Vault" add-button could be deduped if a vault source already exists, or anthropic could already resolve). Clear it for determinism:

```bash
rm -f "$HOME/.tau-web-ui/credentials.toml" "$HOME/.tau-web-ui/credentials.secrets.json"
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. `web/playwright.config.ts` auto-starts the servers (`reuseExistingServer: !CI`). REAL ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; else `pnpm exec playwright test --list` to confirm parse + defer e2e to CI, then proceed with Steps 3–5 (unit gate must be green).

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
git commit -m "test(web): e2e add a Vault credential source (ungated + ambient-env hint)"
```

---

## Self-Review

**Spec coverage** (`2026-06-09-credentials-chain-cr2-secretmanagers-design.md`):
- §3 per-manager resolution (`source_configured` four arms; the env-requisite table VAULT_ADDR / AWS_REGION|AWS_DEFAULT_REGION / GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLOUD_PROJECT / AZURE_KEYVAULT_URL) + `source_detail` + `gated()` shrink + `SourceStatus.detail` + `status_for` + `put` non-empty-ref validation → Task 1. ✓
- §4 API (no new routes; PUT accepts managers, 422 for the 2 gated/duplicate/empty-ref) + ts-rs `detail` → Tasks 1–2. ✓
- §5 editor (ungate four, per-manager ref inputs + placeholders, detail hint, save sends ref for non-Local, badge unchanged) → Task 3. ✓
- §6 tests: resolver/detail units (Task 1), integration without env mutation (Task 2), editor (Task 3), e2e (Task 4). ✓
- §7 out of scope (real fetch/probe, per-source connection, CR-3) — not implemented; documented.

**Placeholder scan:** none.

**Type consistency:** `SourceStatus` gains `detail: Option<String>` (Rust) ⇒ ts-rs `detail: string | null` ⇒ consumed in the editor via `statusByKind.get(kind).detail` and in the test fixture. `source_configured`/`source_detail` share the same `(s, has_local, env_get)` signature and the env-var names match across both + the spec table. The editor's save sends `ref: kind === "local" ? null : r.ref`, matching the gateway's "non-Local requires a non-empty ref" rule and `SourceConfig { kind, ref }`. `ADDABLE_KINDS`/`GATED_KINDS`/`KIND_PLACEHOLDER` use the snake_case `SourceKind` union. The CR-1 tests that asserted Vault-is-gated (`resolver_tests::gated_never_resolves`, `store_tests::put_rejects_gated_and_duplicate_kinds`, editor test 2) are explicitly updated in Tasks 1 + 3.

**Note for executor:** the resolver reads real `std::env::var` in `status_for`, so the integration test (Task 2) does NOT assert the ambient-env-dependent `configured` unconditionally (only that an unconfigured source has a `detail`) — env-present resolution is unit-tested via injected `env_get` (Task 1). The e2e clears `~/.tau-web-ui/credentials.*` first so `anthropic` starts with an empty chain. Credentials never touch `fixtures/demo`.
