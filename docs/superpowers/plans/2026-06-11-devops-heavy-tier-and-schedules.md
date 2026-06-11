# DevOps T2 Heavy Tier + T3 Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing T2 (heavy `v*`-tag) and T3 (scheduled) CI tiers to
tau-ui — re-converging onto the canonical model its siblings run — without
touching the T1 fast gate or the `ci-summary` contract.

**Architecture:** Five new, self-contained workflow files under
`.github/workflows/`, each triggered ONLY on `v*` tag / schedule /
`workflow_dispatch` (never `pull_request` or `merge_group`). Every job carries
`timeout-minutes`. New actions are SHA-pinned (brief 103 has not landed; do not
introduce fresh mutable-tag debt). `just heavy` does not exist yet (brief 101
not landed), so the bundles are inlined with a comment to single-source later.

**Tech Stack:** GitHub Actions; CycloneDX SBOM via `cargo-cyclonedx` (cargo) +
`@cyclonedx/cdxgen` (pnpm); mutation via `cargo-mutants` (gateway) + Stryker
(web, vitest runner); Playwright e2e; OSV scanner.

Addresses audit findings **DV5, DV6, DV7, DV8, DV14**.

---

## Decisions / constraints baked in

- **cosign + SLSA provenance are phase-2 → deferred.** tau's `release.yml` uses
  `attest-build-provenance` / `attest-sbom`; we ship only the CycloneDX SBOM.
- **SBOM = CycloneDX** (brief is authoritative; tau used SPDX). cargo →
  `cargo-cyclonedx`; pnpm → `cdxgen -t pnpm` (`@cyclonedx/cyclonedx-npm` needs an
  npm lockfile; this repo is pnpm).
- **`workflow_dispatch` of `heavy.yml` is a safe dry-run** — it builds + SBOMs
  but the GitHub Release job is gated `if: startsWith(github.ref,'refs/tags/v')`,
  so a manual dispatch never publishes a release.
- **e2e runs on the Linux matrix leg only.** `web/playwright.config.ts` hardcodes
  unix paths (`./target/debug/tau-gateway`) and a Linux-oriented webServer; the
  OS matrix still covers build+test on ubuntu/macos/windows (the real drift
  catcher). Documented inline.
- **No `package.json`/lockfile churn.** Stryker is run via `pnpm dlx` in the
  weekly job, not added as a devDep, so T1 PR installs stay lean.

## SHA pins (resolved 2026-06-11)

```
actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10        # v6
actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e      # v6
pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093       # v6
actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6
Swatinem/rust-cache@e18b497796c12c097a38f9edb9d0641fb99eee32     # v2
dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8  # stable (pass toolchain: stable)
taiki-e/install-action@7a79fe8c3a13344501c80d99cae481c1c9085912  # v2
softprops/action-gh-release@b4309332981a82ec1c5618f44dd2e27cc8bfbfda # v3
google/osv-scanner-action/osv-scanner-action@9a498708959aeaef5ef730655706c5a1df1edbc2 # v2.3.8
```

## File structure

- Create: `.github/workflows/heavy.yml` — T2: OS matrix + e2e + CycloneDX SBOM +
  release artifacts → GitHub Release. (DV8/DV14)
- Create: `.github/workflows/nightly.yml` — T3: daily full matrix + e2e +
  scheduled OSV dependency scan. (DV5)
- Create: `.github/workflows/mutation.yml` — T3 weekly: `cargo-mutants` (gateway)
  + Stryker (web), uploading the missed-mutant report. (DV7)
- Create: `.github/workflows/auto-rerun-flaky.yml` — mirrors the sibling's shape,
  scoped to the `e2e` job. (DV6)
- Create: `web/stryker.conf.json` — Stryker config (vitest runner).

---

## Task 1: `heavy.yml` (T2, DV8/DV14)

**Files:** Create `.github/workflows/heavy.yml`

- [ ] Author the file (full content in repo). Jobs: `matrix` (ubuntu/macos/
      windows: cargo build+test `--locked`, web build, e2e on Linux, stage
      release gateway binary), `sbom` (CycloneDX cargo + pnpm), `release`
      (tag-only: download artifacts → `action-gh-release`). Triggers:
      `push.tags: ['v*']` + `workflow_dispatch`. `timeout-minutes` on every job.
- [ ] Verify SBOM commands locally (`cargo cyclonedx`, `cdxgen -t pnpm`) produce
      valid CycloneDX JSON; adjust artifact-collection globs to match real output.
- [ ] `actionlint` the file.

## Task 2: `nightly.yml` (T3, DV5)

**Files:** Create `.github/workflows/nightly.yml`

- [ ] Author: `matrix` job (same OS matrix + e2e-on-Linux as heavy, no release)
      on `schedule: '0 5 * * *'` + `workflow_dispatch`; `osv-scan` job
      (`osv-scanner-action`, recursive). `timeout-minutes` everywhere.
- [ ] `actionlint`.

## Task 3: `mutation.yml` (T3 weekly, DV7)

**Files:** Create `.github/workflows/mutation.yml`, `web/stryker.conf.json`

- [ ] Author `stryker.conf.json` (testRunner vitest; mutate `src/**` minus
      tests/types; json+html reporters → `reports/mutation/`).
- [ ] Author `mutation.yml`: `cargo-mutants` job (`-p tau-gateway`, taiki-e
      install, upload `mutants.out/`) + `stryker` job (`pnpm dlx` core +
      vitest-runner, upload `reports/mutation/`). `schedule: '0 6 * * 0'` +
      `workflow_dispatch` (timeout input). `timeout-minutes` everywhere.
- [ ] Local smoke: `cargo mutants -p tau-gateway --list` enumerates mutants;
      stryker config parses.
- [ ] `actionlint`.

## Task 4: `auto-rerun-flaky.yml` (DV6)

**Files:** Create `.github/workflows/auto-rerun-flaky.yml`

- [ ] Mirror tau's shape; `flaky_patterns=("e2e")`; workflow name match `"CI"`;
      `schedule: '*/10 * * * *'` + `workflow_dispatch`; `permissions: actions:
      write, contents: read`; `timeout-minutes: 10`.
- [ ] `actionlint`.

## Task 5: Verification + PR

- [ ] `actionlint` all four workflows clean.
- [ ] Confirm none trigger on `pull_request`/`merge_group`; every job has
      `timeout-minutes` (grep).
- [ ] Capture real evidence: CycloneDX SBOM files generated locally (cargo +
      pnpm); `cargo-mutants` enumerates gateway mutants; Stryker config valid.
- [ ] `requesting-code-review`.
- [ ] Commit (Co-Authored-By: Claude Fable 5), push, open PR citing
      DV5/DV6/DV7/DV8/DV14. STOP — no merge.
