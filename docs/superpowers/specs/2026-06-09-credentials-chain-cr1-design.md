# Credentials chain — CR-1 (chain core + Env + Local) — design

**Status:** approved (brainstorm 2026-06-09)
**Relates to:** Product IA surface ② (Configure) and the Providers screen (`/projects/:pid/providers`). Picks up the gated **"🔒 Set API key"** seam left by `2026-06-02-agent-providers-and-node-display-design.md` §7.
**Sub-project of:** "Credentials handling", decomposed along tau's credential-provider chain into **CR-1** (this spec), **CR-2** (SecretManager providers — Vault/AWS/GCP/Azure KV), **CR-3** (TokenBroker / WorkloadIdentity — the BFF path). CR-1 builds the chain mechanism + the two local providers; CR-2/CR-3 add Strategy providers to it.

## 1. Goal

Let an operator give each LLM backend (`anthropic`, `openai`, …) a **credential**, resolved through an **ordered source chain** (first source that resolves wins) — tau's "provider chain, never a vault" model, with the **tau-web-ui gateway acting as the parent-app credential resolver** (the role tau's philosophy and serve-mode NG9 assign to the parent app: *"credentials are referenced by handle; the parent app provides the actual values… serve mode ships no credential API"*).

CR-1 ships **two real source kinds** — **Env** (reference an environment variable by name) and **Local** (capture a write-only secret value into a 0600 file) — plus the chain resolver, a **global** (per-gateway/machine) store, the `/api/credentials` routes, and the Providers-screen **inline credential-chain editor**. The richer source kinds (SecretManager, TokenBroker, WorkloadIdentity) are **foreshadowed but disabled** in the UI and land in CR-2/CR-3.

## 2. Locked decisions (brainstorm)

- **Per-backend ordered chain.** Each backend has an ordered `sources` list; resolution walks it top-to-bottom, **first that resolves wins** (tau's chain semantics).
- **v1 real sources = Env + Local.** Env stores only a var *name* (no secret); Local stores the secret *value*, write-only, in a 0600 file. SecretManager (vault / aws-kv / gcp-kv / azure-kv), token-broker, and workload-identity are shown as **disabled 🔒** entries in the "add source" menu (foreshadowing the full chain) and are addable/resolvable only in CR-2/CR-3.
- **Scope: global per gateway (per machine).** One credential config for the whole gateway, stored in the gateway `data_root`, surfaced read/write on every project's Providers screen. The routes are **top-level/global** (`/api/credentials…`), not under `/api/projects/:pid`.
- **Write-only, never echoed.** No endpoint ever returns a secret value. Status shows `resolved` + `resolved_via` + per-source `configured` + the Env `ref`, never the Local value.
- **UI: inline expand.** The Providers row's "Set credential" expands in place to show the chain editor (not a drawer/modal).
- **Mock/real seam is thin.** The resolver/store/UI are real in both mock and real modes (Env/Local read the OS env + a local file, not `tau serve`). The single future-gated seam is injecting a resolved credential into a *real* `tau serve` subprocess (serve ships no credential API; the runtime mechanism is β.5; `fake-tau-serve` makes no real calls).

## 3. Credential model + store (gateway)

### 3.1 Types (`gateway/src/credentials/mod.rs`, ts-rs-exported)

```rust
#[derive(Serialize, Deserialize, TS, Clone, PartialEq)]
#[ts(export)]
pub enum SourceKind {
    Env,             // real (v1)
    Local,           // real (v1)
    Vault, AwsKv, GcpKv, AzureKv,  // gated (CR-2)
    TokenBroker, WorkloadIdentity, // gated (CR-3)
}

#[derive(Serialize, Deserialize, TS, Clone)]
#[ts(export)]
pub struct SourceConfig {
    pub kind: SourceKind,
    pub r#ref: Option<String>, // Env: var name; CR-2/3: addr/path/url; Local: None
}

// Status returned by the API — NEVER carries a secret value.
#[derive(Serialize, Deserialize, TS, Clone)]
#[ts(export)]
pub struct SourceStatus {
    pub kind: SourceKind,
    pub r#ref: Option<String>,
    pub configured: bool, // Env: var is set; Local: a value is stored; gated: false
    pub gated: bool,      // true for non-(Env|Local) kinds in v1
}

#[derive(Serialize, Deserialize, TS, Clone)]
#[ts(export)]
pub struct BackendCredentialStatus {
    pub backend: String,
    pub sources: Vec<SourceStatus>,
    pub resolved: bool,
    pub resolved_via: Option<SourceKind>,
}
```

`SourceKind` serializes lowercase/snake (`env`, `local`, `vault`, `aws_kv`, …) via serde rename for stable TS/JSON.

### 3.2 Store (two files under `data_root`, both `0600`)

- **`<data_root>/credentials.toml`** — non-secret config. Per backend, the ordered source list. **No values.**
  ```toml
  [backends.anthropic]
  sources = [ { kind = "local" }, { kind = "env", ref = "ANTHROPIC_API_KEY" } ]
  ```
- **`<data_root>/credentials.secrets.json`** — `{ "<backend>": "<local-value>" }`, the Local values, `0600`. Loaded only for resolution and write; **never** serialized to any API response.

Invariants: a backend's `sources` has **at most one entry per kind** (the chain is an ordered set of kinds to try). The Local value is keyed by `backend` (one Local secret per backend). Removing the Local source (or `DELETE`) clears the backend's secret.

### 3.3 Resolver (pure, unit-tested)

```rust
// env/secret lookups injected for testability
pub fn source_configured(s: &SourceConfig, has_local: bool, env_get: &dyn Fn(&str) -> Option<String>) -> bool;
pub fn resolve(sources: &[SourceConfig], has_local: bool, env_get: &dyn Fn(&str) -> Option<String>) -> (bool, Option<SourceKind>);
```

- `Env` configured ⇔ `env_get(ref)` is `Some` (non-empty). `Local` configured ⇔ `has_local`. Gated kinds ⇔ `false`.
- `resolve` walks `sources` in order; the first `configured` source sets `resolved=true` and `resolved_via=Some(kind)`; none → `(false, None)`.

### 3.4 Gateway-global state

The store lives at the **gateway-global** level (beside `ProjectRegistry`'s `data_root`/`is_mock`), not per-project `AppState`. A small `Credentials` component (holding `data_root` + a `Mutex` guarding the read-modify-write of the two files) provides `status_all()`, `status(backend)`, `put(backend, sources, local_value: Option<String>)`, `delete(backend)`, each reading/writing the files and computing status via the resolver. Env presence is read through an injectable accessor (`Fn(&str) -> Option<String>`) defaulting to `std::env::var`, so the resolver is testable without mutating process env. `ProjectRegistry` exposes the store to the global handlers (a `reg.credentials()` accessor bound to `data_root`).

## 4. API (gateway, global routes)

Top-level routes (on the `ProjectRegistry` state, beside `/api/projects`):

- `GET /api/credentials` → `Json<Vec<BackendCredentialStatus>>` (one per configured backend). No values.
- `PUT /api/credentials/:backend` → body `{ sources: SourceConfig[], local_value?: string }`; persists the ordered sources; if `local_value` present, writes the Local secret (write-only); if the source list has no `Local` kind, clears any stored secret; `local_value` omitted ⇒ keep existing. Returns the backend's `BackendCredentialStatus`. **422** if `sources` contains a gated kind in v1 (only `env`/`local` accepted) or duplicate kinds.
- `DELETE /api/credentials/:backend` → removes the backend's config + secret. Returns `{ ok: true }`.

`r#ref` JSON key is `"ref"`. The PUT validates: kinds ∈ {env, local}; unique kinds; `env` requires a non-empty `ref`.

## 5. Frontend

### 5.1 API client (`web/src/api/credentials.ts`) — **global, not scoped**

```ts
// uses "/api/credentials" directly (NOT scopedPath — credentials are per-machine)
getCredentials(): Promise<BackendCredentialStatus[]>
putCredential(backend, body: { sources: SourceConfig[]; local_value?: string }): Promise<BackendCredentialStatus>
deleteCredential(backend): Promise<{ ok: boolean }>
```

A `apiPath(p)` helper (or inline `/api${p}`) — the existing `scopedPath` is project-scoped, so credentials use a sibling global path. Same ok-checking `json<T>` helper.

### 5.2 Providers screen (`web/src/providers/ProvidersPage.tsx`)

- On mount, also `getCredentials()` (alongside `getProviders()`), keyed by backend name.
- The per-row **credential** cell becomes a status badge derived from the join: **✓ via local** / **✓ via env** / **🔒 none** (replacing the old gated, always-disabled "🔒 Set API key" button), plus a **"Set credential" / "edit"** toggle.
- Clicking it **expands the row inline** (layout A) to render `<CredentialChainEditor backend=… status=… onSaved=…/>` beneath the row.

### 5.3 Credential chain editor (`web/src/providers/CredentialChainEditor.tsx`)

- Renders the backend's ordered `sources` as editable rows: a **kind** label/select, a **ref** field for Env (var name), a **masked write-only value** field for Local, a **remove** (✕), and **reorder** (move up/down; drag optional). 
- **"+ add source"** menu: `Env` and `Local` enabled; `Vault / AWS KV / GCP KV / Azure KV / Token broker / Workload identity` shown **disabled with 🔒** (title "waits on CR-2/CR-3").
- **Save** → `putCredential(backend, { sources, local_value })` (local_value only sent when the user typed a new one), then `onSaved()` re-fetches credentials so the badge updates. The Local value input is write-only (never pre-filled from status — status carries no value; shows a "configured" hint when already set).
- A small **"✓ resolves via <kind>"** / **"🔒 unresolved"** line from the returned status.

## 6. Testing

**Gateway:**
- Unit (resolver): Env-set resolves; Local-present resolves; `[Local, Env]` → `via=local`; gated skipped; empty → unresolved; `source_configured` per kind.
- Unit (store): config round-trips through `credentials.toml`; secrets file written `0600`; status derivation never reads/echoes the secret value.
- Integration: `PUT /api/credentials/anthropic` with `local_value` → `GET` shows `resolved:true, resolved_via:"local"`, **no value field anywhere**; `DELETE` clears; an `env`-source whose var is **unset** shows `configured:false`/`resolved:false`; a gated/duplicate-kind PUT → 422. (The env-set → `resolved_via:"env"` path is covered by the resolver unit test via the injected env accessor — integration tests do **not** mutate process-global env, to stay parallel-safe.)
- ts-rs drift gate for the four new types.

**Web (vitest):**
- `credentials.ts` hits `/api/credentials` (not a scoped path).
- `CredentialChainEditor`: add/remove/reorder source rows; gated kinds disabled in the add-menu; the Local value field is masked + write-only; Save posts the expected PUT body (local_value only when typed).
- `ProvidersPage`: joins credential status → the row badge (✓ via local / ✓ via env / 🔒 none); "Set credential" expands the row inline.

**E2e (Playwright):**
- `/projects/demo/providers` → expand the `anthropic` row → add a **Local** source → type a value → Save → the row badge becomes **✓ via local**; a gated source kind is disabled in the add-menu.

**Security invariants (explicit assertions):**
- No API response (`GET`/`PUT`/`DELETE`) contains a secret value.
- `credentials.secrets.json` is created with `0600` permissions.

## 7. Out of scope (YAGNI) / roadmap

- **CR-2 — SecretManager providers** (Vault / AWS / GCP / Azure KV): add these as Strategy providers + enable their menu entries (configure by address/path; resolution against mocks). The store schema (`SourceConfig { kind, ref }`) and resolver chain already accommodate them.
- **CR-3 — TokenBroker / WorkloadIdentity** (the browser-sanctioned BFF path: OIDC/OAuth2 short-lived tokens, SPIFFE/IRSA/GKE identity).
- **Real subprocess injection** — handing a resolved credential to a *real* `tau serve` runtime credential mechanism (serve ships no credential API; β.5). The documented future seam; CR-1 resolves + holds, the real handoff lands when tau's engine does.
- **OS keychain source** (macOS Keychain / libsecret) — a possible future Local-equivalent provider; not in CR-1 (a plain 0600 file is the v1 Local backing store, matching tau's File provider).
- **Per-project credential overrides** — not built; scope is global per gateway (machine-level keys).
- **Secret rotation / expiry / audit** — not in CR-1.
