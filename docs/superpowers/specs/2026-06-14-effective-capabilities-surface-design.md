# Effective-Capabilities Surface — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming)
**Area:** gateway + web

## Problem

tau is "capability-safe by construction": every agent has a computed
*effective capability set* — the union of what its tools may touch
(filesystem paths, network hosts, spawnable commands, byte limits). tau
ships this today via `tau list agents --capabilities --json` and records
a parallel form in built bundles. **None of it is visible in the UI.**

The Config page is titled "Config & Capabilities" but has no capabilities
section — only Project metadata, a read-only Agents table, and a gated
Credentials block. This feature fills that gap with a live, read-only
project-wide audit view: *"what can each agent in this project actually
touch?"*

## Decisions (locked in brainstorming)

1. **Source — live.** `tau list agents --capabilities --json`, computed
   from the current `tau.toml`. Works with no build step; always in sync
   with edits. *Not* the bundle-recorded `effective_capabilities` (that is
   a bundle-inspector concern for the Ship page, deferred).
2. **Placement — Config & Caps page.** A new "Effective Capabilities" card
   between the Agents card and the gated Credentials card. No new nav item,
   no new route.
3. **Read-only.** Display only. Writing capability overrides back to
   `tau.toml` is a separate, larger feature and is out of scope.

## Data source

`tau list agents --capabilities --json` emits an array of agent rows
(`crates/tau-cli/src/cmd/list.rs`):

```jsonc
[
  {
    "id": "researcher",
    "display_name": "Researcher",
    "package": "weather-tools",
    "llm_backend": "anthropic",
    // Omitted (None) when the flag is unset OR the package is not installed.
    // Present-but-empty ([]) when the agent is genuinely sandboxed to nothing.
    "effective_capabilities": [
      { "kind": "fs.read",        "allow_paths": ["./src/**"], "deny_paths": [] },
      { "kind": "fs.write",       "allow_paths": ["out/**"],   "deny_paths": [], "max_bytes": 1048576 },
      { "kind": "net.http",       "allow_hosts": ["api.weather.com"], "deny_hosts": [] },
      { "kind": "process.spawn",  "allow_commands": ["curl"],  "deny_commands": [] }
    ]
  }
]
```

Per-kind fields (mirrors the `tau.toml` schema): `allow_paths`/`deny_paths`
for `fs.*`; `allow_hosts`/`deny_hosts` for `net.http`;
`allow_commands`/`deny_commands` for `process.spawn`/`exec`; `max_bytes`
for `fs.write`. Since we always pass `--capabilities`, a **missing**
`effective_capabilities` means *package not installed* (distinct from an
empty list = *fully sandboxed*). The design preserves this distinction.

## Architecture

### Gateway (Rust) — `gateway/src/caps/mod.rs`

Follows the established CLI-delegation adapter pattern (`checks/`,
`sessions/`): ts-rs-exported types + a `Source` trait with a `Cli*` and a
`Mock*` implementation, selected by `AppState` based on `is_mock`.

**Types** (ts-rs `#[ts(export)]`), shaped 1:1 with tau's JSON so parsing is
a near-passthrough:

```rust
pub struct CapabilityRow {
    pub kind: String,
    pub allow_paths: Option<Vec<String>>,
    pub deny_paths: Vec<String>,         // serde default
    pub allow_hosts: Option<Vec<String>>,
    pub deny_hosts: Vec<String>,
    pub allow_commands: Option<Vec<String>>,
    pub deny_commands: Vec<String>,
    pub max_bytes: Option<u64>,          // ts-rs → bigint; see Number(...) note
}

pub struct AgentCapabilities {
    pub agent_id: String,
    pub display_name: String,
    pub llm_backend: String,
    pub effective: Option<Vec<CapabilityRow>>,  // None = package not installed
}
```

**Trait + impls:**

```rust
pub trait CapsSource: Send + Sync {
    fn agent_capabilities(&self) -> anyhow::Result<Vec<AgentCapabilities>>;
}
```

- `CliCaps` — shells `tau list agents --capabilities --json` in the
  project dir, deserializes the agent-row array, maps `id → agent_id` and
  `effective_capabilities → effective`. Surfaces a non-zero exit / parse
  failure as an `Err`.
- `MockCaps` — deterministic researcher / writer / greeter sample (matching
  the approved mockup: greeter = `Some([])` sandboxed-to-nothing). Used
  under `--serve-kind mock` and in tests.

Wired into `AppState` alongside the other sources; add
`state.agent_capabilities()`.

**Endpoint** (`gateway/src/api/`): `GET /api/projects/{pid}/capabilities`
→ `Json<Vec<AgentCapabilities>>`. A **separate** path (not
`/agents/capabilities`, which would collide with the existing
`/agents/{id}` param route). Errors map to `502 BAD_GATEWAY`, consistent
with `agents::list`. Registered in the per-project (scoped) router in
`api/mod.rs`.

### Web (React/TS)

- `web/src/api/caps.ts` → `getCapabilities(pid): Promise<AgentCapabilities[]>`,
  using the shared api client and the ts-rs-generated bindings. Per the
  ts-rs note, `max_bytes` arrives as `bigint`; format via `Number(x ?? 0)`
  before display.
- `web/src/config/CapabilitiesCard.tsx` — fetches on mount; renders one row
  per agent with capability chips grouped by kind (green allow-list, red
  deny-list, `≤ N` for `max_bytes`). Two empty states:
  - `effective === null` → "unavailable — package not installed"
  - `effective === []` → "no capabilities — fully sandboxed"
  - Fetch failure → inline error message **and** `surfaceError(...)` toast
    (reusing the notify layer), without breaking the rest of the page.
- Mounted in `ConfigPage.tsx` between the Agents card and the Credentials
  card.

## Data flow

```
ConfigPage mounts
  └─ CapabilitiesCard → getCapabilities(pid)
       └─ GET /api/projects/{pid}/capabilities
            └─ CapsSource::agent_capabilities()
                 └─ CliCaps: `tau list agents --capabilities --json`
                      └─ parse → Vec<AgentCapabilities> → JSON → render
```

## Error handling

| Condition | Gateway | UI |
|---|---|---|
| tau missing / command fails / bad JSON | `Err` → `502` | inline error + toast; rest of page intact |
| package not installed (tau omits caps) | `effective: None` | "unavailable — package not installed" |
| agent sandboxed to nothing | `effective: Some([])` | "no capabilities — fully sandboxed" |
| no agents in project | `[]` | empty-state line in the card |

## Testing

**Gateway**
- `CliCaps` parse test against a captured `tau list … --json` fixture
  (covers populated caps, `None`, and `Some([])` rows).
- `MockCaps` determinism test.
- Endpoint test: mock state → `GET /capabilities` returns `200` + expected
  shape.

**Web** (vitest, run via `./node_modules/.bin/vitest` in fresh worktrees;
`pnpm install` first)
- `CapabilitiesCard`: renders allow/deny chips and `≤ N`; sandboxed-to-
  nothing (`Some([])`); unavailable (`None`); error path (mocked
  `getCapabilities` rejection → inline error + toast).

Each implementation task includes `format:check` (prettier) per the
per-task-gate convention.

## Out of scope (YAGNI)

- Editing / writing capability overrides back to `tau.toml`.
- Bundle-recorded `effective_capabilities` source (Ship-page / conformance
  concern; revisit with β.6).
- Tool-level provenance (which tool contributed a capability) — tau does
  not expose it via `tau list`.
