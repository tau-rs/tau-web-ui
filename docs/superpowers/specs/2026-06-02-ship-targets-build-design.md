# Ship / Targets & Build — design

**Status:** approved (brainstorm 2026-06-02)
**Sub-project of:** [Product Information Architecture](2026-05-31-product-information-architecture.md) — surface ⑤ "Ship", build-sequence item **8** ("Ship / Targets & Build — *now + gated*").
**Decomposition:** one implementation plan (gateway + frontend). Larger than [Tools view](2026-06-01-tools-view-design.md)/[Plugins view](2026-06-01-plugins-view-design.md) — three endpoints + a build action + a three-section page — but one coherent surface.

## 1. Goal

Replace the `/ship` `StubPage` with a real, **mock-backed** Ship surface: three stacked sections —

- **Targets** — the compile substrates. `host` is buildable now; `wasm` / `c-abi` / `mcu` show an in-page amber **γ** badge and are not buildable (phase γ).
- **Build** — pick a ready target (default `host`) and click **Build** → `build --target host` produces a portable **`.tau`** bundle, rendered as a step timeline (resolve deps → typecheck → compile → bundle).
- **Bundles** — the produced `.tau` artifacts, each with size, hash, and a **drift** status (clean/drifted).

tau has **no real build/target system yet** (the wire contract `docs/tau-contract-v1.md` is runtime-only; `docs/seams.md` ③ lists `GET /api/targets` + `POST /api/build` as *future*). So the whole surface is **mock-first, mark-gated**: the intended end-state UI with mock data, the `host`-vs-gated-substrate distinction marked by the amber badge, behind a `ShipSource` seam that swaps to real tau calls later — exactly as Tools/Plugins did.

Locked decisions (brainstorm):
- Layout: **stacked sections** (Targets → Build → Bundles, top to bottom).
- Build interaction: **synchronous** — `POST /build` returns the finished mock build; the button shows a brief `building…` state, then the step timeline renders complete and the new bundle is prepended to the Bundles list. No client-side step animation (keeps tests non-flaky).
- **Verify bundle (drift)** is surfaced as a per-bundle **displayed status** (clean/drifted), not an interactive re-verify action (deferred).
- **Conformance** belongs to the Verify surface ⑥ (β.6) — out of scope here.
- **Nav:** the surface becomes a real, usable page, so the sidebar **`gated` badge is removed** from "Ship / Targets"; gating is marked only in-page on the gated substrate cards (consistent with Tools, a "now" mock-backed surface carrying no nav badge).

## 2. Data model (ts-rs types)

```rust
// gateway/src/ship/mod.rs

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Target {
    pub name: String,            // "host" | "wasm" | "c-abi" | "mcu"
    pub substrate: String,       // "native" | "wasm32" | "cdylib" | "embedded"
    pub status: String,          // "ready" | "gated"
    pub gate: Option<String>,    // "γ" for gated targets; None for host
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BuildStep {
    pub name: String,            // "resolve deps" | "typecheck" | "compile" | "bundle"
    pub status: String,          // "ok" (mock builds always succeed)
    pub duration_ms: u32,
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Bundle {
    pub artifact: String,        // "demo.tau"
    pub target: String,          // "host"
    pub size_bytes: u64,
    pub hash: String,            // "sha256:9f3c…"
    pub drift: String,           // "clean" | "drifted"
    pub built_at: String,        // timestamp string (set by the gateway)
    pub steps: Vec<BuildStep>,   // the build that produced this bundle
}
```

The build-request body is a small typed struct:

```rust
#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BuildRequest {
    pub target: String,
}
```

Three read/action endpoints; the frontend derives all three sections from them.

## 3. Gateway

### 3.1 `ship` module (`gateway/src/ship/mod.rs`)

Mock-first behind a seam, mirroring `ToolsSource`/`PluginsSource` but with interior mutability for the bundle list (like `MockOps` for packages):

- **`ShipSource` trait**:
  ```rust
  pub trait ShipSource: Send + Sync {
      fn list_targets(&self) -> Vec<Target>;
      fn list_bundles(&self) -> Vec<Bundle>;
      fn build(&self, target: &str) -> Result<Bundle, BuildError>;
  }
  ```
  where `BuildError` is a small enum (`Gated`, `UnknownTarget`) with a `Display`/`message()` impl; the API maps it to `400` following the established handler idiom (`Result<Json<…>, (StatusCode, String)>` → `(StatusCode::BAD_REQUEST, msg)`, as in `api/packages.rs`).
- **`MockShip`**: seeds four targets — `host` (substrate `native`, status `ready`, gate `None`); `wasm` (`wasm32`, gated, `γ`); `c-abi` (`cdylib`, gated, `γ`); `mcu` (`embedded`, gated, `γ`). Holds `Mutex<Vec<Bundle>>` seeded with two bundles (a `clean` recent one and a `drifted` older one). `build("host")` synthesizes a `Bundle` (artifact `<project>.tau` — `demo.tau` for the demo fixture; four `ok` steps with plausible durations; `drift: "clean"`; a fresh `built_at`), pushes it to the **front** of the vec, and returns it. `build` on a gated target → `Err(BuildError::Gated)`; on an unknown target → `Err(BuildError::UnknownTarget)`.
- **`CliShip`** (seam, not exercised in v1): future real path (`tau targets`, `tau build --target … --json`). `list_targets`/`list_bundles` return empty; `build` returns `Err(BuildError::UnknownTarget)` with a "not implemented" message.

Selection mirrors `AppState::new`'s `is_mock` check (as `tools_source`/`plugins_source` do). `built_at` is a display-only **relative label** for a consistent column: the two seed bundles use `"2m ago"` / `"1d ago"`; `build` stamps `"just now"`. No real clock — avoids RFC3339/relative mixing in the table and keeps tests deterministic.

### 3.2 `AppState` wrapper + API

- `AppState` gains a `ship_source: Box<dyn ShipSource>` field (selected by `is_mock`) and wrappers: `list_targets()`, `list_bundles()`, `build(target: &str) -> Result<Bundle, BuildError>` delegating to the source.
- **API** (`gateway/src/api/ship.rs`), three scoped routes:
  - `GET  /api/projects/:pid/targets`  → `Json<Vec<Target>>`
  - `GET  /api/projects/:pid/bundles`  → `Json<Vec<Bundle>>`
  - `POST /api/projects/:pid/build`    → body `Json<BuildRequest>`; returns `Result<Json<Bundle>, (StatusCode, String)>` — `Ok(bundle)` on success, `Err((StatusCode::BAD_REQUEST, msg))` for a gated/unknown target (matching the `api/packages.rs` error idiom).

New `#[ts(export)]` types (`Target`, `BuildStep`, `Bundle`, `BuildRequest`) export to `web/src/types` via the drift gate.

## 4. Frontend

### 4.1 API module

`web/src/api/ship.ts`: `listTargets(): Promise<Target[]>` → `GET /targets`; `listBundles(): Promise<Bundle[]>` → `GET /bundles`; `build(target): Promise<Bundle>` → `POST /build` (scoped via the client chokepoint; same ok-checking `json<T>` helper as `api/tools.ts`, and a POST that sends `{ target }` as JSON).

### 4.2 Components (`web/src/ship/`)

- **`ShipPage.tsx`** — fetches `listTargets()` + `listBundles()` on mount; holds local state for the bundles list (so a build can prepend), the selected build target (default the first `ready` target), a `building` flag, and the most recent build's steps. Renders three stacked sections:
  - **Targets**: a row of cards — name + substrate; `ready` targets show a `ready` status badge; gated targets show the amber **γ** badge and are visually dimmed.
  - **Build**: a `<select>` of **ready** targets only (default `host`) + a **Build** button. Click → set `building`, `await build(target)`, then prepend the returned bundle to the list, store its `steps`, clear `building`. While `building`, the button shows `building…` and is disabled. After a build, the returned bundle's **step timeline** renders (one row per step: a status dot reusing `st-ok`/`st-running` tokens + step name + `duration_ms`).
  - **Bundles**: a table — artifact · target · size (human-readable from `size_bytes`) · short hash · **drift** badge (`clean` = `st-ok`, `drifted` = amber) · `built_at`.
- Status badges reuse the established `bg-st-…-soft text-st-…` idiom from `web/src/runs/badges.tsx`; the gated/γ + drift-`drifted` amber matches the established `bg-amber-100 text-amber-800` gated convention.

### 4.3 Routing + nav

- `web/src/App.tsx`: replace the `/ship` `StubPage` route with `<ShipPage />`.
- `web/src/app/Sidebar.tsx`: remove `gated: true` from the `{ to: "ship", label: "Ship / Targets" }` nav item (the surface is now built).

No new nested routes (the build action and step timeline live in-page).

## 5. Testing

**Gateway** (`ship/mod.rs` unit tests + an integration test):
- `MockShip::list_targets` seeds the four targets with `host` ready (gate `None`) and the three substrates gated (`gate == Some("γ")`).
- `MockShip::list_bundles` seeds at least one bundle; `build("host")` returns a `Bundle` whose `target == "host"`, has a non-empty `steps` vec (all `status == "ok"`), and **grows** the bundle list by one (appended to the front).
- `build("wasm")` → `Err(BuildError::Gated)`; `build("nope")` → `Err(BuildError::UnknownTarget)`.
- `CliShip` returns empty target/bundle lists and `build` errors.
- API: `GET /api/projects/:pid/targets` returns 4 (host ready); `GET …/bundles` returns the seeded array; `POST …/build {"target":"host"}` → 200 with `steps` populated; `POST …/build {"target":"wasm"}` → 400 (gated).

**Web (vitest):**
- `ShipPage` renders the target cards (host `ready`, wasm carrying the γ badge) and the seeded bundles table from mocked `listTargets`/`listBundles`.
- Clicking **Build** calls `build` (mocked to return a new bundle), then the new bundle appears at the top of the Bundles table and its step timeline is shown.
- The gated targets are not present as `<option>`s in the build `<select>` (only ready targets selectable).

**E2e (Playwright):**
- From `/projects/demo/ship`, the `host` target card and the seeded bundles are visible → click **Build** → a new `demo.tau` bundle row appears and the build step timeline shows `compile`. (Mock build mutates only in-memory gateway state; no fixture writes, so no cleanup.)

## 6. ts-rs / CI

`Target`, `BuildStep`, `Bundle`, `BuildRequest` land in `web/src/types` via `#[ts(export)]` + the drift gate. No CI job changes.

## 7. Out of scope (YAGNI / later)

- **Real tau build/targets** — `CliShip` returns empty / errors until tau ships `build`/`targets` (`docs/seams.md` ③).
- **Interactive re-verify / drift recompute** — drift is a displayed mock status; no "verify" button.
- **Per-agent / per-workflow build source** — `build` compiles the project (one `.tau`); no source picker.
- **Conformance** results and **wasm/c-abi/mcu substrate detail** views — gated elsewhere (Verify ⑥ / phase γ).
- **Streaming / animated build progress** — the build is synchronous; the step timeline arrives complete.
- Persisting bundles to disk — `MockShip` holds them in memory for the session (mirrors `MockOps` packages); they reset when the gateway restarts.
