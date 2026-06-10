# CI Philosophy Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align tau-ui's GitHub Actions CI with tau's CI philosophy: least-privilege permissions, a fail-closed `ci-summary` gate, docs-only skip, cache-safe concurrency, and Dependabot.

**Architecture:** A single `ci.yml` carries a fast `changes` gate job; `rust`/`web`/`e2e` run only when non-docs files changed; a final `ci-summary` job aggregates their results (`if: always()`, green when all succeed or skip) and becomes the one required status check. A new `dependabot.yml` adds weekly grouped bumps. Three earlier scratch workflows are removed.

**Tech Stack:** GitHub Actions YAML, `dorny/paths-filter@v3`, `jq`, Dependabot v2.

**Spec:** `docs/superpowers/specs/2026-06-10-ci-philosophy-alignment-design.md`

**Working directory:** `.claude/worktrees/ci-orchestration` (branch `worktree-ci-orchestration`). All commits authored via `git -c user.name=titouanlebocq -c user.email=lebocq.tit@gmail.com`.

---

## File Structure

- `.github/workflows/ci.yml` — **modified** (full rewrite to the designed form). Owns: build/lint/test gating + the fail-closed summary check.
- `.github/dependabot.yml` — **new**. Owns: weekly dependency bumps for github-actions, npm (`/web`), cargo (`/`).
- `.github/workflows/ci-summary.yml`, `auto-update-prs.yml`, `auto-rerun-flaky.yml` — **deleted** (mis-scoped scratch files, never committed).

---

## Task 1: Remove the mis-scoped scratch workflows

**Files:**
- Delete: `.github/workflows/ci-summary.yml`
- Delete: `.github/workflows/auto-update-prs.yml`
- Delete: `.github/workflows/auto-rerun-flaky.yml`

- [ ] **Step 1: Confirm the three files are untracked scratch**

Run: `git -C . status --short .github/workflows/`
Expected: the three files appear as `??` (untracked); `ci.yml` appears as ` M` (modified).

- [ ] **Step 2: Delete the three files**

Run:
```bash
rm .github/workflows/ci-summary.yml \
   .github/workflows/auto-update-prs.yml \
   .github/workflows/auto-rerun-flaky.yml
```

- [ ] **Step 3: Verify they are gone**

Run: `ls .github/workflows/`
Expected: only `ci.yml`, `claude.yml`, `claude-review.yml`, `coverage.yml`.

(No commit — these were never tracked, so there is nothing to record. The deletion is captured implicitly.)

---

## Task 2: Rewrite `ci.yml` to the designed form

**Files:**
- Modify: `.github/workflows/ci.yml` (full file replace)

- [ ] **Step 1: Verify the `jq` gate logic before trusting it**

The `ci-summary` job hinges on one `jq` expression. Prove it fails on a real failure and passes on all-skipped, locally:

Run (must print `FAIL-CASE: gate correctly failed`):
```bash
echo '{"changes":{"result":"success"},"rust":{"result":"failure"},"web":{"result":"success"},"e2e":{"result":"skipped"}}' \
  | jq -e 'to_entries | map(select(.value.result != "success" and .value.result != "skipped")) | length > 0' \
  >/dev/null && echo "FAIL-CASE: gate correctly failed"
```
Expected: prints `FAIL-CASE: gate correctly failed`.

Run (must print `PASS-CASE: gate correctly passed`):
```bash
echo '{"changes":{"result":"success"},"rust":{"result":"skipped"},"web":{"result":"skipped"},"e2e":{"result":"skipped"}}' \
  | jq -e 'to_entries | map(select(.value.result != "success" and .value.result != "skipped")) | length > 0' \
  >/dev/null || echo "PASS-CASE: gate correctly passed"
```
Expected: prints `PASS-CASE: gate correctly passed`.

- [ ] **Step 2: Replace `ci.yml` with the full designed content**

Write `.github/workflows/ci.yml` with exactly:

```yaml
name: CI

# CONTRACT
# --------
# `ci-summary` is the single status check branch protection should
# require on `main`. It is green only when every real job (rust, web,
# e2e) either SUCCEEDED or was legitimately SKIPPED — never green while
# a job failed or was cancelled (fail-closed gating).
#
# DOCS-ONLY PRs
# -------------
# The `changes` job decides whether any non-docs file changed. The
# heavy jobs gate on its `code` output, so a docs/markdown-only PR
# skips rust/web/e2e while `changes` + `ci-summary` still run and
# report green. (Workflow-level `paths-ignore` is intentionally NOT
# used: it would skip `ci-summary` too and leave the required check
# stuck "pending" forever.)
#
# CACHE INTEGRITY
# ---------------
# Superseded runs are cancelled EXCEPT on `main`, where Swatinem/
# rust-cache writes the cache. Cancelling a main run mid-write means
# the write never completes and later PRs restore a stale cache.

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}

permissions:
  contents: read

jobs:
  changes:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: read
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
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - name: rustfmt
        run: cargo fmt --all -- --check
      - name: clippy
        run: cargo clippy --all-targets --all-features -- -D warnings
      - name: build (workspace bins incl. fake-tau-serve)
        run: cargo build --workspace
      - name: test
        run: cargo test --workspace
      - name: ts-rs type-gen drift gate
        run: |
          if ! git diff --quiet -- web/src/types; then
            echo "::error::web/src/types is stale. The Rust Trace model changed without regenerating TS types."
            echo "Run 'cargo test -p tau-gateway' locally and commit the updated web/src/types/*.ts."
            git diff -- web/src/types
            exit 1
          fi

  web:
    needs: changes
    if: ${{ needs.changes.outputs.code == 'true' }}
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: web/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm typecheck
      - run: pnpm vitest run
      - run: pnpm build

  e2e:
    needs: changes
    if: ${{ needs.changes.outputs.code == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - name: build gateway + mock
        run: cargo build --workspace
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: web/pnpm-lock.yaml
      - name: install web deps
        working-directory: web
        run: pnpm install --frozen-lockfile
      - name: install chromium
        working-directory: web
        run: pnpm exec playwright install --with-deps chromium
      - name: e2e
        working-directory: web
        run: pnpm e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            web/playwright-report/
            web/test-results/
          retention-days: 7

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

- [ ] **Step 3: Verify the YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Lint with actionlint if available**

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/ci.yml || echo "actionlint not installed — skipped"`
Expected: either no output (clean) or `actionlint not installed — skipped`.

- [ ] **Step 5: Commit**

Run:
```bash
git add .github/workflows/ci.yml
git -c user.name=titouanlebocq -c user.email=lebocq.tit@gmail.com \
  commit -m "ci: fail-closed ci-summary gate + docs-skip + least-privilege + cache-safe concurrency"
```

---

## Task 3: Add Dependabot config

**Files:**
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Confirm the ecosystem directories**

Run: `ls Cargo.toml web/pnpm-lock.yaml`
Expected: both paths exist (cargo workspace at `/`, pnpm lockfile at `/web`).

- [ ] **Step 2: Create `.github/dependabot.yml`**

Write `.github/dependabot.yml` with exactly:

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
    directory: /web
    schedule:
      interval: weekly
    groups:
      npm-minor-patch:
        update-types: ['minor', 'patch']

  - package-ecosystem: cargo
    directory: /
    schedule:
      interval: weekly
    groups:
      cargo-minor-patch:
        update-types: ['minor', 'patch']
```

- [ ] **Step 3: Verify the YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml')); print('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

Run:
```bash
git add .github/dependabot.yml
git -c user.name=titouanlebocq -c user.email=lebocq.tit@gmail.com \
  commit -m "ci: add Dependabot (github-actions + npm + cargo, weekly, grouped)"
```

---

## Task 4: Final verification

**Files:** none (read-only checks).

- [ ] **Step 1: All workflow YAMLs parse**

Run:
```bash
for f in .github/workflows/*.yml .github/dependabot.yml; do
  python3 -c "import yaml,sys; yaml.safe_load(open('$f')); print('ok: $f')"
done
```
Expected: `ok:` for `ci.yml`, `claude.yml`, `claude-review.yml`, `coverage.yml`, `dependabot.yml`.

- [ ] **Step 2: Scratch files are gone and tree is clean**

Run: `git status --short`
Expected: clean working tree (the two commits from Tasks 2–3 are recorded; no `auto-*`/`ci-summary.yml` present).

- [ ] **Step 3: Confirm the commit log**

Run: `git log --oneline -3`
Expected (top to bottom): the Dependabot commit, the ci.yml commit, and the design-spec commit (`5ee2918`).

---

## Post-merge manual step (repo owner — not code)

GitHub → Settings → Branches → `main` protection → Required status checks:
**require `ci-summary`** and remove the individual `rust` / `web` / `e2e`
requirements. Requiring only `ci-summary` is equivalent to requiring all three
(it `needs` them) and correctly passes docs-only PRs. This revises §A.3 of
`2026-05-31-ci-and-ui-cleanup-design.md`.

## Behavioural verification (after pushing a PR — cannot be tested locally)

1. **Code PR:** `changes` → `rust`/`web`/`e2e` → `ci-summary` all run; `ci-summary` is green.
2. **Inject a failure** (e.g. a `cargo fmt` violation): `rust` fails → `ci-summary` **fails**.
3. **Docs-only PR** (edit only a `*.md`): `rust`/`web`/`e2e` show **skipped**; `ci-summary` is **green**.
4. **`cancel-in-progress`** does not cancel `main` runs (verified by reading the conditional; observable only over time on `main`).
