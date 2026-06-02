# Verify / Health (Checks) — design

**Status:** approved (brainstorm 2026-06-02)
**Sub-project of:** [Product Information Architecture](2026-05-31-product-information-architecture.md) — surface ⑥ "Verify", build-sequence item ("Health / Checks — *now*"). This is the last Product-IA surface.
**Decomposition:** one implementation plan (gateway + frontend). Comparable in size to [Ship](2026-06-02-ship-targets-build-design.md), read-only (no build-style action).

## 1. Goal

Replace the `/health` `StubPage` with a real, **mock-backed** Health / Checks surface that renders `tau check` results. Sections (top → bottom):

- **Connectivity strip** — reuses the *existing* connectivity `Health` (`gateway_ok` / `engine_ok` / `tau_version`) with a **Re-run** button.
- **Checks** — category chips (config · lockfile · pkg · sandbox · plugin · skill, each with a count + worst-severity color) over a flat SARIF-style **findings table** (severity · rule · message · location). Clicking a chip filters the table to that category (toggle).
- **Sandbox** — diagnostics (tier · status · no-sandbox).
- **Conformance** — a **gated** card (amber badge, "waits on tau β.6"); frontend placeholder, no backend data.

`docs/seams.md` ⑥ proposes a future `POST /api/check → SARIF`; no real check endpoint exists yet, so a `CheckSource` seam backs the surface with mock findings — the locked **mock-first, mark-gated** discipline.

Locked decisions (brainstorm):
- Checks presentation: **category chips + one flat findings table** (six categories is a small fixed set; one table is the most scannable).
- **Severity → color:** error = `st-error`, warning = **amber** (the established attention/gated color; no new theme token), note = muted, pass = `st-ok`.
- **No collision with connectivity health:** the existing `/api/projects/:pid/health` (`meta::health`, returns connectivity) is untouched; checks get a *separate* `GET /api/projects/:pid/checks`.
- **Conformance** is a pure frontend gated card (no gateway data).
- The Health **nav item is already un-gated** — no Sidebar change; gating lives on the in-page conformance card.

## 2. Data model (ts-rs types)

```rust
// gateway/src/checks/mod.rs

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckFinding {
    pub category: String,         // "config"|"lockfile"|"pkg"|"sandbox"|"plugin"|"skill"
    pub severity: String,         // "error" | "warning" | "note"
    pub rule: String,             // "TAU-CONFIG-ENDPOINT"
    pub message: String,
    pub location: Option<String>, // "tau.toml:3" | None
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CategoryStatus {
    pub name: String,    // category name
    pub errors: u32,
    pub warnings: u32,
    pub notes: u32,      // pass = errors == warnings == notes == 0
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SandboxDiag {
    pub tier: String,       // "seatbelt" (mock)
    pub status: String,     // "ready" (mock)
    pub no_sandbox: bool,   // mock: false
}

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CheckReport {
    pub categories: Vec<CategoryStatus>, // all 6 (so pass categories still render as chips)
    pub findings: Vec<CheckFinding>,
    pub sandbox: SandboxDiag,
}
```

One read-only endpoint returns `CheckReport`; the frontend derives the chips from `categories` and the table from `findings`.

## 3. Gateway

### 3.1 `checks` module (`gateway/src/checks/mod.rs`)

Mock-first behind a seam, mirroring `ToolsSource`/`ShipSource`:
- **`CheckSource` trait**: `fn report(&self) -> CheckReport`.
- **`MockChecks`**: seeds a report mirroring the brainstorm mock —
  - **categories** (all six, in order): `config` (1 error), `lockfile` (1 warning), `pkg` (pass), `sandbox` (1 note), `plugin` (pass), `skill` (pass).
  - **findings** (3): `{config, error, TAU-CONFIG-ENDPOINT, "inference.endpoint not set", tau.toml:3}`, `{lockfile, warning, TAU-LOCK-STALE, "lockfile is stale vs tau.toml — run `tau resolve`", tau.lock:1}`, `{sandbox, note, TAU-SANDBOX-TIER, "sandbox tier: seatbelt (macOS)", None}`.
  - **sandbox**: `{tier: "seatbelt", status: "ready", no_sandbox: false}`.
- **`CliChecks`** (seam, not exercised in v1): future real path (`tau check --sarif`). Returns an empty report (`categories: []`, `findings: []`, default `SandboxDiag { tier: "unknown", status: "unknown", no_sandbox: false }`).

Selection mirrors `AppState::new`'s `is_mock` check (as `ship_source`/`tools_source` do).

### 3.2 `AppState` wrapper + API

- `AppState` gains a `check_source: Box<dyn CheckSource>` field (selected by `is_mock`) and `pub fn checks(&self) -> CheckReport` delegating to `self.0.check_source.report()`.
- **API** (`gateway/src/api/checks.rs`): one scoped route — `GET /api/projects/:pid/checks → Json<CheckReport>` (handler `api::checks::report`, read-only). Distinct from the existing `/health` connectivity route — no collision.

New `#[ts(export)]` types (`CheckFinding`, `CategoryStatus`, `SandboxDiag`, `CheckReport`) export to `web/src/types` via the drift gate.

## 4. Frontend

### 4.1 API module

`web/src/api/checks.ts`: `getChecks(): Promise<CheckReport>` → `GET /checks` (scoped via the client chokepoint, same ok-checking `json<T>` helper as `api/ship.ts`). The connectivity `Health` is already available via the existing `getHealth` + the store (`useStore(s => s.health)`).

### 4.2 Components (`web/src/health/`)

- **`HealthPage.tsx`** (replaces the `/health` `StubPage` route) — on mount fetches `getChecks()`; reads the store's connectivity `health`. Local state: the `CheckReport`, and the selected category filter (`string | null`). Renders four sections:
  - **Connectivity strip**: gateway/engine status dots (`engine_ok` → `st-ok`/`st-error`) + `tau_version` + a **Re-run** button that re-calls `getChecks()` (mock returns the same report).
  - **Checks**: a row of **category chips** (one per `categories` entry: name + a count badge colored by worst severity — error→`st-error`, else warning→amber, else note→muted, else pass→`st-ok` "✓"). Clicking a chip sets/clears the category filter. Below, the **findings table** (severity badge · rule · message · location), showing all findings or only the selected category's.
  - **Sandbox**: `tier · status` (+ a "no-sandbox" marker when `no_sandbox`).
  - **Conformance**: a gated card — amber `gated` badge + "Cross-target conformance — waits on tau β.6."
- A small **`SeverityBadge`** component maps `"error"|"warning"|"note"` (+ a `"pass"` case) to the token classes; reused by chips and table rows. Warning uses `bg-amber-100 text-amber-800` (the established convention); error/note/pass use `st-error`/`muted`/`st-ok` soft-background badges in the `runs/badges.tsx` style.

### 4.3 Routing + nav

- `web/src/App.tsx`: replace the `/health` `StubPage` route with `<HealthPage />` (leave the `StubPage` import — still used by the `workflows` route).
- `web/src/app/Sidebar.tsx`: **no change** (the Health item is already un-gated).

## 5. Testing

**Gateway** (`checks/mod.rs` unit tests + an integration test):
- `MockChecks::report` seeds 6 categories in order with the right counts (config 1 error; lockfile 1 warning; sandbox 1 note; pkg/plugin/skill all-zero/pass), 3 findings with matching severities/rules, and the mock `SandboxDiag`.
- `CliChecks::report` returns empty categories + findings.
- API: `GET /api/projects/:pid/checks` returns the report with `categories`/`findings`/`sandbox` populated; the `config` category has `errors == 1` and a finding with `severity == "error"` and `rule == "TAU-CONFIG-ENDPOINT"`.

**Web (vitest):**
- `HealthPage` renders a chip per category and the findings table from a mocked `getChecks` (the `TAU-CONFIG-ENDPOINT` rule + its `error` badge are visible).
- Clicking the `lockfile` category chip filters the table to the lockfile finding (the config error row is no longer shown); clicking again clears the filter.
- The gated **Conformance** card is present.

**E2e (Playwright):**
- From `/projects/demo/health`, the `config` error finding (`TAU-CONFIG-ENDPOINT`) and the gated **Conformance** card are visible → click the `lockfile` chip → the table shows the `TAU-LOCK-STALE` finding. (Read-only; no fixture mutation, no cleanup.)

## 6. ts-rs / CI

`CheckFinding`, `CategoryStatus`, `SandboxDiag`, `CheckReport` land in `web/src/types` via `#[ts(export)]` + the drift gate. No CI job changes.

## 7. Out of scope (YAGNI / later)

- **Real `tau check` / SARIF ingestion** — `CliChecks` returns empty until tau ships `POST /api/check` (`docs/seams.md` ⑥).
- **Real sandbox tier detection** and wiring the actual `--no-sandbox` flag into the report — sandbox is fully mocked.
- **Conformance** results — gated (β.6); frontend placeholder card only.
- A dedicated `st-warning` theme token — warning uses the established amber convention.
- Deep-linking a finding's `location` to an editor / file view.
- Re-running checks as a real `tau check` invocation — the Re-run button re-fetches the (mock) report.
