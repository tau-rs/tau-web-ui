# Effective-Capabilities Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each agent's live, read-only effective capability set as a new card in the Config & Caps page, sourced from `tau list agents --capabilities --json`.

**Architecture:** A new gateway adapter module (`caps/`) follows the existing `checks/`/`sessions/` pattern — ts-rs-exported types + a `CapsSource` trait with `CliCaps` (shells tau) and `MockCaps` impls, selected by `AppState`. A scoped `GET /api/projects/{pid}/capabilities` endpoint returns the data; a React `CapabilitiesCard` renders it inside `ConfigPage`.

**Tech Stack:** Rust (axum, ts-rs, serde, anyhow), React + TypeScript (vitest), pnpm.

**Conventions for every task:**
- Gateway tests + ts-binding generation both run via `cargo test -p tau-gateway` (this writes `web/src/types/*.ts`; CI has a drift gate on that dir).
- Web: `cd web && pnpm install` once if `node_modules` is missing (fresh worktree); run tests with `cd web && pnpm vitest run` (or `./node_modules/.bin/vitest run`), format with `cd web && pnpm format`, typecheck with `cd web && pnpm typecheck`.
- Reference data shape: `tau list agents --capabilities --json` emits a top-level array of `{ id, display_name, package, llm_backend, effective_capabilities? }`; each cap row is `{ kind, allow_paths?, deny_paths, allow_hosts?, deny_hosts, allow_commands?, deny_commands, max_bytes? }`. `effective_capabilities` is **absent** when the package is not installed.

---

## Task 1: Gateway `caps` module — types, trait, Mock + Cli impls

**Files:**
- Create: `gateway/src/caps/mod.rs`
- Modify: `gateway/src/lib.rs` (add `pub mod caps;`)

- [ ] **Step 1: Declare the module**

In `gateway/src/lib.rs`, add alongside the other `pub mod` declarations (e.g. near `pub mod checks;`):

```rust
pub mod caps;
```

- [ ] **Step 2: Write the module with failing tests**

Create `gateway/src/caps/mod.rs`:

```rust
//! Effective capabilities: each agent's computed capability set, sourced live
//! from `tau list agents --capabilities --json`. `MockCaps` fabricates a
//! deterministic set; `CliCaps` shells tau and parses its JSON array.
//!
//! `effective` is `None` when tau omits the capability set for an agent
//! (package not installed) — distinct from `Some([])`, a fully-sandboxed agent.

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One capability row. Field names mirror tau's `tau list … --json` output and
/// the `tau.toml` schema: `allow_paths`/`deny_paths` for `fs.*`,
/// `allow_hosts`/`deny_hosts` for `net.http`, `allow_commands`/`deny_commands`
/// for `process.spawn`/`exec`, `max_bytes` for `fs.write`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CapabilityRow {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_paths: Option<Vec<String>>,
    #[serde(default)]
    pub deny_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_hosts: Option<Vec<String>>,
    #[serde(default)]
    pub deny_hosts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_commands: Option<Vec<String>>,
    #[serde(default)]
    pub deny_commands: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_bytes: Option<u64>,
}

/// Per-agent effective capability set. `effective: None` => package not
/// installed; `Some([])` => agent sandboxed to nothing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentCapabilities {
    pub agent_id: String,
    pub display_name: String,
    pub llm_backend: String,
    pub effective: Option<Vec<CapabilityRow>>,
}

/// Source of effective capabilities: `MockCaps` (deterministic) or `CliCaps`
/// (shells `tau list agents --capabilities --json`).
pub trait CapsSource: Send + Sync {
    fn agent_capabilities(&self) -> anyhow::Result<Vec<AgentCapabilities>>;
}

/// Deserialize-only mirror of one row of `tau list agents --json`. Renames the
/// agent-level fields to the gateway's wire names; `package` is ignored.
#[derive(Deserialize)]
struct RawAgentRow {
    id: String,
    #[serde(default)]
    display_name: String,
    #[serde(default)]
    llm_backend: String,
    #[serde(default)]
    effective_capabilities: Option<Vec<CapabilityRow>>,
}

/// Parse the JSON array emitted by `tau list agents --capabilities --json`.
fn parse_agents_json(stdout: &str) -> anyhow::Result<Vec<AgentCapabilities>> {
    let rows: Vec<RawAgentRow> = serde_json::from_str(stdout.trim())
        .map_err(|e| anyhow::anyhow!("parsing `tau list` JSON: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|r| AgentCapabilities {
            agent_id: r.id,
            display_name: r.display_name,
            llm_backend: r.llm_backend,
            effective: r.effective_capabilities,
        })
        .collect())
}

pub struct MockCaps;

impl CapsSource for MockCaps {
    fn agent_capabilities(&self) -> anyhow::Result<Vec<AgentCapabilities>> {
        let cap = |kind: &str| CapabilityRow {
            kind: kind.into(),
            allow_paths: None,
            deny_paths: vec![],
            allow_hosts: None,
            deny_hosts: vec![],
            allow_commands: None,
            deny_commands: vec![],
            max_bytes: None,
        };
        Ok(vec![
            AgentCapabilities {
                agent_id: "researcher".into(),
                display_name: "Researcher".into(),
                llm_backend: "anthropic".into(),
                effective: Some(vec![
                    CapabilityRow {
                        allow_paths: Some(vec!["./src/**".into()]),
                        ..cap("fs.read")
                    },
                    CapabilityRow {
                        allow_hosts: Some(vec!["api.weather.com".into()]),
                        ..cap("net.http")
                    },
                ]),
            },
            AgentCapabilities {
                agent_id: "writer".into(),
                display_name: "Writer".into(),
                llm_backend: "anthropic".into(),
                effective: Some(vec![CapabilityRow {
                    allow_paths: Some(vec!["out/**".into()]),
                    max_bytes: Some(1_048_576),
                    ..cap("fs.write")
                }]),
            },
            AgentCapabilities {
                agent_id: "greeter".into(),
                display_name: "Greeter".into(),
                llm_backend: "anthropic".into(),
                effective: Some(vec![]),
            },
        ])
    }
}

/// Shells `tau list agents --capabilities --json` in the project dir.
pub struct CliCaps {
    bin: PathBuf,
    project: PathBuf,
}

impl CliCaps {
    pub fn new(bin: PathBuf, project: PathBuf) -> Self {
        Self { bin, project }
    }
}

impl CapsSource for CliCaps {
    fn agent_capabilities(&self) -> anyhow::Result<Vec<AgentCapabilities>> {
        let out = Command::new(&self.bin)
            .current_dir(&self.project)
            .arg("list")
            .arg("agents")
            .arg("--capabilities")
            .arg("--json")
            .output()
            .map_err(|e| anyhow::anyhow!("could not run `tau list`: {e}"))?;
        if !out.status.success() {
            anyhow::bail!(
                "`tau list agents --capabilities` failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        parse_agents_json(&String::from_utf8_lossy(&out.stdout))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_populated_absent_and_empty_rows() {
        let json = r#"[
          {"id":"researcher","display_name":"Researcher","package":"weather","llm_backend":"anthropic",
           "effective_capabilities":[
             {"kind":"fs.read","allow_paths":["./src/**"],"deny_paths":[]},
             {"kind":"fs.write","allow_paths":["out/**"],"deny_paths":[],"max_bytes":1048576}
           ]},
          {"id":"greeter","display_name":"Greeter","package":"g","llm_backend":"anthropic",
           "effective_capabilities":[]},
          {"id":"orphan","display_name":"Orphan","package":"x","llm_backend":"anthropic"}
        ]"#;
        let rows = parse_agents_json(json).unwrap();
        assert_eq!(rows.len(), 3);

        let r = &rows[0];
        assert_eq!(r.agent_id, "researcher");
        let caps = r.effective.as_ref().unwrap();
        assert_eq!(caps[0].kind, "fs.read");
        assert_eq!(caps[0].allow_paths.as_deref(), Some(&["./src/**".to_string()][..]));
        assert_eq!(caps[1].max_bytes, Some(1_048_576));

        assert_eq!(rows[1].effective, Some(vec![])); // sandboxed to nothing
        assert_eq!(rows[2].effective, None); // package not installed
    }

    #[test]
    fn rejects_non_array_json() {
        assert!(parse_agents_json("not json").is_err());
    }

    #[test]
    fn mock_is_deterministic_and_covers_three_states() {
        let a = MockCaps.agent_capabilities().unwrap();
        let b = MockCaps.agent_capabilities().unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 3);
        assert!(a[0].effective.as_ref().unwrap().len() >= 1); // populated
        assert_eq!(a[2].effective, Some(vec![])); // empty
    }
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cargo test -p tau-gateway caps::`
Expected: PASS (3 tests). This also generates `web/src/types/AgentCapabilities.ts` and `web/src/types/CapabilityRow.ts`.

- [ ] **Step 4: Format + lint**

Run: `cargo fmt --all && cargo clippy -p tau-gateway --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/caps/mod.rs gateway/src/lib.rs web/src/types/AgentCapabilities.ts web/src/types/CapabilityRow.ts
git commit -m "feat(gateway): caps module — CapsSource trait + Cli/Mock impls"
```

---

## Task 2: Wire `CapsSource` into `AppState`

**Files:**
- Modify: `gateway/src/state.rs`

- [ ] **Step 1: Import the module's items**

In `gateway/src/state.rs`, near `use crate::checks::{self, CheckReport, CheckSource};`, add:

```rust
use crate::caps::{self, AgentCapabilities, CapsSource};
```

- [ ] **Step 2: Add the struct field**

In the `AppState` inner struct (where `check_source: Box<dyn CheckSource>,` is declared), add:

```rust
    caps_source: Box<dyn CapsSource>,
```

- [ ] **Step 3: Build the source in `with_options`**

In `with_options`, next to where `check_source` is constructed, add:

```rust
        let caps_source: Box<dyn CapsSource> = if is_mock {
            Box::new(caps::MockCaps)
        } else {
            Box::new(caps::CliCaps::new(bin.clone(), project.clone()))
        };
```

Then add `caps_source,` to the struct literal that initializes the inner state (alongside `check_source,`, `sessions_source,`).

- [ ] **Step 4: Add the accessor method**

Near `pub fn checks(&self) -> CheckReport { ... }`, add:

```rust
    pub fn agent_capabilities(&self) -> anyhow::Result<Vec<AgentCapabilities>> {
        self.0.caps_source.agent_capabilities()
    }
```

- [ ] **Step 5: Verify it compiles**

Run: `cargo test -p tau-gateway --no-run`
Expected: compiles with no errors.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/state.rs
git commit -m "feat(gateway): wire CapsSource into AppState"
```

---

## Task 3: Endpoint + route + endpoint test

**Files:**
- Create: `gateway/src/api/caps.rs`
- Modify: `gateway/src/api/mod.rs` (declare module + register route)

- [ ] **Step 1: Write the handler with a failing test**

Create `gateway/src/api/caps.rs`:

```rust
use axum::{http::StatusCode, Json};

use crate::api::scope::Scoped;
use crate::caps::AgentCapabilities;

/// `GET /api/projects/{pid}/capabilities` — live effective capabilities per agent.
pub async fn list(
    Scoped(state): Scoped,
) -> Result<Json<Vec<AgentCapabilities>>, (StatusCode, String)> {
    state
        .agent_capabilities()
        .map(Json)
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))
}

#[cfg(test)]
mod tests {
    use crate::state::AppState;
    use std::path::PathBuf;

    #[test]
    fn mock_state_returns_three_agents() {
        // Mock state (bin name contains "fake-tau-serve" -> is_mock = true).
        let state = AppState::new(
            PathBuf::from("fake-tau-serve"),
            PathBuf::from("."),
            false,
            crate::store::RunStore::ephemeral(),
        );
        let caps = state.agent_capabilities().unwrap();
        assert_eq!(caps.len(), 3);
        assert_eq!(caps[0].agent_id, "researcher");
    }
}
```

> Note: if `RunStore::ephemeral()` is not the in-memory constructor used by other gateway tests, mirror the constructor used in `gateway/src/api/agents.rs` or `state.rs` tests instead — grep `AppState::new(` in existing tests for the exact store setup.

- [ ] **Step 2: Register the module and route**

In `gateway/src/api/mod.rs`, add the module declaration near `pub mod checks;`:

```rust
pub mod caps;
```

Add the route in the per-project router (near `.route("/agents", get(agents::list))`). Use a standalone `/capabilities` path — **not** `/agents/capabilities`, which would collide with the `/agents/{id}` param route:

```rust
        .route("/capabilities", get(caps::list))
```

- [ ] **Step 3: Run the test**

Run: `cargo test -p tau-gateway caps`
Expected: PASS (module test from Task 1 + the new endpoint test).

- [ ] **Step 4: Format + lint**

Run: `cargo fmt --all && cargo clippy -p tau-gateway --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/api/caps.rs gateway/src/api/mod.rs
git commit -m "feat(gateway): GET /capabilities endpoint"
```

---

## Task 4: Web API client

**Files:**
- Create: `web/src/api/caps.ts`

- [ ] **Step 1: Write the client**

Create `web/src/api/caps.ts`:

```ts
import type { AgentCapabilities } from "../types/AgentCapabilities";
import { request, scopedPath } from "./client";

export const getCapabilities = (pid: string) =>
  request<AgentCapabilities[]>(scopedPath(pid, "/capabilities"));
```

- [ ] **Step 2: Typecheck**

Run: `cd web && pnpm typecheck`
Expected: no errors (imports `AgentCapabilities` generated in Task 1).

- [ ] **Step 3: Format + commit**

```bash
cd web && pnpm format
cd .. && git add web/src/api/caps.ts && git commit -m "feat(web): getCapabilities api client"
```

---

## Task 5: `CapabilitiesCard` component + tests

**Files:**
- Create: `web/src/config/CapabilitiesCard.tsx`
- Create: `web/src/config/CapabilitiesCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/config/CapabilitiesCard.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentCapabilities } from "../types/AgentCapabilities";
import { CapabilitiesCard } from "./CapabilitiesCard";

const mockGet = vi.fn();
vi.mock("../api/caps", () => ({ getCapabilities: (pid: string) => mockGet(pid) }));
vi.mock("../app/project-context", () => ({ useProjectId: () => "p1" }));
const surfaceError = vi.fn();
vi.mock("../notify/notify", () => ({ surfaceError: (...a: unknown[]) => surfaceError(...a) }));

beforeEach(() => {
  mockGet.mockReset();
  surfaceError.mockReset();
});

const rows: AgentCapabilities[] = [
  {
    agent_id: "researcher",
    display_name: "Researcher",
    llm_backend: "anthropic",
    effective: [
      { kind: "fs.read", allow_paths: ["./src/**"], deny_paths: [], deny_hosts: [], deny_commands: [] },
      { kind: "fs.write", allow_paths: ["out/**"], deny_paths: [], deny_hosts: [], deny_commands: [], max_bytes: 1048576n },
    ],
  },
  { agent_id: "greeter", display_name: "Greeter", llm_backend: "anthropic", effective: [] },
  { agent_id: "orphan", display_name: "Orphan", llm_backend: "anthropic", effective: null },
];

describe("CapabilitiesCard", () => {
  it("renders allow chips, the byte limit, and the two empty states", async () => {
    mockGet.mockResolvedValue(rows);
    render(<CapabilitiesCard />);
    expect(await screen.findByText("./src/**")).toBeInTheDocument();
    expect(screen.getByText("fs.write")).toBeInTheDocument();
    expect(screen.getByText(/1 MB/)).toBeInTheDocument();
    expect(screen.getByText(/fully sandboxed/i)).toBeInTheDocument();
    expect(screen.getByText(/package not installed/i)).toBeInTheDocument();
  });

  it("surfaces an inline error and a toast on fetch failure", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    render(<CapabilitiesCard />);
    await waitFor(() => expect(screen.getByText(/could not load capabilities/i)).toBeInTheDocument());
    expect(surfaceError).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && pnpm vitest run src/config/CapabilitiesCard.test.tsx`
Expected: FAIL ("Failed to resolve import ./CapabilitiesCard" / component undefined).

- [ ] **Step 3: Write the component**

Create `web/src/config/CapabilitiesCard.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { AgentCapabilities } from "../types/AgentCapabilities";
import type { CapabilityRow } from "../types/CapabilityRow";
import { getCapabilities } from "../api/caps";
import { useProjectId } from "../app/project-context";
import { surfaceError } from "../notify/notify";

function fmtBytes(n: bigint): string {
  const b = Number(n);
  if (b >= 1_048_576) return `≤ ${Math.round(b / 1_048_576)} MB`;
  if (b >= 1024) return `≤ ${Math.round(b / 1024)} KB`;
  return `≤ ${b} B`;
}

/** Allow-list values for a row, across the per-kind field names. */
function allows(c: CapabilityRow): string[] {
  return [...(c.allow_paths ?? []), ...(c.allow_hosts ?? []), ...(c.allow_commands ?? [])];
}
function denies(c: CapabilityRow): string[] {
  return [...c.deny_paths, ...c.deny_hosts, ...c.deny_commands];
}

function Chips({ cap }: { cap: CapabilityRow }) {
  const a = allows(cap);
  const d = denies(cap);
  return (
    <span className="mr-2 inline-flex flex-wrap items-center gap-1">
      <span className="text-muted">{cap.kind}</span>
      {a.map((v) => (
        <span key={`a-${v}`} className="rounded-full bg-st-ok/15 px-1.5 font-mono text-[10px] text-st-ok">
          {v}
        </span>
      ))}
      {d.map((v) => (
        <span key={`d-${v}`} className="rounded-full bg-st-err/15 px-1.5 font-mono text-[10px] text-st-err">
          {v}
        </span>
      ))}
      {cap.max_bytes != null && <span className="text-[10px] text-muted">{fmtBytes(cap.max_bytes)}</span>}
    </span>
  );
}

export function CapabilitiesCard() {
  const pid = useProjectId();
  const [rows, setRows] = useState<AgentCapabilities[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    getCapabilities(pid)
      .then((r) => live && setRows(r))
      .catch((err) => {
        if (!live) return;
        setError(true);
        surfaceError("Failed to load capabilities", err);
      });
    return () => {
      live = false;
    };
  }, [pid]);

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold">Effective Capabilities</h3>
        <span className="text-[10px] text-muted">· live · read-only</span>
      </div>

      {error && <p className="text-xs text-st-err">Could not load capabilities.</p>}
      {!error && rows == null && <p className="text-xs text-muted">Loading…</p>}
      {!error && rows?.length === 0 && <p className="text-xs text-muted">No agents in this project.</p>}

      {rows && rows.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">agent</th>
              <th className="px-2 py-1 font-medium">capabilities</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.agent_id} className="border-b border-border/60 align-top last:border-0">
                <td className="py-1 pr-2 font-mono font-medium">{a.agent_id}</td>
                <td className="px-2 py-1">
                  {a.effective == null ? (
                    <span className="text-muted">unavailable — package not installed</span>
                  ) : a.effective.length === 0 ? (
                    <span className="text-muted">no capabilities — fully sandboxed</span>
                  ) : (
                    a.effective.map((c, i) => <Chips key={i} cap={c} />)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

> Note: `max_bytes` is `bigint` in the generated binding (ts-rs maps Rust `u64` to `bigint`); that is why `fmtBytes` takes `bigint` and the test fixture uses `1048576n`. If `st-ok`/`st-err`/`muted` are not the exact theme tokens in this repo, match the ones used in `web/src/config/ConfigPage.tsx` and `web/src/notify/Toaster.tsx`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && pnpm vitest run src/config/CapabilitiesCard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Format + lint + commit**

```bash
cd web && pnpm format && pnpm lint && pnpm typecheck
cd .. && git add web/src/config/CapabilitiesCard.tsx web/src/config/CapabilitiesCard.test.tsx
git commit -m "feat(web): CapabilitiesCard component"
```

---

## Task 6: Mount the card in `ConfigPage`

**Files:**
- Modify: `web/src/config/ConfigPage.tsx`

- [ ] **Step 1: Import the component**

In `web/src/config/ConfigPage.tsx`, add near the other imports:

```tsx
import { CapabilitiesCard } from "./CapabilitiesCard";
```

- [ ] **Step 2: Render it between the Agents card and the Credentials card**

In the returned JSX, insert `<CapabilitiesCard />` immediately after the closing `</div>` of the Agents card (the one containing the agents `<table>`) and before the Credentials card (the `<div className={card}>` whose `<h3>` is "Credentials"):

```tsx
      <CapabilitiesCard />
```

- [ ] **Step 3: Verify the existing ConfigPage test still passes**

Run: `cd web && pnpm vitest run src/config/`
Expected: PASS (CapabilitiesCard tests + any existing ConfigPage test). If a ConfigPage test mocks api calls, it may now need `vi.mock("../api/caps", ...)`; add a mock returning `Promise.resolve([])` if the test fails on the new fetch.

- [ ] **Step 4: Format + lint + typecheck**

Run: `cd web && pnpm format && pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/config/ConfigPage.tsx
git commit -m "feat(web): mount Effective Capabilities card in Config & Caps page"
```

---

## Task 7: Full-stack verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run the whole gate**

Run: `just ci` (runs deny + fmt-check + lint + build + test for both stacks).
Expected: all green. If `just` is unavailable, run equivalently:
- `cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test --workspace --locked`
- `cd web && pnpm format:check && pnpm lint && pnpm typecheck && pnpm vitest run && pnpm build`

- [ ] **Step 2: Confirm ts-binding drift gate is clean**

Run: `git status --porcelain web/src/types`
Expected: empty (the generated `AgentCapabilities.ts` / `CapabilityRow.ts` were committed in Task 1).

- [ ] **Step 3 (optional manual smoke): run against mock**

Start the gateway with the fake-tau-serve mock and the web dev server, open a project's **Config & Caps** page, and confirm the Effective Capabilities card shows researcher (fs.read + net.http chips), writer (fs.write ≤ 1 MB), and greeter ("fully sandboxed"). See `README.md` for the dev run commands.

---

## Self-Review Notes

- **Spec coverage:** live source via `tau list … --json` (Task 1 `CliCaps`); `None` vs `Some([])` distinction (Tasks 1, 5); separate `/capabilities` route avoiding the `/agents/{id}` collision (Task 3); card between Agents and Credentials (Task 6); read-only (no mutation anywhere); gateway parse/mock/endpoint tests (Tasks 1, 3) and web chip/empty-state/error tests (Task 5); `format` in every web task. All spec sections map to a task.
- **Type consistency:** `AgentCapabilities { agent_id, display_name, llm_backend, effective: Option<Vec<CapabilityRow>> }` and `CapabilityRow` field names are identical across Rust types, generated bindings, the api client, and the component. `getCapabilities` is the single client name used by both the component and its mock. `max_bytes: bigint` is handled consistently (`fmtBytes(bigint)`, `1048576n` fixture).
