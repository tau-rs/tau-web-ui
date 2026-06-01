# Ship / Targets & Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/ship` `StubPage` with a real, mock-backed Ship surface — three stacked sections (Targets, Build, Bundles) where `host` builds a portable `.tau` bundle (synchronously) and `wasm`/`c-abi`/`mcu` are gated (phase γ).

**Architecture:** A new gateway `ship` module (mock catalog seam `ShipSource`/`MockShip`/`CliShip` with an in-memory `Mutex<Vec<Bundle>>` for built artifacts, like `MockOps`); three scoped endpoints `GET /targets`, `GET /bundles`, `POST /build`; a frontend `ShipPage` wired into the router, replacing the stub. Build is synchronous: the POST returns the finished `Bundle` (with its steps), which the page prepends to the bundles list.

**Tech Stack:** Rust, axum 0.7, serde, serde_json, ts-rs; React 18, react-router-dom v6, Vitest, Playwright.

This is the single plan for Ship / Targets & Build (see `docs/superpowers/specs/2026-06-02-ship-targets-build-design.md`) — surface ⑤, build-sequence item 8.

---

## File Structure

**New:**
- `gateway/src/ship/mod.rs` — `Target`/`BuildStep`/`Bundle`/`BuildRequest` types, `BuildError`, `ShipSource` seam (`MockShip`/`CliShip`).
- `gateway/src/api/ship.rs` — the `targets`/`bundles`/`build` handlers.
- `web/src/api/ship.ts` — `listTargets`/`listBundles`/`build`.
- `web/src/ship/ShipPage.tsx` — the three-section Ship surface.
- Tests: `gateway/tests/ship_api.rs`, `web/src/ship/ShipPage.test.tsx`.

**Modified:**
- `gateway/src/lib.rs` — `pub mod ship;`.
- `gateway/src/state.rs` — `ship_source` field + `list_targets`/`list_bundles`/`build` wrappers.
- `gateway/src/api/mod.rs` — `pub mod ship;` + the three routes.
- `web/src/App.tsx` — `/ship` route renders `<ShipPage />`.
- `web/src/app/Sidebar.tsx` — drop `gated` from the Ship nav item.

---

## Task 1: Types + `ShipSource` seam (incl. `MockShip` build)

**Files:**
- Create: `gateway/src/ship/mod.rs`
- Modify: `gateway/src/lib.rs`

- [ ] **Step 1: Add the module to lib.rs**

In `gateway/src/lib.rs`, insert `pub mod ship;` alphabetically — after `pub mod serve_client;` and before `pub mod skills;`:

```rust
pub mod serve_client;
pub mod ship;
pub mod skills;
```

- [ ] **Step 2: Create `gateway/src/ship/mod.rs`**

```rust
//! Ship / Targets & Build: a mock-backed catalog of compile targets plus a
//! synchronous `build` that produces a `.tau` bundle. Mirrors the tools/plugins
//! seam, with an in-memory bundle list (like packages' `MockOps`). tau has no
//! real build engine yet — `CliShip` is the empty seam.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Target {
    pub name: String,         // "host" | "wasm" | "c-abi" | "mcu"
    pub substrate: String,    // "native" | "wasm32" | "cdylib" | "embedded"
    pub status: String,       // "ready" | "gated"
    pub gate: Option<String>, // "γ" for gated; None for host
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BuildStep {
    pub name: String,   // "resolve deps" | "typecheck" | "compile" | "bundle"
    pub status: String, // "ok"
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Bundle {
    pub artifact: String, // "<project>.tau"
    pub target: String,
    pub size_bytes: u64,
    pub hash: String,  // "sha256:…"
    pub drift: String, // "clean" | "drifted"
    pub built_at: String,
    pub steps: Vec<BuildStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BuildRequest {
    pub target: String,
}

/// Build failure mapped to HTTP 400 by the handler.
#[derive(Debug)]
pub enum BuildError {
    Gated(String),
    UnknownTarget(String),
}

impl std::fmt::Display for BuildError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BuildError::Gated(t) => write!(f, "target '{t}' is gated (phase γ)"),
            BuildError::UnknownTarget(t) => write!(f, "unknown target '{t}'"),
        }
    }
}

impl std::error::Error for BuildError {}

/// Source of targets/bundles + the build action. Mock-first; the CLI path stays
/// empty until tau ships `targets`/`build`.
pub trait ShipSource: Send + Sync {
    fn list_targets(&self) -> Vec<Target>;
    fn list_bundles(&self) -> Vec<Bundle>;
    fn build(&self, target: &str) -> Result<Bundle, BuildError>;
}

/// The fixed target registry (host ready; the three substrates gated at γ).
fn targets() -> Vec<Target> {
    let gated = |name: &str, substrate: &str| Target {
        name: name.into(),
        substrate: substrate.into(),
        status: "gated".into(),
        gate: Some("γ".into()),
    };
    vec![
        Target {
            name: "host".into(),
            substrate: "native".into(),
            status: "ready".into(),
            gate: None,
        },
        gated("wasm", "wasm32"),
        gated("c-abi", "cdylib"),
        gated("mcu", "embedded"),
    ]
}

fn step(name: &str, duration_ms: u32) -> BuildStep {
    BuildStep {
        name: name.into(),
        status: "ok".into(),
        duration_ms,
    }
}

pub struct MockShip {
    project: String,
    bundles: Mutex<Vec<Bundle>>,
}

impl MockShip {
    pub fn new(project: String) -> Self {
        let artifact = format!("{project}.tau");
        let seed = |size: u64, drift: &str, built_at: &str| Bundle {
            artifact: artifact.clone(),
            target: "host".into(),
            size_bytes: size,
            hash: "sha256:9f3c1a2b7e".into(),
            drift: drift.into(),
            built_at: built_at.into(),
            steps: vec![
                step("resolve deps", 120),
                step("typecheck", 340),
                step("compile", 2100),
                step("bundle", 90),
            ],
        };
        MockShip {
            project,
            bundles: Mutex::new(vec![
                seed(2_456_789, "clean", "2m ago"),
                seed(2_310_004, "drifted", "1d ago"),
            ]),
        }
    }
}

impl ShipSource for MockShip {
    fn list_targets(&self) -> Vec<Target> {
        targets()
    }

    fn list_bundles(&self) -> Vec<Bundle> {
        self.bundles.lock().unwrap().clone()
    }

    fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        let t = targets()
            .into_iter()
            .find(|t| t.name == target)
            .ok_or_else(|| BuildError::UnknownTarget(target.to_string()))?;
        if t.status != "ready" {
            return Err(BuildError::Gated(target.to_string()));
        }
        let bundle = Bundle {
            artifact: format!("{}.tau", self.project),
            target: target.to_string(),
            size_bytes: 2_460_512,
            hash: "sha256:1a2b3c4d5e".into(),
            drift: "clean".into(),
            built_at: "just now".into(),
            steps: vec![
                step("resolve deps", 118),
                step("typecheck", 352),
                step("compile", 2087),
                step("bundle", 94),
            ],
        };
        self.bundles.lock().unwrap().insert(0, bundle.clone());
        Ok(bundle)
    }
}

/// CLI seam — not wired in v1 (the mock covers fake-tau-serve).
pub struct CliShip;

impl ShipSource for CliShip {
    fn list_targets(&self) -> Vec<Target> {
        vec![]
    }
    fn list_bundles(&self) -> Vec<Bundle> {
        vec![]
    }
    fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        Err(BuildError::UnknownTarget(target.to_string()))
    }
}
```

- [ ] **Step 3: Write the failing tests** — add a test module at the bottom of `gateway/src/ship/mod.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_seeds_targets_and_bundles() {
        let s = MockShip::new("demo".into());
        let targets = s.list_targets();
        assert_eq!(targets.len(), 4);
        let host = targets.iter().find(|t| t.name == "host").unwrap();
        assert_eq!(host.status, "ready");
        assert!(host.gate.is_none());
        let wasm = targets.iter().find(|t| t.name == "wasm").unwrap();
        assert_eq!(wasm.status, "gated");
        assert_eq!(wasm.gate.as_deref(), Some("γ"));
        assert!(!s.list_bundles().is_empty());
    }

    #[test]
    fn build_host_appends_bundle_with_steps() {
        let s = MockShip::new("demo".into());
        let before = s.list_bundles().len();
        let b = s.build("host").unwrap();
        assert_eq!(b.target, "host");
        assert_eq!(b.artifact, "demo.tau");
        assert!(!b.steps.is_empty());
        assert!(b.steps.iter().all(|st| st.status == "ok"));
        assert_eq!(s.list_bundles().len(), before + 1);
        // appended to the front
        assert_eq!(s.list_bundles()[0].built_at, "just now");
    }

    #[test]
    fn build_rejects_gated_and_unknown() {
        let s = MockShip::new("demo".into());
        assert!(matches!(s.build("wasm"), Err(BuildError::Gated(_))));
        assert!(matches!(s.build("nope"), Err(BuildError::UnknownTarget(_))));
    }

    #[test]
    fn cli_ship_is_empty() {
        assert!(CliShip.list_targets().is_empty());
        assert!(CliShip.list_bundles().is_empty());
        assert!(CliShip.build("host").is_err());
    }
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo test -p tau-gateway --lib ship::tests`
Expected: PASS (4 tests). Also `cargo build -p tau-gateway` (compiles clean — no unused imports).

```bash
git add gateway/src/lib.rs gateway/src/ship/mod.rs
git commit -m "feat(gateway): ship target/bundle types + mock build seam"
```

---

## Task 2: AppState wrapper

**Files:**
- Modify: `gateway/src/state.rs`

- [ ] **Step 1: Add the import** — in `gateway/src/state.rs`, add to the `use` block (next to the existing `use crate::ship`-adjacent imports; alphabetically it sits just before `use crate::skills::...`):

```rust
use crate::ship::{self, Bundle, BuildError, ShipSource, Target};
```

- [ ] **Step 2: Add the `Inner` field** — add to the `Inner` struct, right after `plugins_source: Box<dyn PluginsSource>,`:

```rust
    ship_source: Box<dyn ShipSource>,
```

- [ ] **Step 3: Build it in `AppState::new`** — right after the `plugins_source` selection block (`is_mock` and `project` are in scope):

```rust
        let ship_source: Box<dyn ShipSource> = if is_mock {
            let project_name = project
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("project")
                .to_string();
            Box::new(ship::MockShip::new(project_name))
        } else {
            Box::new(ship::CliShip)
        };
```

and add `ship_source` to the `Inner { ... }` literal, right after `plugins_source,`:

```rust
            plugins_source,
            ship_source,
```

- [ ] **Step 4: Add the wrapper methods** — inside `impl AppState`, right after the `list_plugins` method:

```rust
    pub fn list_targets(&self) -> Vec<Target> {
        self.0.ship_source.list_targets()
    }

    pub fn list_bundles(&self) -> Vec<Bundle> {
        self.0.ship_source.list_bundles()
    }

    pub fn build(&self, target: &str) -> Result<Bundle, BuildError> {
        self.0.ship_source.build(target)
    }
```

- [ ] **Step 5: Run + commit**

Run: `cargo build -p tau-gateway && cargo test -p tau-gateway --lib`
Expected: PASS, no regressions.

```bash
git add gateway/src/state.rs
git commit -m "feat(gateway): AppState ship_source + targets/bundles/build wrappers"
```

---

## Task 3: API routes + integration test

**Files:**
- Create: `gateway/src/api/ship.rs`, `gateway/tests/ship_api.rs`
- Modify: `gateway/src/api/mod.rs`

- [ ] **Step 1: Create `gateway/src/api/ship.rs`**

```rust
use axum::{http::StatusCode, Json};

use crate::api::scope::Scoped;
use crate::ship::{Bundle, BuildRequest, Target};

pub async fn targets(Scoped(state): Scoped) -> Json<Vec<Target>> {
    Json(state.list_targets())
}

pub async fn bundles(Scoped(state): Scoped) -> Json<Vec<Bundle>> {
    Json(state.list_bundles())
}

pub async fn build(
    Scoped(state): Scoped,
    Json(req): Json<BuildRequest>,
) -> Result<Json<Bundle>, (StatusCode, String)> {
    state
        .build(&req.target)
        .map(Json)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))
}
```

- [ ] **Step 2: Wire the routes in `gateway/src/api/mod.rs`**

Add `pub mod ship;` to the module list at the top — alphabetically, after `pub mod scope;` and before `pub mod skills;`:

```rust
pub mod scope;
pub mod ship;
pub mod skills;
```

In the scoped router, the current last route is `.route("/plugins", get(plugins::list));`. Change it to chain the three ship routes:

```rust
        .route("/plugins", get(plugins::list))
        .route("/targets", get(ship::targets))
        .route("/bundles", get(ship::bundles))
        .route("/build", post(ship::build));
```

(`get` and `post` are already imported via `axum::routing::{delete, get, post}`.)

- [ ] **Step 3: Create `gateway/tests/ship_api.rs`**

```rust
use std::path::PathBuf;
use tau_gateway::{api, projects::ProjectRegistry};

fn bin() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("target/debug/fake-tau-serve");
    p
}
fn project() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.pop();
    p.push("fixtures/demo");
    p
}

async fn serve(reg: ProjectRegistry) -> String {
    let app = api::router(reg);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn ship_targets_bundles_and_build() {
    let data = tempfile::tempdir().unwrap();
    let reg = ProjectRegistry::load(bin(), true, data.path().to_path_buf())
        .await
        .unwrap();
    let meta = reg.add_local(&project()).await.unwrap();
    let base = serve(reg).await;
    let http = reqwest::Client::new();

    // targets
    let targets: serde_json::Value = http
        .get(format!("{base}/api/projects/{}/targets", meta.id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let tarr = targets.as_array().unwrap();
    assert_eq!(tarr.len(), 4);
    let host = tarr.iter().find(|t| t["name"] == "host").unwrap();
    assert_eq!(host["status"], "ready");

    // bundles (seeded, non-empty)
    let bundles: serde_json::Value = http
        .get(format!("{base}/api/projects/{}/bundles", meta.id))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!bundles.as_array().unwrap().is_empty());

    // build host → 200 with steps
    let resp = http
        .post(format!("{base}/api/projects/{}/build", meta.id))
        .json(&serde_json::json!({ "target": "host" }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let built: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(built["target"], "host");
    assert!(!built["steps"].as_array().unwrap().is_empty());

    // build gated target → 400
    let bad = http
        .post(format!("{base}/api/projects/{}/build", meta.id))
        .json(&serde_json::json!({ "target": "wasm" }))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status(), reqwest::StatusCode::BAD_REQUEST);
}
```

- [ ] **Step 4: Run + commit**

Run: `cargo build -p fake-tau-serve && cargo test -p tau-gateway --test ship_api`
Expected: PASS. (Read-only against `fixtures/demo` — `git status --porcelain fixtures/demo` stays clean; the build mutates only in-memory gateway state.)

```bash
git add gateway/src/api/ship.rs gateway/src/api/mod.rs gateway/tests/ship_api.rs
git commit -m "feat(gateway): ship targets/bundles/build routes + integration test"
```

---

## Task 4: ts-rs export + rust gate

**Files:**
- Regenerated: `web/src/types/{Target,BuildStep,Bundle,BuildRequest}.ts`

- [ ] **Step 1: Regenerate** — `cargo build -p fake-tau-serve && cargo test -p tau-gateway` → PASS; new files under `web/src/types/`. Confirm `git status --porcelain fixtures/demo` is empty.

- [ ] **Step 2: Verify** — `ls web/src/types/ | grep -E "Target|BuildStep|Bundle|BuildRequest"` → all four present. `cat web/src/types/Bundle.ts` should reference `BuildStep`.

- [ ] **Step 3: Full rust gate** — `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test -p tau-gateway` → green. Fix fmt minimally with `cargo fmt --all` if needed. The pre-existing ts-rs serde-attr note is benign.

- [ ] **Step 4: Commit**

```bash
git add web/src/types gateway/
git commit -m "chore(gateway): export ship TS bindings + fmt/clippy"
```

---

## Task 5: Frontend — `api/ship.ts` + `ShipPage` + routing/nav

**Files:**
- Create: `web/src/api/ship.ts`, `web/src/ship/ShipPage.tsx`, `web/src/ship/ShipPage.test.tsx`
- Modify: `web/src/App.tsx`, `web/src/app/Sidebar.tsx`

- [ ] **Step 1: Create `web/src/api/ship.ts`**

```ts
import type { Target } from "../types/Target";
import type { Bundle } from "../types/Bundle";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listTargets = () => fetch(scopedPath("/targets")).then(json<Target[]>);
export const listBundles = () => fetch(scopedPath("/bundles")).then(json<Bundle[]>);
export const build = (target: string) =>
  fetch(scopedPath("/build"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  }).then(json<Bundle>);
```

- [ ] **Step 2: Write the failing `ShipPage` test `web/src/ship/ShipPage.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShipPage } from "./ShipPage";

const targets = [
  { name: "host", substrate: "native", status: "ready", gate: null },
  { name: "wasm", substrate: "wasm32", status: "gated", gate: "γ" },
];
const bundles = [
  {
    artifact: "demo.tau",
    target: "host",
    size_bytes: 2_310_004,
    hash: "sha256:seedhash00",
    drift: "drifted",
    built_at: "1d ago",
    steps: [{ name: "compile", status: "ok", duration_ms: 2100 }],
  },
];
const newBundle = {
  artifact: "demo.tau",
  target: "host",
  size_bytes: 2_460_512,
  hash: "sha256:freshbuild9",
  drift: "clean",
  built_at: "just now",
  steps: [
    { name: "resolve deps", status: "ok", duration_ms: 118 },
    { name: "compile", status: "ok", duration_ms: 2087 },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/targets"))
        return Promise.resolve({ ok: true, json: async () => targets });
      if (url.includes("/bundles"))
        return Promise.resolve({ ok: true, json: async () => bundles });
      if (url.includes("/build"))
        return Promise.resolve({ ok: true, json: async () => newBundle });
      return Promise.resolve({ ok: true, json: async () => [] });
    }),
  );
});

describe("ShipPage", () => {
  it("renders targets + bundles; gated target is not buildable", async () => {
    render(<ShipPage />);
    // target cards rendered — assert on the substrate (unique; "host"/"wasm"
    // also appear as a <select> option and a bundle-row target cell).
    await waitFor(() => expect(screen.getByText(/native/)).toBeInTheDocument());
    expect(screen.getByText(/wasm32/)).toBeInTheDocument();
    // the seeded bundle shows its short hash + drift
    expect(screen.getByText("seedhash")).toBeInTheDocument();
    expect(screen.getByText("drifted")).toBeInTheDocument();
    // only ready targets are build options (role-scoped: avoids the card/cell matches)
    expect(screen.getByRole("option", { name: "host" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "wasm" })).not.toBeInTheDocument();
  });

  it("builds and prepends the new bundle with its step timeline", async () => {
    const user = userEvent.setup();
    render(<ShipPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^build$/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^build$/i }));
    // the freshly built bundle (unique short hash) appears
    await waitFor(() => expect(screen.getByText("freshbui")).toBeInTheDocument());
    // its step timeline shows "resolve deps"
    expect(screen.getByText("resolve deps")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Create `web/src/ship/ShipPage.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { Target } from "../types/Target";
import type { Bundle } from "../types/Bundle";
import type { BuildStep } from "../types/BuildStep";
import { listTargets, listBundles, build } from "../api/ship";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function shortHash(hash: string): string {
  const hex = hash.includes(":") ? hash.split(":")[1] : hash;
  return hex.slice(0, 8);
}

export function ShipPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [target, setTarget] = useState("");
  const [building, setBuilding] = useState(false);
  const [lastBuild, setLastBuild] = useState<Bundle | null>(null);

  useEffect(() => {
    listTargets()
      .then((t) => {
        setTargets(t);
        setTarget((cur) => cur || t.find((x) => x.status === "ready")?.name || "");
      })
      .catch(() => {});
    listBundles().then(setBundles).catch(() => {});
  }, []);

  async function onBuild() {
    if (!target) return;
    setBuilding(true);
    try {
      const b = await build(target);
      setLastBuild(b);
      setBundles((prev) => [b, ...prev]);
    } catch {
      // mock surface — ignore
    } finally {
      setBuilding(false);
    }
  }

  const ready = targets.filter((t) => t.status === "ready");

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-base font-semibold">Ship / Targets &amp; Build</h2>

      <section className="space-y-1.5">
        <div className="text-[9px] uppercase text-muted">targets</div>
        <div className="flex flex-wrap gap-2">
          {targets.map((t) => (
            <TargetCard key={t.name} target={t} />
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="text-[9px] uppercase text-muted">build</div>
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="build-target" className="text-muted">
            target
          </label>
          <select
            id="build-target"
            aria-label="build target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
          >
            {ready.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={onBuild}
            disabled={building || !target}
            className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-fg disabled:opacity-50"
          >
            {building ? "building…" : "Build"}
          </button>
        </div>
        {lastBuild && <StepTimeline steps={lastBuild.steps} />}
      </section>

      <section className="space-y-1.5">
        <div className="text-[9px] uppercase text-muted">bundles</div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">artifact</th>
              <th className="px-2 py-1 font-medium">target</th>
              <th className="px-2 py-1 font-medium">size</th>
              <th className="px-2 py-1 font-medium">hash</th>
              <th className="px-2 py-1 font-medium">drift</th>
              <th className="px-2 py-1 font-medium">built</th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((b, i) => (
              <tr key={`${b.hash}-${i}`} className="border-b border-border/60">
                <td className="py-1 pr-2 font-mono font-medium text-accent">{b.artifact}</td>
                <td className="px-2 py-1 text-muted">{b.target}</td>
                <td className="px-2 py-1 text-muted">{humanSize(b.size_bytes)}</td>
                <td className="px-2 py-1 font-mono text-muted">{shortHash(b.hash)}</td>
                <td className="px-2 py-1">
                  <DriftBadge drift={b.drift} />
                </td>
                <td className="px-2 py-1 text-muted">{b.built_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function TargetCard({ target }: { target: Target }) {
  const gated = target.status !== "ready";
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        gated ? "border-border opacity-60" : "border-st-ok/40 bg-st-ok-soft/40"
      }`}
    >
      <div className="font-semibold text-accent">{target.name}</div>
      <div className="mt-0.5 text-[10px] text-muted">
        {target.substrate}
        {" · "}
        {gated ? (
          <span className="rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">
            {target.gate}
          </span>
        ) : (
          <span className="rounded bg-st-ok-soft px-1 text-[9px] font-medium text-st-ok">ready</span>
        )}
      </div>
    </div>
  );
}

function DriftBadge({ drift }: { drift: string }) {
  const tone = drift === "clean" ? "bg-st-ok-soft text-st-ok" : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{drift}</span>
  );
}

function StepTimeline({ steps }: { steps: BuildStep[] }) {
  const dot = (status: string) =>
    status === "ok" ? "bg-st-ok" : status === "running" ? "bg-st-running" : "bg-st-error";
  return (
    <div className="mt-1 space-y-0.5">
      {steps.map((s, i) => (
        <div key={`${i}-${s.name}`} className="flex items-center gap-2 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${dot(s.status)}`} />
          <span>{s.name}</span>
          <span className="ml-auto text-[10px] text-muted">{s.duration_ms}ms</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire the route in `web/src/App.tsx`**

Add the import near the other page imports (e.g. after the `ToolsPage`/`SkillEditorPage` imports):

```tsx
import { ShipPage } from "./ship/ShipPage";
```

Replace the existing `/ship` `StubPage` route:

```tsx
          <Route
            path="ship"
            element={
              <StubPage
                title="Ship / Targets"
                subtitle="Targets, build & verify — coming soon."
                gated="β.6 (conformance)"
              />
            }
          />
```

with:

```tsx
          <Route path="ship" element={<ShipPage />} />
```

(Leave the `StubPage` import in place — it's still used by the `health` route.)

- [ ] **Step 5: Drop the nav `gated` badge in `web/src/app/Sidebar.tsx`**

Change the Ship nav item (in the "Operate" group) from:

```tsx
      { to: "ship", label: "Ship / Targets", icon: "⬡", gated: true },
```

to:

```tsx
      { to: "ship", label: "Ship / Targets", icon: "⬡" },
```

- [ ] **Step 6: Run + commit**

Run: `cd web && pnpm test -- src/ship/ShipPage.test.tsx && pnpm test && pnpm typecheck`
Expected: all green.

```bash
git add web/src/api/ship.ts web/src/ship/ShipPage.tsx web/src/ship/ShipPage.test.tsx web/src/App.tsx web/src/app/Sidebar.tsx
git commit -m "feat(web): Ship / Targets & Build page (targets + sync build + bundles)"
```

---

## Task 6: E2e + final gate

**Files:**
- Modify: `web/e2e/run.spec.ts`

- [ ] **Step 1: Append the spec**

```ts
test("ship: targets, build host, new bundle with steps", async ({ page }) => {
  await page.goto("/projects/demo/ship");
  // host target card rendered (assert the substrate — "host" also appears as a
  // select option + bundle target cell; Playwright resolves /native/ to the card).
  await expect(page.getByText(/native/)).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: /^build$/i })).toBeVisible();
  await page.getByRole("button", { name: /^build$/i }).click();
  // the build step timeline renders (compile is unique to the timeline)
  await expect(page.getByText("compile")).toBeVisible({ timeout: 5000 });
});
```

- [ ] **Step 2: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. Real ASSERTION failure → STOP, report BLOCKED. Missing-browser → `pnpm exec playwright install chromium` then retry; else `pnpm exec playwright test --list` and note e2e deferred to CI. A strict-mode "N elements" error → fix the selector minimally (`exact:true`/`.first()`), report the fix.

- [ ] **Step 3: Restore fixtures** (the ship surface is read-only on disk, but other specs mutate `fixtures/demo/tau.toml` + may leave skill dirs):

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 4: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green. If format:check fails, `pnpm format`, re-check, include in the commit.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (git status)
git commit -m "test(web): e2e ship build + bundle"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-02-ship-targets-build-design.md`):
- §2 types (`Target`, `BuildStep`, `Bundle`, `BuildRequest`) → Task 1. §3.1 `ShipSource`/`MockShip` (4 targets, seeded bundles in `Mutex`, `build` appends + steps, gated/unknown errors)/`CliShip`/`BuildError` → Task 1. §3.2 AppState wrappers + three routes (`(StatusCode, String)` error idiom) → Tasks 2–3. ts-rs/CI (§6) → Task 4. §4.1 `api/ship.ts` → Task 5. §4.2 `ShipPage` (targets cards w/ γ badge, ready-only build select, sync build → prepend + step timeline, bundles table w/ size/short-hash/drift) → Task 5. §4.3 route swap + nav badge drop → Task 5. §5 tests → Tasks 1, 3, 5, 6. All covered.

**Placeholder scan:** none — every step has complete code.

**Type consistency:** `Target { name, substrate, status, gate: Option<String> }`, `BuildStep { name, status, duration_ms }`, `Bundle { artifact, target, size_bytes, hash, drift, built_at, steps: BuildStep[] }`, `BuildRequest { target }` are used identically across the module, the AppState wrappers, the handlers, the integration test, and the frontend (`api/ship.ts`, `ShipPage`). `build(&str) -> Result<Bundle, BuildError>` and `MockShip`/`CliShip` signatures match callers. `BuildError` maps to `(StatusCode::BAD_REQUEST, String)` (matching `api/packages.rs`). The frontend reads `t.status === "ready"` for buildable filtering and `t.gate` for the γ badge, `b.size_bytes`/`b.hash`/`b.drift`/`b.steps` for the table/timeline — matching the gateway field names. The `GET /targets`/`/bundles` + `POST /build` paths match `listTargets`/`listBundles`/`build` (`scopedPath`). The vitest fetch stub routes by URL substring (`/targets`, `/bundles`, `/build`) — note `"/bundles"` does not contain `"/build"`, so the ordering is unambiguous.

**Note for executor:** the integration test + `cargo test` read `fixtures/demo` (read-only); the `build` action mutates only in-memory gateway state, so `git status --porcelain fixtures/demo` stays clean. Other e2e specs mutate fixtures, so Task 6 Step 3 restores them. The e2e and vitest assertions target `"compile"` / the fresh bundle's short hash (`freshbui`) — unique strings that avoid the duplicate-match trap (seed and built bundles share `artifact == "demo.tau"`).
