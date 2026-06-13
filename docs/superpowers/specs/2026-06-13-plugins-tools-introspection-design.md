# Plugins + Tools real introspection — design

Date: 2026-06-13
Track: handoff `01-plugins-tools-introspection`
Status: approved (brainstorming), pending spec review

## Goal

Replace the **mock** Tools catalog and the **fully-mock** Plugins tab in tau-ui
with real data sourced from `tau`. Shippable today with no tau-side change.

## Verified tau seam (corrects the handoff premise)

The handoff assumed *"a plugin's advertised methods + JSON schemas ARE the
tools."* Verification against `/Users/titouanlebocq/code/tau` shows that is
wrong:

- A plugin advertises a single **port**: `Tool` | `LlmBackend` | `Storage` |
  `Sandbox`. The `handshake.methods` are *protocol verbs* for that port
  (`tool.call`, `tool.describe`, `llm.complete`, …), **not** a list of
  individual tools.
- A `Tool`-port plugin = **exactly one tool**. There is no per-tool method
  namespace.

Therefore the real model is **one `Tool`-port plugin → one Tools-catalog
entry**. `LlmBackend`/`Storage`/`Sandbox` plugins appear only on the Plugins
tab.

### `tau plugin describe <pkg> --json`

Verified at `crates/tau-cli/src/cmd/plugin/describe.rs:83-102`. Shape:

```jsonc
{
  "package": "<name>",
  "package_version": "<semver>",
  "source": "<source>",
  "binary_path": "<path>",
  "manifest": { "provides": "<Debug>", "kind": "<Debug>", "bin": "<...>" },
  "handshake": {
    "protocol_version": "<string>",
    "provides": "<PortKind Debug: Tool|LlmBackend|Storage|Sandbox>",
    "plugin_name": "<name>",
    "plugin_version": "<semver>",
    "methods": ["tool.call", "tool.describe", ...],
    "schemas": { "<method>": { "params": <JSON Schema>, "result": <JSON Schema> } }
  }
}
```

Sharp edges (verified):

- `describe` **spawns the plugin binary**, drives one `meta.handshake`, then
  shuts it down. One package per call; **no batch verb**. The CLI applies a
  **30s handshake timeout**.
- `manifest.provides`/`manifest.kind` and `handshake.provides` are Rust `{:?}`
  **debug strings** (e.g. `"RustCargo"`, `"Tool"`), not clean JSON enums.
- `handshake.protocol_version` is serialized as a **string**.
- `describe` does **not** call `tool.describe_capabilities`, so capabilities are
  **not** in its output.

### Plugin vs data-only detection

`tau list packages --all --json` rows are flat
`{name, version, source, scope, version_count}` — **no `kind` field**, so the
gateway cannot pre-filter. Plugin-ness is discovered by describing. A data-only
package errors with **exit code 2** and stderr containing
`"has no [plugin] table in its tau.toml ... nothing to describe"` — emitted
**before** any spawn, so it is cheap. The gateway never links tau crates, so the
lockfile `[plugin]` table is not directly readable: detection is by describe
exit + stderr only.

## Architecture

### New module: `gateway/src/introspect/mod.rs`

The single "describe loop" feeding both tabs.

- **Sweep**: `tau list packages --all --json` → `tau plugin describe <pkg>
  --json` per package.
- **Classification** per package: `Plugin(PluginInfo)` | `DataOnly` (dropped) |
  `Failed(IntrospectError)`.
- **Cache**: per-project `Mutex<Option<{ built_at, Vec<Classified> }>>`, **60s
  TTL**, plus explicit `invalidate()`. First request after expiry blocks and
  rebuilds. Background refresh is out of scope.
- **Concurrency + timeout**: describe with a **cap of 4** parallel children
  (`std::thread::scope`), each child killed at **15s** wall-clock (poll
  `try_wait` + `kill`; reader threads drain stdout/stderr to avoid pipe
  deadlock). A hung plugin becomes `Failed{timeout}`, never hangs the route.

```rust
#[derive(Debug, thiserror::Error)]
enum IntrospectError {
    #[error("tau binary not runnable: {0}")]
    TauSpawn(String),
    #[error("`tau list packages` failed: {0}")]
    ListFailed(String),
    #[error("describe {pkg:?} failed: {detail}")]
    Describe { pkg: String, detail: String },
    #[error("describe {pkg:?} timed out")]
    Timeout { pkg: String },
    #[error("describe {pkg:?} output did not parse: {detail}")]
    Parse { pkg: String, detail: String },
}
// DataOnly is a classification, not an error:
// nonzero exit AND stderr contains "[plugin] table".
```

`PluginIntrospector { bin, project, cache }` is built once in `state.rs` when
`!is_mock`, wrapped in `Arc`, and injected into **both** `CliPlugins` and
`CliTools`. Mock variants are untouched.

### Mapping describe output → existing contract types

No type churn beyond the two response envelopes.

| target field | source | note |
|---|---|---|
| `name` / `version` / `source` | `package` / `package_version` / `source` | |
| `binary` | `binary_path` | |
| `kind` | `manifest.kind` | normalize `"RustCargo"`→`"rust-cargo"` |
| `port` | `handshake.provides` | pass-through `Tool`/`LlmBackend`/`Storage`/`Sandbox` |
| `protocol_version` (u32) | `handshake.protocol_version` (string) | parse leniently, fallback `1` |
| `describe.tool` | `schemas["tool.call"].params` properties | **only** when `port=="Tool"`, else `None` |
| `describe.capabilities` | — | `[]` — describe doesn't return them (documented limitation) |
| `transcript` | synthesized | 2 frames: `out meta.handshake`, `in result(handshake)` |

### Tools catalog (corrected model)

`CliTools.catalog()` = sweep filtered to `port == "Tool"`, each plugin → **one**
`ToolDetail` (`name = handshake.plugin_name`, schema from `tool.call` params,
`provides:"tool"`, `capabilities:[]`). `used_by` stays computed by `list_tools()`
matching the tool name against agents'/skills' `requires_tools`, unchanged.
`LlmBackend`/`Storage`/`Sandbox` plugins never appear here.

Limitation: `describe` does not return the `ToolSpec` name, so the tool name is
the plugin's self-declared `handshake.plugin_name`. `used_by` matching relies on
that equalling the name agents/skills reference (the established convention).

### Routes / contract changes

- `GET /api/projects/{pid}/plugins` → **`PluginCatalog { plugins: PluginDetail[],
  errors: PluginError[] }`** (was `PluginDetail[]`). [decision A]
- `GET /api/projects/{pid}/tools` → **`ToolCatalog { tools: ToolDetail[],
  error_count: number }`** (was `ToolDetail[]`). [decision B]
- New `PluginError { package: String, kind: String, message: String }`.
- ts-rs regenerates `PluginCatalog`, `ToolCatalog`, `PluginError` into
  `web/src/types`.

Rationale (decisions resolved in brainstorming):
- **A — plugins envelope**: failures are first-class on the tab that owns
  plugins; matches the handoff's "per-plugin error rows, not a dead tab."
- **B — tools flat + count**: a failed introspection is fundamentally a *plugin*
  fact. The Tools tab is a filtered projection, so it shows the tools plus a
  pointer notice; full error detail lives in one place (the Plugins tab),
  avoiding duplicated error rendering across two tabs.

### Web changes

- `PluginsTab`: remove the mock banner and `gated` badge; consume
  `{ plugins, errors }`; render healthy plugins (existing list/detail) **plus**
  error rows (`package ⚠ kind — message`).
- `ToolsTab`: consume `{ tools, error_count }`; when `error_count > 0`, render a
  one-line notice *"N plugin(s) failed to introspect — see the Plugins tab."*
- `ToolsPage`: remove the `gated` badge from the Plugins tab button.
- `web/src/api/tools.ts` + `plugins.ts`: update return types to the envelopes;
  update their contract tests.

### Cache invalidation

`package install/uninstall/update` already route through `CliOps` on
`AppState`. Those handlers call `introspector.invalidate()` so the next tab load
re-sweeps. Mock path: no-op.

## Test strategy

- **Gateway**: a fixture plugin binary (or recorded describe stdout/stderr +
  exit) drives the sweep. Assert: classification of Plugin / DataOnly /
  Failed(timeout) / Failed(parse); the `tool.call`→`ToolDetail` projection
  (port filter + schema extraction); cache hit within TTL and rebuild after
  `invalidate()`; a hung child is killed at the timeout and yields
  `Failed{timeout}`.
- **Web**: stub fetch with the new envelopes. Plugins tab renders healthy plugins
  + error rows and no `gated` badge; Tools tab renders tools + the count notice;
  API contract tests assert the scoped paths and decoded envelope shapes.
- Every frontend task gate runs `prettier` (per-task gates omit `format:check`).

## Task breakdown (for the parallel implementation handoff)

1. `introspect` module + `IntrospectError` + cache/concurrency/timeout (gateway,
   no route change yet) — unit-tested against fixtures.
2. `CliPlugins`/`CliTools` rewired to the introspector + `state.rs` wiring +
   `invalidate()` hooks on package install/uninstall/update.
3. Route + contract change to envelopes + regenerate ts-rs types (gateway).
4. Web: PluginsTab un-gate + error rows; API fn + tests.
5. Web: ToolsTab count notice + ToolsPage badge removal; API fn + tests.

Sequencing: 1→2→3 sequential (gateway); 4 & 5 parallelize once 3 lands the
contract.

## Out of scope

- `tau plugin run` / `protocol decode` (debug-tier, not inventory).
- Plugin *install* (already works via packages).
- Background cache refresh (first-load-after-expiry blocks; acceptable for v1).
- Real `capabilities` for plugins/tools (describe doesn't expose them).
- Any new tau verb.
</invoke>
