# Credentials chain — CR-3 (TokenBroker / WorkloadIdentity) — design

**Status:** approved (brainstorm 2026-06-10)
**Builds on:** CR-1 (chain core + Env/Local) and CR-2 (SecretManagers). CR-3 ungates the **last two** source kinds — `token_broker` and `workload_identity` — completing the credential chain. This is the **final** credentials sub-project.
**Relates to:** the Providers screen credential chain editor (`web/src/providers/CredentialChainEditor.tsx`) + the gateway resolver (`gateway/src/credentials/mod.rs`).

## 1. Goal

Let an operator add the **TokenBroker** (the OIDC/OAuth2 BFF path — a token broker or thin AI gateway like Cloudflare/Portkey/LiteLLM/Kong) and **WorkloadIdentity** (SPIFFE / IRSA / GKE — "no static secret") sources to a backend's credential chain.

**CR-3 is UI-only — it is the *configuration surface*, not a resolver.** Unlike Env/Local/SecretManagers (which have a cheap, standard, offline "is the ambient config present?" pre-flight), these two resolve only via a *live* token exchange or *live* platform identity attestation — which is genuinely **tau's runtime job** (tau ships the provider chain). The gateway must NOT reimplement that. So the gateway lets you *configure* these sources and explicitly reports their resolution as **deferred to tau at runtime**; it performs **no detection/validation** for them.

## 2. Locked decisions (brainstorm)

- **UI-only scope.** The gateway does not detect/validate TokenBroker or WorkloadIdentity. Resolution is tau's at the point of use (the documented runtime seam). Their per-source status is a neutral **"resolved by tau at runtime"**, never a ✓ (configured) or ⚠ (misconfigured).
- **TokenBroker has a `ref` = the broker / AI-gateway URL.** Required (non-empty), like the other ref-carrying kinds.
- **WorkloadIdentity is ref-less** ("no static secret" — there is nothing to point at), exactly like Local. The `put` non-empty-ref rule is relaxed to exempt Local **and** WorkloadIdentity.
- **Retire the `gated` concept.** After CR-3 no kind is gated. Remove `SourceKind::gated()`, the `put` gated-rejection, the editor's disabled-button group, and `SourceStatus.gated` (it's superseded by the `detail` note). The two kinds become addable.
- **No new gateway resolution logic, no env requisites, no SDKs** for the two — that's the whole point.

## 3. Gateway (`gateway/src/credentials/mod.rs`)

- **`source_configured`**: `TokenBroker | WorkloadIdentity => false` (unchanged behavior — the gateway never resolves them).
- **`source_detail`**: `TokenBroker | WorkloadIdentity => Some("resolved by tau at runtime")` (replacing the CR-2 `"waits on CR-3"`).
- **Retire `gated`**:
  - Remove the `SourceKind::gated()` method.
  - Remove the `gated` field from `SourceStatus` and its population in `status_for` (ts-rs regenerates the binding without it).
  - Remove the gated-rejection branch in `Credentials::put`.
- **`put` ref validation** becomes: reject (422) any source whose kind is **not** `Local` and **not** `WorkloadIdentity` and whose `ref` is empty. (So Env + SecretManagers + TokenBroker require a non-empty ref; Local + WorkloadIdentity are ref-exempt.) Duplicate-kind rejection unchanged.
- `resolve` / `manager_env_vars` unchanged. A backend whose only source is one of these resolves to `(false, None)` in the gateway — honest, since the gateway can't confirm a runtime credential.

## 4. ts-rs

`SourceStatus` loses `gated` → `web/src/types/SourceStatus.ts` regenerates as `{ kind, ref, configured, detail }`. (`SourceKind` unchanged.) Drift gate as usual.

## 5. Frontend (`CredentialChainEditor.tsx`)

- **All eight kinds addable.** `ADDABLE_KINDS` includes `token_broker` and `workload_identity`; remove `GATED_KINDS` and the disabled-button `.map(...)` block.
- **`KIND_PLACEHOLDER`** gains `token_broker: "https://gateway.ai.cloudflare.com/v1/…"`. WorkloadIdentity has no placeholder (no input).
- **Per-row input:** Local **and** `workload_identity` render the text label (Local: "resolves from the local store"; WorkloadIdentity: "uses this machine's ambient identity") instead of a ref input. Env, SecretManagers, and TokenBroker render the ref input.
- **Neutral runtime note:** a const `RUNTIME_RESOLVED: SourceKind[] = ["token_broker", "workload_identity"]`. The per-source hint renders:
  - if `RUNTIME_RESOLVED.includes(kind)` and there's a status source for it → a neutral **`↗ resolved by tau at runtime`** (muted/accent color, not amber);
  - else (Env/manager unconfigured) → the existing amber **`⚠ {detail}`**.
  Both read `detail` from the `statusByKind` lookup; only the styling/icon differs by kind group.
- **Save mapping:** `ref: (r.kind === "local" || r.kind === "workload_identity") ? null : r.ref` (Local + WorkloadIdentity send no ref; TokenBroker sends its URL).
- **Remove the `gated` references:** with the `gated` field gone from `SourceStatus`, ensure no editor/ProvidersPage code reads `status.sources[].gated` (CR-2 used the frontend `GATED_KINDS` const, not the field — confirm and drop any stray usage).
- **Providers screen badge** unchanged: a backend resolved only by a runtime-resolved kind still shows "🔒 none" (the gateway can't confirm); the editor's "↗ resolved by tau at runtime" note explains it.

## 6. Testing

**Gateway:**
- Unit (resolver): `source_detail` for `TokenBroker`/`WorkloadIdentity` = `"resolved by tau at runtime"`; both `source_configured` = false; no `gated()` method remains (its removal compiles).
- Unit (store): `put` accepts `token_broker` **with** a ref and `workload_identity` **without** a ref (200); rejects `token_broker` with an empty ref (Err); still rejects a duplicate kind; (no gated rejection exists anymore).
- Integration (`credentials_api.rs`): update the CR-2 `token_broker → 422` assertion — `token_broker` with a ref now **succeeds (200)**, its source carries `detail == "resolved by tau at runtime"` and no `gated` field; `workload_identity` (no ref) → **200**; `token_broker` with an empty ref → **422**.
- ts-rs drift gate (`SourceStatus` without `gated`).

**Web (vitest):**
- `CredentialChainEditor`: all eight add-source buttons render (no disabled group); adding `Token broker` shows a ref input and PUTs `{kind:"token_broker", ref:"<url>"}`; adding `Workload identity` shows NO ref input and PUTs `{kind:"workload_identity", ref:null}`; a status source for a runtime-resolved kind renders the neutral `↗ resolved by tau at runtime` note (not the amber ⚠).
- `ProvidersPage`: unchanged behavior (the CR-1/CR-2 tests still pass; if any referenced `gated` on a status fixture, drop it).

**E2e (Playwright):**
- In the chain editor, add a **Token broker** source + URL ref, and a **Workload identity** source (no ref), Save → both persist; the Workload-identity row shows "↗ resolved by tau at runtime"; no add-source button is disabled.

## 7. Out of scope (YAGNI) / roadmap

- **Real token exchange / identity attestation** — the live OIDC/OAuth2 exchange and SPIFFE/IRSA/GKE attestation are **tau's runtime** providers; the gateway hands resolution to tau (the documented seam). This is deliberate, per the UI-only scope.
- **The gateway acting as the token broker itself** (minting short-lived tokens) — a much larger BFF feature; not in CR-3.
- **Per-source connection overrides** — ambient model only, as in CR-2.
- **After CR-3:** the credential chain is complete (all 8 kinds). The remaining roadmap item is **C — non-determinism representation** (blocked on tau's β.2 Workflow IR).
