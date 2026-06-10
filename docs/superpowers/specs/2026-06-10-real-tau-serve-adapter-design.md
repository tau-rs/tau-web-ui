# D1 — Real `tau serve` run-path foundation — design

**Status:** approved (brainstorm 2026-06-10)
**Sub-project:** D1 of the real-tau integration roadmap (D1 run-path → D2 inventory → D3 validate/ship → D4 workflow/IR). See the roadmap memory.
**Relates to:** `gateway/src/serve_client/` (the JSON-RPC/NDJSON client), `gateway/src/adapters/serve.rs` (RunEvent→Span), `gateway/src/state.rs` (launch/error mapping), `gateway/src/projects/mod.rs` (`is_mock`, `bin`), `gateway/src/main.rs` (flags), `gateway/src/credentials/mod.rs` (the chain), `fake-tau-serve/` (the test oracle), `fixtures/demo/`, `docs/tau-contract-v1.md`.

## 1. Context & goal

`tau serve` is now shipped (JSON-RPC 2.0 over NDJSON on stdio; `meta.handshake` → `runtime.run_streaming` emitting `runtime.event` notifications → final `RunOutcome`; `runtime.cancel`; `RunEvent` kinds `TextDelta`/`ToolCallStarted`/`ToolCallCompleted`/`TurnCompleted`/`RunCompleted`/`FatalError`; error codes `-32000..-32010`). See the `tau-serve-unimplemented` memory for the full contract.

**Key reframing:** the gateway *already speaks this protocol* end-to-end — `fake-tau-serve` was built faithful to `docs/tau-contract-v1.md`, and `is_mock` does **not** gate the run path (it switches only the non-run sidecars in `state.rs`). So D1 is **not a protocol rewrite**. It is: (1) fix the spawn invocation so a real `tau` binary is launched correctly, (2) bridge credentials into the subprocess env so real runs authenticate, (3) map real failure modes to clean run states, and (4) verify the whole path against a locally-built tau using **Ollama** as the LLM (no cloud key), keeping `fake-tau-serve` as the deterministic test oracle.

**Goal:** the gateway drives a real `tau serve` subprocess for runs, verified end-to-end with Ollama, with the UI credential chain injected into the child env for cloud backends.

## 2. Locked decisions (brainstorm)

- **Spawn = Approach A (uniform invocation).** Always spawn `<bin> serve --project <path> --ready-on-stderr [--no-sandbox]`. Teach `fake-tau-serve` to accept-and-ignore a leading `serve` token so the mock and real tau are invoked identically; the spawn path stops depending on filename-sniffing.
- **Explicit binary kind.** Add a `--serve-kind real|mock` gateway flag (default: autodetect from filename, preserving today's behavior). Stored as `is_mock` on the registry; used by the D2–D4 sidecar seams and to select verification fixtures — **not** by the (now uniform) spawn path.
- **Credentials bridge = Local + Env only.** At spawn, inject readable secrets as env vars on the child. `SecretManager`/`TokenBroker`/`WorkloadIdentity` are **not** injected (the gateway never resolves their values — consistent with the existing "resolved by tau at runtime" stance; tau's own resolution is β.5, unbuilt).
- **Verify with Ollama locally; no cloud key.** A cloud key cannot be minted by the assistant. The credentials bridge is proven *mechanically* (child-env inspection), and the run path is proven *live* against Ollama.
- **`fake-tau-serve` stays the deterministic oracle** for unit + Playwright e2e. The real-tau+Ollama smoke lane is gated/skippable and out of the default CI gate.
- **Out of scope:** all Cli* sidecar seams (D2–D4); live cloud verification; SecretManager/Broker/WI secret resolution; backend/model-selection UX beyond running Ollama.

## 3. Spawn path (uniform invocation)

- `gateway/src/serve_client/mod.rs::spawn` — change the command from `Command::new(bin).arg("--project")…` to insert the subcommand: `Command::new(bin).arg("serve").arg("--project").arg(path).arg("--ready-on-stderr")` plus `--no-sandbox` when configured. Everything downstream (ready-on-stderr wait, reader pump, NDJSON framing, handshake, `runtime.run_streaming`, `runtime.cancel`) is unchanged.
- `fake-tau-serve/src/main.rs` — at startup, if the first positional arg is `serve`, skip it before parsing `--project`/`--ready-on-stderr`. Mock behavior otherwise unchanged.
- **Binary kind:** `gateway/src/main.rs` parses `--serve-kind real|mock`; when absent, fall back to the current filename autodetect (`contains("fake-tau-serve")`). Thread the resolved `is_mock` into `ProjectRegistry::load` (replacing the internal-only filename computation as the *source of truth*, while keeping autodetect as the default). The spawn path no longer reads `is_mock`.

## 4. Credentials → env bridge

A new, independently-testable unit (e.g. `gateway/src/serve_client/credential_env.rs` or a function in `credentials/mod.rs`):

```
fn credential_env(creds: &Credentials, backends: &[&str], env_get: &dyn Fn(&str)->Option<String>)
    -> Vec<(String /*var*/, String /*value*/)>
```

- For each LLM backend configured in the project (at minimum the backends referenced by the project's agents; a conservative default is the known cloud backends `anthropic`, `openai`):
  - Walk that backend's source chain (reusing `resolve`/`source_configured`).
  - If the winning source is **Local**, read the stored secret from `credentials.secrets.json` and emit `(canonical_var, value)`.
  - If the winning source is **Env**, read the referenced env var's value (already in the gateway's env) and emit it under the **canonical** var name (alias when `reference != canonical`). If `reference == canonical`, it's already inherited — emitting is harmless/idempotent.
  - If the winner is **SecretManager/TokenBroker/WorkloadIdentity** or nothing is configured, emit nothing for that backend.
- **Canonical var map** (matches tau plugin defaults): `anthropic → ANTHROPIC_API_KEY`, `openai → OPENAI_API_KEY`. `ollama` → none.
- At spawn, apply these via `Command::envs(...)` *after* inheriting the gateway env, so injected vars win. **Never log secret values** (log only var names / counts).

## 5. Real-failure handling

In `gateway/src/state.rs` (and the serve_client error surfacing), map serve outcomes to `RunStatus`:

| Serve outcome | Code | Run state | UI |
|---|---|---|---|
| Cancelled | `-32001` | `Cancelled` | (existing) |
| LLM error | `-32008` | `Failed` | `Run.error` = message |
| Tool error | `-32009` | `Failed` | message |
| Capability denied | `-32007` | `Failed` | message |
| Runtime error | `-32006` | `Failed` | message |
| Project error | `-32005` | `Failed` | message |
| Unknown agent | `-32010` | `Failed` | message |
| Server busy | `-32004` | `Failed` | message |
| Child crash / stdout close | `-32603` | `Failed` (all in-flight) | message; client respawns next run |
| Handshake/protocol mismatch | `-32000` | surfaced at client init | degrade gracefully; gateway stays up |

The frontend already renders `Run.error`; the work is ensuring each code path lands a clear, non-empty message and the correct terminal status (not a perpetual `Running`).

## 6. Verification (local, no cloud key)

- **Build tau** for this arch (`cargo build` in `/Users/titouanlebocq/code/tau`, READ-ONLY otherwise — never modify tau source); point the gateway at it via `--tau-bin`/`TAU_BIN`.
- **Ollama fixture:** add a verification project (or extend a non-`demo` fixture so the canned mock specs are untouched) with an agent declaring `llm_backend = "ollama"` and `[agents.<id>.config] model = "mistral"` (a tool-capable pulled model; `base_url` defaults to `http://localhost:11434`). Confirm a tool-capable model is pulled before asserting tool calls; a plain completion (no tool) is the minimal assertion.
- **Live smoke tests — gated/skippable** (skip when `tau` binary or Ollama is unavailable, mirroring tau's own `live.rs` gating):
  - handshake lists the fixture's agent(s);
  - a full streamed Ollama run emits `TextDelta` → `TurnCompleted` → `RunCompleted`, persists spans to the JSONL store, and reports `token_usage.total_tokens > 0`;
  - cancel mid-run yields `Cancelled`;
  - a cloud-backed agent with no key yields `Failed` with an `LLM_ERROR`-derived message.
- **Credentials-bridge test — deterministic, no key:** assert a resolved **Local** secret appears in the child's environment. Implement by extending `fake-tau-serve` with a tiny `meta.env` probe (returns whether/what a named env var is set — value-presence only, never echoed to logs) **or** a pure unit test of `credential_env`. Prefer the unit test for the value, plus one mock-env round-trip for the spawn wiring.
- **Regression:** all existing mock unit tests + Playwright e2e stay green with the mock now invoked as `… serve …`.

## 7. Test-double strategy

- `fake-tau-serve` remains the deterministic oracle for the default unit + e2e gate (canned greeter/researcher), invoked uniformly with `serve`.
- A new **smoke lane** (e.g. an ignored-by-default test group or an env-gated module) runs against real tau + Ollama. It is **not** in the default `cargo test` / CI gate (no model in CI); it's a local confidence check and a documented manual step.

## 8. Components (boundaries)

1. **Invocation** — `serve_client::spawn` (insert `serve`) + `fake-tau-serve` arg parse (skip leading `serve`). Smallest possible diff to the hot path.
2. **`credential_env`** — pure resolve→`Vec<(var,value)>` builder; unit-testable without spawning.
3. **Error mapping** — `state.rs` outcome→`RunStatus`+message.
4. **Kind flag** — `main.rs` `--serve-kind` + registry threading (default autodetect).
5. **Verification** — Ollama fixture + gated smoke tests + the deterministic bridge test.

Each unit is independently testable; only #1 and #3 touch the live run path, and both are small.

## 9. Testing summary

- **Unit:** `credential_env` (Local→inject, Env→alias, Manager/Broker/WI→skip, unconfigured→skip; never includes a value for unreadable kinds); serve error-code→`RunStatus` mapping.
- **Integration (mock, default gate):** existing `serve_client_e2e` / `run_orchestration` / `ws_e2e` stay green under `… serve …` invocation; one mock-env round-trip proving injected vars reach the child.
- **Smoke (real tau + Ollama, gated):** handshake, full streamed run, cancel, no-key cloud failure.
- **E2e (Playwright, mock):** unchanged and green.

## 10. Out of scope / roadmap

- Cli* sidecar seams → **D2** (inventory: tools/plugins/packages/skills + cloner), **D3** (validate/ship: `tau check`/`build`/`verify`/`target`), **D4** (workflow runner + IR inspector).
- Live cloud (Anthropic/OpenAI) verification — needs an operator-supplied key.
- SecretManager/TokenBroker/WorkloadIdentity secret resolution — tau β.5; the bridge deliberately skips them today.
