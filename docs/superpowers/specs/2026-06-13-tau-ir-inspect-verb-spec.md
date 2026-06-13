# Spec — `tau ir inspect --json` read verb (tau repo)

**Date:** 2026-06-13
**Target repo:** `/Users/titouanlebocq/code/tau`
**Status:** Ready to implement as its own tau PR. **This PR is the gate** for the
tau-ui "Compiled IR" render (see companion design
`2026-06-13-workflow-ir-build-path-design.md`).
**Scope:** one new read verb. No changes to lowering, the bundle format, or the
interpreter.

---

## 1. Motivation

tau-ui's GraphEditor draws the **source** workflow (`workflows/<name>.toml`
step list). We want it to also show the **compiled** project IR — the truth that
executes: resolved per-agent tools, lowered subflow edges (agent→tool), the
capability table, and the target triple.

The tau-ui gateway is forbidden from linking tau crates — it only shells out and
parses `--json` (every existing seam: `skill list --json`, `check --json`,
`plugin describe --json`, `target list --json`, `build --json`,
`verify --json`). The compiled IR currently lives only as opaque
`canonical_ir_bytes_hex` inside a v2 bundle manifest, which the gateway cannot
decode. So **tau must expose a verb that lowers/decodes and emits the `IrModule`
as JSON.** That verb is `tau ir inspect`.

Rejected alternatives (validated against the repo, do not relitigate):
- **Gateway links `tau-ir` to decode the hex** — breaks the shell-out boundary,
  couples two repos at build time, treats an internal `no_std` crate as a public
  API. No.
- **`tau build --emit-ir` flag** — `tau build` always writes a `.tau` artifact;
  overloading it conflates "produce artifact" with "read-only inspect" and fights
  tau's clean read-verb convention. No.

## 2. Confirmed repo facts (the lift is small)

- **`IrModule` and every nested type derive `Serialize`/`Deserialize`.**
  `crates/tau-ir/src/module.rs:40`. serde is **non-optional** in
  `crates/tau-ir/Cargo.toml` (`features = ["alloc","derive"]`). The canonical
  encoder is literally `serde_json::to_vec(module)`
  (`crates/tau-ir/src/canonical.rs:25`). ⇒ `serde_json::to_string(&module)` works
  with zero new serde code.
- **Decoder exists.** `from_canonical_bytes(&[u8]) -> Result<IrModule,
  serde_json::Error>` (`crates/tau-ir/src/canonical.rs:31`), already used by
  `tau run --bundle` (`crates/tau-cli/src/cmd/ir_dispatcher.rs`).
- **Lowering is callable standalone.** `lower_project(config: &ProjectConfig,
  target: &TargetTriple, caches: &Caches) -> Result<IrModule, IrError>`
  (`crates/tau-ir/src/lower/mod.rs:61`). `tau build` already calls it via
  `lower_ir(project_root, target)` (`crates/tau-cli/src/cmd/build.rs:95-152`).
- **IR is PROJECT-scoped.** `lower_project` lowers the whole `tau.toml` (all
  agents/tools/steps) into **one** `IrModule` with **one** `workflow` field. It
  has **no workflow selector**. `workflows/<name>.toml` files are a separate
  orchestration model owned by the `tau-workflow` crate
  (`crates/tau-workflow/src/model.rs`) and are NOT part of IR lowering. ⇒ the
  verb is project-scoped; it takes **no `--workflow` flag**.
- **The lower path uses stand-in caches.** `build.rs` lowers with
  `native_tool = |name| sha256(name)`, `mcp_contract = |_| None`,
  `skill = |_| None`. ⇒ the lowered hash is a **placeholder**, not the
  reproducible content hash. The output must label this honestly (see §4
  `hash_kind`).
- **Bundle payload.** `IrPayload { ir_format, canonical_ir_hash,
  canonical_ir_bytes_hex }` with `canonical_ir_bytes()` hex-decode helper, on
  `BundleManifest.ir_payload: Option<IrPayload>`
  (`crates/tau-pkg/src/bundle/manifest.rs:12-59`). `None` for v1 bundles.
- **CLI conventions.** `Command` enum is clap-derive with nested subcommand
  groups (`Skill`, `Target`, `Workflow`) (`crates/tau-cli/src/cli.rs:140-189`).
  Per-subcommand `--json` is idiomatic (`SkillShowArgs { name, #[arg(long)] json,
  … }`); a `global = true` `--json` also exists (`cli.rs:38-41`). Handlers are
  `pub async fn run(args, output: &mut Output) -> anyhow::Result<()>` under
  `crates/tau-cli/src/cmd/`, dispatched from `lib.rs`. JSON is emitted with
  `output.json(&value)` (compact, stdout) guarded by `output.is_json()`
  (`crates/tau-cli/src/output.rs:52-120`); errors are `anyhow` mapped to exit
  codes via `ExitCode`.

## 3. Verb surface

A new nested subcommand group `ir`, mirroring `skill`/`target`/`workflow`:

```
tau ir inspect [--target <triple>] [--json]      # lower the cwd project (default)
tau ir inspect --bundle <path> [--json]          # decode the IR inside a built v2 bundle
```

### clap wiring (`crates/tau-cli/src/cli.rs`)

```rust
// in `enum Command`
/// Inspect the compiled workflow IR.
#[command(subcommand)]
Ir(IrSubcommand),

#[derive(Debug, clap::Subcommand)]
pub enum IrSubcommand {
    /// Lower the project (or decode a bundle) and emit the compiled IR.
    Inspect(IrInspectArgs),
}

#[derive(Debug, clap::Args)]
pub struct IrInspectArgs {
    /// Target triple to lower for. Defaults to the host triple.
    /// Ignored (and rejected) together with --bundle: the bundle carries its target.
    #[arg(long, conflicts_with = "bundle")]
    pub target: Option<String>,

    /// Decode the IR baked into an existing v2 bundle instead of lowering the cwd project.
    #[arg(long)]
    pub bundle: Option<PathBuf>,

    /// Emit canonical JSON (the IR inspect envelope) instead of a human summary.
    #[arg(long)]
    pub json: bool,
}
```

Dispatch: add `Command::Ir(sub) => cmd::ir::dispatch(sub, output).await` in
`lib.rs`; `cmd/ir/mod.rs::dispatch` matches `IrSubcommand::Inspect(args) =>
inspect::run(&args, output).await`.

### Behaviour

- **Default (lower):** read `tau.toml` from cwd exactly as `build.rs::lower_ir`
  does — `toml::from_str::<UncheckedProjectConfig>` → `.validate()` → build the
  same stand-in `Caches` → `lower_project(&config, &target, &caches)`. `target`
  = `--target` parsed via `TargetTriple` or `TargetTriple::host()`.
- **`--bundle <path>` (decode):** read the bundle manifest; if
  `ir_payload.is_none()` (v1 bundle) error (see §5); else
  `payload.canonical_ir_bytes()` → `tau_ir::from_canonical_bytes(&bytes)` →
  `IrModule`. Reuse the exact decode the `ir_dispatcher` already performs.

## 4. Output contract

A small **envelope** wrapping the `IrModule`, so the consumer can read the
hash + its provenance without ambiguity. New serializable struct in
`cmd/ir/inspect.rs` (compact JSON, one line, to stdout via `output.json`):

```jsonc
{
  "schema": "ir-inspect/v1",          // envelope version, NOT the IR format version
  "hash_kind": "lowered",             // "lowered" (stand-in caches) | "bundle" (real)
  "canonical_ir_hash": "9f3a…e1",     // lowercase hex sha-256
  "module": {                         // the verbatim IrModule (serde_json::to_value)
    "ir_format": "v1.0.0",
    "tau_version": "0.4.1",
    "target": "darwin-native-strict",
    "workflow": {
      "agents": { "<AgentId>": { "id": "...", "llm_backend": "...", "system_prompt": "...", "max_turns": 8, "budget": null } },
      "tools":  { "<ToolId>":  { "id": "...", "spec": { … }, "impl": { … }, "capability_requirements": { … } } },
      "steps":  { "<StepId>":  { … } },
      "edges":  [ { /* SubflowEdge: from/to/kind per crates/tau-ir/src/subflow.rs */ } ],
      "capability_table": { "<ToolId>": [ "net.outbound", … ] }
    }
  }
}
```

Rules:
- `module` is the `IrModule` serialized verbatim — do **not** hand-roll it;
  `serde_json::to_value(&module)`. Whatever `serde` produces for
  `SubflowEdge`/`CapabilityTable`/etc. is the contract; the consumer adapts.
- `hash_kind`:
  - `"lowered"` — `canonical_ir_hash = hex(tau_ir::compute_hash(&module))` over
    the stand-in-cache lowering. **Document loudly: not reproducible**; identical
    project may hash differently from its built bundle because real content
    hashes are absent.
  - `"bundle"` — `canonical_ir_hash = payload.canonical_ir_hash` (the bundle's
    real hash, verbatim).
- BTreeMap fields serialize as JSON objects keyed by the id newtype's string —
  deterministic (alphabetical) ordering, stable for snapshot tests.

### Human (non-`--json`) output

Low priority; keep it minimal and to stdout (mirrors other verbs): one line per
agent with its tool ids and a `caps:` summary, plus a header line
`compiled IR — target <triple>, hash <kind> <short>`. The `--json` path is what
tau-ui consumes; the human path just shouldn't be empty.

## 5. Errors & exit codes

Follow `build.rs`'s convention (exit 2 = user/input error, 70 = internal):

| Condition | Exit | Message (stderr) |
|---|---|---|
| cwd has no readable `tau.toml` (lower) | 2 | `no tau.toml in <cwd>` |
| `tau.toml` parse/validate fails (lower) | 2 | surface the toml/validation error |
| `lower_project` returns `IrError` | 2 | `IR lowering failed: <e>` |
| `--target <bad>` not a valid triple | 2 | `invalid target '<t>'` |
| `--bundle` path missing/unreadable | 2 | `cannot read bundle <path>: <e>` |
| `--bundle` is a v1 bundle (`ir_payload == None`) | 2 | `bundle has no IR payload (v1 bundle); rebuild with this tau` |
| hex decode / `from_canonical_bytes` fails | 70 | `corrupt IR payload: <e>` |

All via `anyhow` + the existing `ExitCode` mapping. Never panic.

## 6. Tests (tau side)

- **Unit (lower):** a fixture `tau.toml` with ≥2 agents where one agent requires a
  tool with a capability ⇒ assert the envelope has `hash_kind: "lowered"`, the
  agent/tool present, ≥1 `edges` entry, and a non-empty `capability_table`.
- **Unit (bundle):** `tau build` a fixture project, then `tau ir inspect --bundle
  <out>` ⇒ assert `hash_kind: "bundle"` and `canonical_ir_hash` equals the
  manifest's `ir_payload.canonical_ir_hash`.
- **Error:** v1 bundle (or one with `ir_payload = None`) ⇒ exit 2 with the
  documented message; missing `tau.toml` ⇒ exit 2.
- **Round-trip sanity:** `from_canonical_bytes(to_canonical_bytes(&module))`
  already covered in `tau-ir`; add one asserting the verb's `module` field
  deserializes back into `IrModule` to lock the contract.

## 7. Out of scope (note, don't build)

- **`pruned_packages`** — NOT a field of `IrModule`. If wanted later, the verb
  could compute it by diffing declared-vs-referenced packages; deferred.
- **`--agent <id>` filtering** — `lower_project` does not filter by agent today
  (`build.rs`'s `agent_filter` applies to bundle agent selection, not lowering).
  Per-workflow scoping is handled consumer-side in tau-ui (highlighting), so the
  verb stays project-scoped. If real lowering-time filtering is wanted later,
  it's a separate change to the lowering pipeline.
- **Real (non-stand-in) caches in the lower path** — would make
  `hash_kind:"lowered"` reproducible, but requires wiring the real resolver
  caches into a read verb; deferred. The `--bundle` arm already gives the real
  hash.
