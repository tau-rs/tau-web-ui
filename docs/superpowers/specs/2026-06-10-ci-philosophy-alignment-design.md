# CI philosophy alignment — design

**Date:** 2026-06-10
**Status:** Approved (brainstorm), pending spec review → writing-plans
**Repo:** github.com/LEBOCQTitouan/tau-web-ui
**Branch / worktree:** `worktree-ci-orchestration` (`.claude/worktrees/ci-orchestration`)

## Purpose

Bring the **essence of tau's CI philosophy** into tau-ui. Not a port of tau's
workflow files — tau is a multi-crate Rust repo with a merge queue, fuzzing,
mutation testing and a docs site; tau-ui is a small Rust-gateway + React-web
repo. The transferable thing is the *mindset*, distilled from tau's own design
docs (`docs/superpowers/specs/2026-05-17-ci-upgrades-round-1-design.md`,
`docs/superpowers/plans/2026-05-14-ci-audit-pass.md`) and workflow headers.

This spec (1) records that philosophy as a set of principles, (2) audits
tau-ui's current CI against them, and (3) closes the gaps with the smallest
change that honours each principle.

## The philosophy (principles)

| # | Principle | Origin in tau |
|---|-----------|---------------|
| **P1** | **Least privilege.** Every workflow declares explicit `permissions:`; default `contents: read`; widen *per job* only where that job writes. | audit-pass changes 1–3 |
| **P2** | **Fail-closed aggregate gate.** Branch protection requires *one* summary check that is green only when every real job passed **or was legitimately skipped** — never green-on-broken. | audit-pass change 6 (the "#92 merged with broken CI" incident) |
| **P3** | **Flakes are signal, not noise.** CI never silently retries to hide a flake; surface it and fix the test. | audit-pass change 10 (nextest `retries=0`) |
| **P4** | **Coverage is a signal, not a gate.** Measure to inform; never hard-threshold (it incentivises tests-for-coverage). | `coverage.yml` header |
| **P5** | **Cache integrity.** Don't cancel `main` runs mid-cache-write — the cache save step would never complete and later PRs restore stale. | upgrades-round-1 item A |
| **P6** | **Docs-only changes skip the heavy jobs but still satisfy the gate.** | audit-pass change 6 |
| **P7** | **Security-conscious event model.** `pull_request`, never `pull_request_target`/`workflow_run`, for secret-bearing jobs; untrusted fields consumed only as data, never interpolated into a shell `run:`; AI bots gated behind an actor allowlist / opt-in variable. | `claude.yml` / `claude-review.yml` headers |
| **P8** | **Manage action/dependency versions.** Dependabot opens grouped bumps weekly so pinning stays low-maintenance. | upgrades-round-1 item C; audit-pass post-merge |
| **P9** | **Every workflow documents its *why*** — the failure mode it prevents and the trade-off, in a header comment. | every tau workflow |

## tau-ui audit (before)

Already aligned — **no change**:

- **P3** — `web/playwright.config.ts` has no `retries` (defaults to 0); vitest no retry.
- **P4** — `coverage.yml` is explicitly measurement-only.
- **P7** — `claude.yml` rejects `pull_request_target`/`workflow_run` and enforces an actor allowlist + `@claude` mention; `claude-review.yml` is `pull_request`-only and gated behind `vars.CLAUDE_REVIEW_ENABLED`.
- **P1** (partial) — `coverage.yml` has workflow-scoped `contents: read`; `claude.yml` and `claude-review.yml` have correct **job-scoped** write permissions.
- **P9** (partial) — `coverage.yml`, `claude.yml`, `claude-review.yml` carry rationale headers.

Gaps — **addressed by this spec**:

- **P1** — `ci.yml` has **no `permissions:` block** (inherits the broad repo default). It only reads.
- **P2 + P6** — **no aggregate gate and no docs-only skip.** The current spec (`2026-05-31-ci-and-ui-cleanup-design.md` §A.3) requires `rust`/`web`/`e2e` individually, which cannot express "a docs-only PR is green."
- **P5** — `ci.yml` uses `cancel-in-progress: true` unconditionally; the `rust` and `e2e` jobs use `Swatinem/rust-cache`, so the stale-cache risk is real.
- **P8** — no `.github/dependabot.yml`.
- **P9** — `ci.yml`'s header is a bare `name: CI`.

## Design

### Change 1 — `.github/workflows/ci.yml`

Four edits; no change to any job's existing build/test steps.

**a. Header (P9).** Document the gate contract, the docs-skip mechanism, and the concurrency rationale.

**b. Least privilege (P1).** Workflow-scoped:
```yaml
permissions:
  contents: read
```

**c. Cache integrity (P5).**
```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

**d. Docs-only skip (P6) — a `changes` gate job.** *No* workflow-level
`paths-ignore`: that would skip the summary job too and leave the required
check stuck "pending" on docs-only PRs (a documented GitHub footgun). Instead a
fast leading job decides, and the heavy jobs guard on it:

```yaml
jobs:
  changes:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read   # dorny/paths-filter reads PR file list
    outputs:
      code: ${{ steps.filter.outputs.code }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            code:
              - '**'
              - '!docs/**'
              - '!**/*.md'

  rust:
    needs: changes
    if: ${{ needs.changes.outputs.code == 'true' }}
    # ...existing steps unchanged...

  web:
    needs: changes
    if: ${{ needs.changes.outputs.code == 'true' }}
    # ...existing steps unchanged...

  e2e:
    needs: changes
    if: ${{ needs.changes.outputs.code == 'true' }}
    # ...existing steps unchanged...
```

A docs/markdown-only change makes `changes.outputs.code == 'false'`, so
`rust`/`web`/`e2e` are skipped while `changes` and `ci-summary` still run.

**e. Fail-closed gate (P2).**
```yaml
  ci-summary:
    name: ci-summary
    needs: [changes, rust, web, e2e]
    if: always()
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Verify required jobs passed or were skipped
        run: |
          results='${{ toJSON(needs) }}'
          echo "$results"
          if echo "$results" | jq -e \
            'to_entries | map(select(.value.result != "success" and .value.result != "skipped")) | length > 0' \
            >/dev/null; then
            echo "::error::A required job failed or was cancelled"
            exit 1
          fi
          echo "All required jobs passed or were skipped (docs-only)."
```

`skipped` and `success` are both green; `failure`/`cancelled` fail the gate.
`ci-summary` becomes the **single required status check** on `main`.

### Change 2 — `.github/dependabot.yml` (P8)

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      github-actions:
        patterns: ['*']

  - package-ecosystem: npm
    directory: /web        # pnpm lockfile lives here
    schedule:
      interval: weekly
    groups:
      npm-minor-patch:
        update-types: ['minor', 'patch']

  - package-ecosystem: cargo
    directory: /           # Rust workspace at repo root
    schedule:
      interval: weekly
    groups:
      cargo-minor-patch:
        update-types: ['minor', 'patch']
```

Grouping keeps minor/patch bumps to one PR per ecosystem; majors arrive
individually for deliberate review. (`claude-review.yml` already allows the
`dependabot` bot actor, so these PRs get an AI review too.)

### Change 3 — remove the mis-scoped scratch files

Earlier in this branch I copied tau's `ci-summary.yml` (the **polling**
variant), `auto-update-prs.yml`, and `auto-rerun-flaky.yml`. They are the wrong
fit and were never committed:

- The polling `ci-summary` exists only to bridge tau's **merge queue** +
  `workflow_run` propagation gaps; tau-ui has neither. The in-`ci.yml`
  `needs`-based summary above is the right-sized form of P2.
- `auto-update-prs` / `auto-rerun-flaky` are the "remove human toil" theme, not
  the philosophy theme this work targets.

Delete all three from the worktree.

## Non-goals (YAGNI)

- No merge queue, no polling summary workflow.
- No `auto-update-prs` / `auto-rerun-flaky` orchestration.
- No fuzzing / mutation / docs-deploy workflows (tau-specific).
- No changes to the actual build/lint/test/e2e steps, the gateway, or the app.
- No hard coverage gate (P4 stays measurement-only).

## Acceptance criteria

1. `ci.yml` declares workflow-scoped `permissions: contents: read`.
2. On a code PR, `changes` → `rust`/`web`/`e2e` → `ci-summary` all run; a real
   failure in any of `rust`/`web`/`e2e` makes `ci-summary` **fail**.
3. On a docs/markdown-only PR, `rust`/`web`/`e2e` are **skipped** and
   `ci-summary` **passes**.
4. `cancel-in-progress` is `false` for `refs/heads/main`, `true` otherwise.
5. `.github/dependabot.yml` validates and lists the three ecosystems.
6. The three scratch workflow files are gone; `git status` shows only the
   intended additions/edits.
7. All four workflow YAMLs parse (`yaml.safe_load`); `actionlint` clean if
   available.

## Post-merge manual step (repo owner)

GitHub → Settings → Branches → `main` protection → Required status checks:
**require `ci-summary`** and remove the individual `rust` / `web` / `e2e`
requirements. Requiring only `ci-summary` is equivalent to requiring all three
(it depends on them) **and** correctly passes docs-only PRs. This revises §A.3
of `2026-05-31-ci-and-ui-cleanup-design.md`.

## File-change summary

- **Edit:** `.github/workflows/ci.yml` (header, `permissions`, `concurrency`, `changes` job, `if`-guards on `rust`/`web`/`e2e`, `ci-summary` job).
- **New:** `.github/dependabot.yml`.
- **New:** this spec.
- **Delete:** `.github/workflows/ci-summary.yml`, `.github/workflows/auto-update-prs.yml`, `.github/workflows/auto-rerun-flaky.yml`.
