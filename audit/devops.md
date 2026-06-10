# tau-web-ui — DevOps & CI/CD audit

Scope: the GitHub Actions pipeline, local developer experience, and supply-chain
posture for the TS/web frontend (`web/`) **and** the Rust gateway (`gateway/` +
`fake-tau-serve/`). This section presents the **canonical DevOps model** shared
verbatim across the four sibling projects (cairn, cairn-ui, tau, tau-ui) and
applies it to tau-ui's stack.

> **Headline:** tau-ui has drifted the most from its siblings. Its `ci.yml` has
> **no `merge_group` trigger**, and it is **missing whole workflows the siblings
> have** (`nightly`, mutation testing, `auto-rerun-flaky`), has **no heavy `v*`-tag
> tier**, **no `just`/`lefthook`**, and **no supply-chain gating** (no `cargo-deny`,
> no `osv-scan`/`pnpm audit`, no SBOM). The recommendation below is framed as
> **re-converging onto the shared model**, not inventing something new.

---

## 1. Current state

### What tau-ui does well (keep & credit)

- **Single required check via `ci-summary`** — fail-closed gating that is green
  only when every real job (`rust`, `web`, `e2e`) succeeded *or* was legitimately
  skipped, computed with `jq` over `toJSON(needs)`
  (`.github/workflows/ci.yml:145-163`). This is exactly the canonical T1 shape.
- **`changes`-detection / docs-only split** — `dorny/paths-filter` gates the heavy
  jobs so a docs/markdown-only PR skips `rust`/`web`/`e2e` while the required
  `ci-summary` still reports green; pushes to `main` always run the full suite
  (`.github/workflows/ci.yml:40-56`, `:60`, `:87`, `:111`).
- **Stack split: `rust` + `web` + `e2e` jobs** — clippy `-D warnings`, rustfmt,
  `cargo build/test` for the gateway (`:58-75`); eslint + prettier + `tsc` +
  vitest + build for web (`:85-107`); a dedicated Playwright/Chromium `e2e` job
  that builds the gateway + `fake-tau-serve` mock and uploads the report on
  failure (`:109-143`). This matches the canonical "fan out to both stacks".
- **ts-rs type-drift gate** — after `cargo test` the `rust` job fails closed if
  `web/src/types` is stale, catching a changed Rust `Trace` model that didn't
  regenerate TS types (`.github/workflows/ci.yml:76-83`; export dir wired in
  `.cargo/config.toml`). Distinctive, valuable, **keep it**.
- **Coverage as a signal, not a gate** — `cargo llvm-cov nextest` with an explicit
  "coverage is a signal, not a gate" contract and a 30-min timeout
  (`.github/workflows/coverage.yml:1-73`, timeout at `:28`).
- **Concurrency hygiene** — `cancel-in-progress` everywhere *except* `main`, with a
  documented rationale (cancelling a main run mid-write corrupts the rust-cache)
  (`.github/workflows/ci.yml:32-34`).
- **Sane Claude bot security** — `@claude` actor allowlist + literal-mention gate,
  `pull_request` (not `pull_request_target`) so fork PRs can't read secrets, and a
  `CLAUDE_REVIEW_ENABLED` variable gate that keeps PRs green until set up
  (`.github/workflows/claude.yml:42-53`, `.github/workflows/claude-review.yml:37-43`).
- **Least-privilege baseline** — `permissions: contents: read` at workflow level on
  `ci.yml` (`:36-37`) and `coverage.yml` (`:21-22`), scoped up only where needed.
- **Dependabot present** — grouped weekly updates for github-actions, npm (`/web`),
  and cargo (`.github/dependabot.yml:1-25`).
- **(From the security audit) gateway secrets at `0o600`** — credential store
  hardening to preserve (`security.md`; `gateway/src/credentials/mod.rs:359-379`).

### Gaps vs the canonical model AND vs tau-ui's own siblings

| # | Gap | Where | Priority |
|---|-----|-------|----------|
| DV1 | **No `merge_group` trigger** — `ci.yml` triggers only on `push:[main]` + `pull_request`. Siblings gate the merge queue; tau-ui can't serialize merges, so green-on-PR ≠ green-after-merge. | `.github/workflows/ci.yml:27-31` | **High** |
| DV2 | **No supply-chain gating** — no `cargo-deny` (no `deny.toml` in repo), no `osv-scanner`/`pnpm audit` step. The security audit's **critical vitest** + **moderate vite/esbuild** advisories are **ungated** and regress silently. | `ci.yml` (absent); `security.md:53-65`; `web/package.json:46-47` | **High** |
| DV3 | **No `timeout-minutes` on any `ci.yml` job** — only `coverage.yml:28` has one. A hung job runs to the 6 h default. | `.github/workflows/ci.yml` (all jobs) | **High** |
| DV4 | **Actions pinned by mutable tag, not SHA** — `actions/checkout@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v6`, `Swatinem/rust-cache@v2`, `dtolnay/rust-toolchain@stable`, `anthropics/claude-code-action@beta`, etc. Canonical model requires SHA pins + Renovate. | `.github/workflows/*.yml` (all `uses:`) | **High** |
| DV5 | **No T3 scheduled drift-catchers** — siblings have `nightly` + weekly mutation + dependency-review; tau-ui has **none**. (Only scheduled job is the 30-min PR auto-updater, `auto-update-prs.yml:40-41`.) | siblings have, tau-ui absent | **Medium** |
| DV6 | **No `auto-rerun-flaky` workflow** — siblings have it; tau-ui is missing it (relevant given Playwright e2e). | absent | **Medium** |
| DV7 | **No mutation testing** — siblings run `cargo-mutants` (gateway) + Stryker (web); tau-ui has neither. | absent | **Medium** |
| DV8 | **No heavy `v*`-tag tier (T2)** — no OS matrix, no SBOM, no release artifacts. The "heavy lifting on feature release" tier doesn't exist. | absent | **Medium** |
| DV9 | **No `lefthook` and no `justfile`** — no local pre-commit/pre-push hooks, and CI re-types raw commands (`pnpm lint`, `cargo clippy …`) inline instead of calling shared verbs. local ≠ CI. | repo root (absent) | **Medium** |
| DV10 | **No lockfile-`--locked` enforcement on the Rust side** — web uses `pnpm install --frozen-lockfile` (`ci.yml:102,129`) but cargo build/test run without `--locked`, so `Cargo.lock` drift isn't caught. | `.github/workflows/ci.yml:73,75,118` | **Medium** |
| DV11 | **`rust-cache` not save-only-on-main** — `Swatinem/rust-cache@v2` used with defaults in `rust`/`e2e`/`coverage`; canonical model saves only on `main` to avoid PR cache churn. | `ci.yml:67,116`; `coverage.yml:34` | **Low** |
| DV12 | **No composite actions** — `setup-node`/`setup-rust`/`cache` steps are copy-pasted across `rust`/`web`/`e2e`/`coverage`; canonical model factors stable atomic steps into thin SHA-pinned composites. | `.github/workflows/*.yml` | **Low** |
| DV13 | **No Renovate + no sync template** — Dependabot exists but there's no workflow-file sync bot, so drift from siblings is silent rot (exactly tau-ui's current situation). | `.github/` (absent) | **Low** |
| DV14 | **No SBOM / provenance** — no CycloneDX (npm + cargo), no cosign/SLSA. | absent | **Low** |

**Gap count by priority: High = 4 (DV1–DV4), Medium = 6 (DV5–DV10), Low = 4 (DV11–DV14). Total = 14.**

---

## 2. Target model — the canonical model applied to tau-ui

The shared model is **"B+C"** anti-drift + a tiered **T0–T3** pipeline + `just` as
the universal local/CI wrapper. tau-ui adopts it by *re-converging* onto what its
siblings already run.

### Diagram 1 — Anti-drift "B+C" (re-converging from drift)

```
            ┌──────────────────────────────────────────────────────┐
            │  Each repo owns its FULL, self-contained workflows    │
            │  (cairn / cairn-ui / tau / tau-ui).  No runtime        │
            │  workflow_call to a central repo  →  no single SPOF;   │
            │  one bad edit can't turn all 4 repos red at once.     │
            └──────────────────────────────────────────────────────┘
                        │  each ci.yml is debuggable LOCALLY
                        ▼
   thin composite actions (SHA-pinned, stable atomic steps only):
        .github/actions/setup-node   .github/actions/setup-rust
        .github/actions/cache
                        │
                        ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  SYNC BOT (Renovate / repo-file-sync-action / multi-gitter)    │
   │  keeps workflow files aligned across the 4 repos via PRs.      │
   │  DRIFT  ==  a VISIBLE open PR   (not silent rot).              │
   │                                                               │
   │  >>> tau-ui is the proof: it drifted (no merge_group, missing  │
   │      nightly/mutation/auto-rerun-flaky) BECAUSE there was no    │
   │      sync bot. Turning the bot on makes that drift a PR.       │
   └───────────────────────────────────────────────────────────────┘
                        │
   Phase-2 (optional):  projen-style generator + `synth`-diff CI check.

   REJECTED: central reusable workflows called at runtime via
             workflow_call with a moving tag — blast radius + indirection.
```

### Diagram 2 — Tiered pipeline T0–T3 (tau-ui gaps marked)

```
 T0  LOCAL          lefthook + just  →  fmt · lint · fast unit on STAGED
     (seconds)      [tau-ui: MISSING — no lefthook, no justfile]
        │
        ▼
 T1  PR / merge_group   FAST GATE  (<10 min, fail-closed)
        ├─ changes (split: web vs Rust-gateway)        ✅ have (paths-filter)
        ├─ lint    (eslint + tsc -D ; clippy -D warnings) ✅ have
        ├─ unit    (vitest ; cargo test)                ✅ have
        ├─ supply  (cargo-deny + osv-scan / pnpm audit) ❌ MISSING (DV2)
        ├─ lockfile (pnpm --frozen-lockfile ✅ ; cargo --locked ❌ DV10)
        ├─ build   (web build ; cargo build --workspace) ✅ have
        ├─ e2e     (Playwright/Chromium vs fake-tau-serve) ✅ have
        └─ ci-summary  (single required check)          ✅ have
        ⚠️  trigger is push:main + pull_request ONLY  →  NO merge_group (DV1)
        ⚠️  no timeout-minutes on any job (DV3)
        │
        ▼
 T2  HEAVY   on push of `v*` tag  +  workflow_dispatch     ❌ MISSING (DV8)
        ├─ full OS matrix (ubuntu / macos / windows)
        ├─ e2e full (Playwright across browsers)
        ├─ mutation (cargo-mutants + Stryker)             ❌ MISSING (DV7)
        ├─ coverage (already standalone in coverage.yml)  ✅ partial
        ├─ SBOM (CycloneDX: npm + cargo)  — CORE          ❌ MISSING (DV14)
        ├─ cosign + SLSA provenance — phase-2 optional
        └─ release artifacts → GitHub Release
        │
        ▼
 T3  SCHEDULED  (nightly / weekly)                         ❌ MISSING (DV5–7)
        ├─ nightly: full matrix + e2e on a schedule
        ├─ weekly:  cargo-mutants / Stryker mutants
        ├─ dependency-review / osv scheduled scan
        └─ auto-rerun-flaky                               ❌ MISSING (DV6)
```

### Diagram 3 — `just` as one source of truth, fanning to BOTH stacks

```
                         ┌───────────────┐
                         │   justfile     │   identical verbs in all 4 repos:
                         │  (repo root)   │   fmt · lint · test · deny · ci ·
                         └──────┬─────────┘   heavy · fix
            ┌───────────────────┼────────────────────┐
            ▼                                          ▼
   WEB  (web/, pnpm)                       RUST GATEWAY (gateway/ + fake-tau-serve/)
   ──────────────────                      ────────────────────────────────────────
   just fmt   → prettier --write           → cargo fmt --all
   just lint  → eslint . + tsc --noEmit     → cargo clippy --all-targets
                                                  --all-features -D warnings
   just test  → pnpm vitest run             → cargo test --workspace --locked
   just deny  → pnpm audit / osv-scanner     → cargo deny check
   just fix   → eslint --fix + prettier      → cargo fmt + clippy --fix
   just ci    → run lint+test+deny+build for BOTH (== what T1 runs)
   just heavy → e2e + mutation + coverage + SBOM for BOTH (== T2)

        lefthook (pre-commit/pre-push)  ─┐
        CI jobs (T1/T2/T3)              ─┴─►  call the SAME `just` verbs
                                              ⇒  local == CI, no drift
```

### Diagram 4 — tau-ui-specific: building blocks ON vs MISSING

```
  CANONICAL BLOCK            tau-ui today        action
  ─────────────────────────  ──────────────────  ────────────────────────
  changes-detection split    ✅ ON (paths-filter) keep
  Rust gateway lint/test      ✅ ON               keep (+ --locked)
  web lint/test/build         ✅ ON               keep
  e2e (Playwright + mock)     ✅ ON               keep
  ts-rs type-drift gate       ✅ ON (distinctive) keep & credit
  ci-summary required check   ✅ ON               keep
  coverage (signal)           ✅ ON (standalone)  keep
  ─────────────────────────  ──────────────────  ────────────────────────
  merge_group trigger         ❌ MISSING          ADD (DV1)
  cargo-deny + osv/pnpm audit ❌ MISSING          ADD (DV2)
  timeout-minutes             ❌ MISSING          ADD (DV3)
  SHA-pinned actions          ❌ tag-pinned       PIN (DV4)
  nightly (T3)                ❌ MISSING          ADD (DV5)
  auto-rerun-flaky            ❌ MISSING          ADD (DV6)
  mutation (mutants/Stryker)  ❌ MISSING          ADD (DV7)
  heavy v*-tag tier (T2)      ❌ MISSING          ADD (DV8)
  lefthook + justfile         ❌ MISSING          ADD (DV9)
  SBOM / cosign / SLSA        ❌ MISSING          ADD (DV14 / phase-2)
```

tau-ui turns ON: **web** (eslint/tsc/vitest/build) + **Rust-gateway**
(clippy/cargo test/build) + **e2e** (Playwright vs `fake-tau-serve`). It is
**MISSING** vs its siblings: merge_group, nightly, mutation, auto-rerun-flaky,
heavy `v*` tier, and supply-chain gating — that's the convergence backlog.

---

## 3. Anti-drift & local DX, here

### B+C in tau-ui

- **Self-contained files (B):** tau-ui already owns its full `ci.yml` — good. Keep
  it self-contained; do **not** introduce runtime `workflow_call` to a central repo.
- **Thin composites (C):** the `setup-node` (pnpm + `actions/setup-node` with pnpm
  cache, `ci.yml:94-101,119-126`) and `setup-rust` (`dtolnay/rust-toolchain` +
  `Swatinem/rust-cache`, `:64-67,115-116`) blocks are duplicated across `rust`,
  `web`, `e2e`, and `coverage`. Factor each into one SHA-pinned composite under
  `.github/actions/` and reuse — atomic, stable steps only.
- **Sync bot:** add Renovate (or `BetaHuhn/repo-file-sync-action`) so workflow files
  stay aligned with the three siblings. tau-ui's current drift is precisely what
  this prevents: drift becomes a reviewable PR instead of silent rot.

### `just` + `lefthook` (currently absent)

Add a root `justfile` whose verbs fan out to **both** stacks (see Diagram 3) and a
`lefthook.yml` that calls the same verbs on pre-commit/pre-push. Because CI's T1/T2
jobs call the identical `just` verbs, **local == CI**:

- `just fmt` → `prettier --write` (web) + `cargo fmt --all`
- `just lint` → `eslint .` + `tsc --noEmit` (web) + `cargo clippy … -D warnings`
- `just test` → `pnpm vitest run` + `cargo test --workspace --locked`
- `just deny` → `pnpm audit` / `osv-scanner` + `cargo deny check`
- `just ci` / `just heavy` → the T1 / T2 bundles

Note tau-ui uses **pnpm** (`web/package.json:5`, `packageManager: pnpm@10.14.0`),
so the web verbs wrap `pnpm …` and CI keeps `--frozen-lockfile`.

**Keep git hooks lightweight.** When you add lefthook here, **pre-commit runs ONLY
the fast `just` verbs** — `fmt`, `lint`, and fast staged tests for **both** stacks
(`eslint`/`tsc`/`vitest` + `clippy`/`cargo test` on the Rust gateway). It must stay in
the seconds range and never block. **No heavy or container-based checks belong in git
hooks**: the full OS matrix, e2e, and mutation testing run in the T2 `v*`-tag heavy
tier and T3 schedules — never on `git commit`/`git push`. A pre-push hook, if present,
runs at most a fast `just ci` subset.

---

## 4. Implementation checklist (ordered; a future session can execute)

Priority + one-line rationale per item. cosign/SLSA are explicitly phase-2.

- [ ] **(High)** **Add `merge_group:` trigger to `ci.yml`** and require `ci-summary`
      on the merge queue — serialized correctness so green-on-PR == green-after-merge.
      `(.github/workflows/ci.yml:27-31)` *(DV1)*
- [ ] **(High)** **Add supply-chain gating to T1**: a `cargo deny check` step (+ new
      `deny.toml`) and `pnpm audit --audit-level=moderate` / `osv-scanner` — gates the
      known **critical vitest** + **moderate vite/esbuild** advisories so they can't
      regress silently. `(security.md:53-65; web/package.json:46-47)` *(DV2)*
- [ ] **(High)** **Add `timeout-minutes:` to every `ci.yml` job** (`changes`, `rust`,
      `web`, `e2e`, `ci-summary`) — bound hung runs instead of the 6 h default.
      `(.github/workflows/ci.yml)` *(DV3)*
- [ ] **(High)** **Pin all actions by commit SHA** (`checkout`, `setup-node`,
      `pnpm/action-setup`, `rust-toolchain`, `rust-cache`, `paths-filter`,
      `upload-artifact`, `claude-code-action`, `taiki-e/install-action`) and let
      Renovate bump them — removes mutable-tag supply-chain risk.
      `(.github/workflows/*.yml)` *(DV4)*
- [ ] **(Medium)** **Add `--locked` to gateway cargo build/test** so `Cargo.lock`
      drift fails CI (web already uses `--frozen-lockfile`).
      `(.github/workflows/ci.yml:73,75,118)` *(DV10)*
- [ ] **(Medium)** **Add `lefthook.yml` + root `justfile`** with `fmt/lint/test/deny/ci/heavy/fix`
      fanning to `eslint`/`tsc`/`vitest` (web) **and** `clippy`/`cargo test`/`cargo deny`
      (gateway); point lefthook and CI at the same verbs — local == CI.
      **pre-commit = fast `just` verbs only; no heavy/container checks in hooks** —
      heavy gates live in the T2/T3 CI tiers, not on `git commit`/`git push`. *(DV9)*
- [ ] **(Medium)** **Add `nightly.yml` (T3)** — full matrix + e2e on a schedule;
      currently missing vs siblings, catches env/dep drift the fast gate skips. *(DV5)*
- [ ] **(Medium)** **Add weekly mutation testing** — `cargo-mutants` (gateway) +
      Stryker (web); siblings have it, tau-ui has neither. *(DV7)*
- [ ] **(Medium)** **Add `auto-rerun-flaky.yml`** — siblings have it; meaningful given
      the Playwright e2e job. *(DV6)*
- [ ] **(Medium)** **Add `heavy.yml` on `push:` of `v*` tag + `workflow_dispatch` (T2)**
      — full OS matrix, full e2e, **CycloneDX SBOM** (npm + cargo), release artifacts
      → GitHub Release; the "heavy lifting on feature release" tier. *(DV8/DV14)*
- [ ] **(Medium)** **Add scheduled dependency-review** (T3) alongside the osv scan. *(DV5)*
- [ ] **(Low)** **Set `Swatinem/rust-cache` to save-only-on-`main`** in `rust`/`e2e`/`coverage`
      — avoids PR cache churn / stale restores. `(ci.yml:67,116; coverage.yml:34)` *(DV11)*
- [ ] **(Low)** **Factor `.github/actions/setup-node` + `setup-rust` + `cache`** thin
      SHA-pinned composites and de-duplicate across jobs. *(DV12)*
- [ ] **(Low)** **Add Renovate + a workflow-file sync template** so future drift from
      siblings surfaces as a reviewable PR, not silent rot. *(DV13)*
- [ ] **(Low, phase-2)** **Add cosign signing + SLSA provenance** to `heavy.yml`
      release artifacts. *(DV14 phase-2)*
- [ ] **(Low, phase-2)** **Add a projen-style generator + `synth`-diff CI check** to
      enforce structural alignment mechanically.

### Keep / do-not-regress

- ts-rs type-drift gate (`ci.yml:76-83`) · `ci-summary` fail-closed contract
  (`:145-163`) · docs-only `changes` split (`:40-56`) · cancel-except-main
  concurrency (`:32-34`) · coverage-as-signal (`coverage.yml`) · Claude bot actor
  allowlist + `pull_request`-not-`pull_request_target` (`claude.yml`,
  `claude-review.yml`) · gateway `0o600` credential store.
