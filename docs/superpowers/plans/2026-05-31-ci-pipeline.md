# CI Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clean, fast GitHub Actions CI pipeline for tau-web-ui covering Rust (fmt/clippy/test + ts-rs type-gen drift gate), Web (ESLint/Prettier/typecheck/unit/build), and Playwright e2e.

**Architecture:** One workflow `.github/workflows/ci.yml` with three cached, parallel-where-possible jobs (`rust`, `web`, `e2e`). Supporting config: ESLint flat config + Prettier for the web app, new `pnpm` scripts, a pinned package manager + Node 20, and a `reuseExistingServer: !CI` tweak so Playwright always starts fresh in CI. No application code changes.

**Tech Stack:** GitHub Actions, `dtolnay/rust-toolchain`, `Swatinem/rust-cache`, `pnpm/action-setup`, `actions/setup-node`, ESLint 9 (flat config) + typescript-eslint + react-hooks, Prettier, Playwright.

**Source spec:** `docs/superpowers/specs/2026-05-31-ci-and-ui-cleanup-design.md` (Part A).

---

## File structure

```
.github/workflows/ci.yml      # the pipeline (3 jobs)
web/eslint.config.js          # ESLint 9 flat config
web/.prettierrc.json          # Prettier config
web/.prettierignore           # exclude generated/build dirs
web/package.json              # + packageManager, + lint/format/typecheck scripts
web/playwright.config.ts      # reuseExistingServer: !process.env.CI
README.md                     # + CI badge
```

Responsibility boundaries: the workflow file orchestrates; each tool's config lives next to the web app it governs; no job mutates committed files except the drift gate which only *reads* `git diff`.

---

### Task 1: Web lint/format tooling (ESLint + Prettier) + scripts

**Files:**
- Create: `web/eslint.config.js`, `web/.prettierrc.json`, `web/.prettierignore`
- Modify: `web/package.json`

- [ ] **Step 1: Pin the package manager and add scripts**

Determine the installed pnpm version: `pnpm --version`. In `web/package.json`, add a top-level `"packageManager": "pnpm@<that-version>"` (e.g. `"pnpm@9.12.0"`), and add these to `"scripts"` (keep existing `dev`/`build`/`preview`/`test`/`e2e`):

```json
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
```

- [ ] **Step 2: Add ESLint + Prettier dev dependencies**

Run (in `web/`):

```bash
pnpm add -D eslint@^9 @eslint/js@^9 typescript-eslint@^8 eslint-plugin-react-hooks@^5 eslint-plugin-react-refresh@^0.4 prettier@^3 eslint-config-prettier@^9
```

- [ ] **Step 3: Create the ESLint flat config**

Create `web/eslint.config.js`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "src/types", "playwright-report", "test-results", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Test files use globals + are not subject to react-refresh.
  {
    files: ["**/*.test.{ts,tsx}", "e2e/**", "src/test-setup.ts", "*.config.{ts,js}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  prettier,
);
```

> `@typescript-eslint/no-explicit-any` is off because the store tests intentionally use `as any` for partial `Run` fixtures. `src/types` is ignored (generated). `eslint-config-prettier` (last) disables formatting rules that would fight Prettier.

- [ ] **Step 4: Create Prettier config + ignore**

Create `web/.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

Create `web/.prettierignore`:

```
dist
src/types
pnpm-lock.yaml
playwright-report
test-results
coverage
```

- [ ] **Step 5: Auto-format the existing code to a clean baseline, then verify lint**

Run (in `web/`):

```bash
pnpm format
pnpm lint
pnpm typecheck
```

Expected: `format` rewrites files to Prettier style; `lint` exits 0 (fix any real errors it surfaces — e.g. an unused import: remove it; do NOT blanket-disable rules); `typecheck` exits 0. If ESLint reports a genuine `react-hooks/exhaustive-deps` warning, evaluate it — warnings don't fail `pnpm lint` by default, but if it flags a real missing dependency, fix the code.

- [ ] **Step 6: Confirm tests still pass after formatting**

Run: `pnpm vitest run`
Expected: 17 passed (formatting must not change behavior).

- [ ] **Step 7: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "chore(web): add ESLint flat config + Prettier + lint/format/typecheck scripts"
```

---

### Task 2: Playwright CI tweak

**Files:**
- Modify: `web/playwright.config.ts`

- [ ] **Step 1: Make Playwright start its own servers in CI**

In `web/playwright.config.ts`, change BOTH `webServer` entries' `reuseExistingServer: true` to:

```ts
      reuseExistingServer: !process.env.CI,
```

(Locally `CI` is unset → reuse a running dev server; in CI `CI=true` → always start fresh.)

- [ ] **Step 2: Sanity-check the config still parses**

Run (in `web/`): `pnpm exec playwright test --list 2>&1 | head -20`
Expected: lists the 2 tests (`launch a run and watch the live trace build`, `cancel mid-run`) without a config error. (It may try to start servers — that's fine; Ctrl-C / it lists first. If `--list` still boots servers in your Playwright version, instead run `node --check`-style: `pnpm exec tsc --noEmit playwright.config.ts` is not valid; simply confirm `pnpm build` still passes since the config is TS.)

- [ ] **Step 3: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/playwright.config.ts
git commit -m "test(e2e): start fresh servers in CI (reuseExistingServer: !CI)"
```

---

### Task 3: The CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  rust:
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
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
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
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - name: build gateway + mock
        run: cargo build --workspace
      - uses: pnpm/action-setup@v4
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
```

> Note: the `rust` job runs `cargo test` which regenerates `web/src/types` via the ts-rs export tests; the drift gate then checks `git diff`. The `web` and `e2e` jobs check out a fresh tree (committed types), so their `web/src/types` is always the committed copy.

- [ ] **Step 2: Validate the YAML locally (optional but recommended)**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit and push to trigger CI**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions pipeline (rust + web + e2e)"
git push
```

- [ ] **Step 4: Watch the run and confirm green**

Run: `gh run watch --exit-status` (or `gh run list --limit 1` then `gh run view <id>`)
Expected: all three jobs (`rust`, `web`, `e2e`) succeed. If a job fails, read its log:
- `rust` fmt failure → run `cargo fmt --all` locally, commit.
- `rust` clippy failure → fix the lint (or `#[allow]` with justification only if truly intended), commit.
- `rust` drift gate failure → run `cargo test -p tau-gateway` locally, commit the regenerated `web/src/types/*.ts`.
- `web` lint/format failure → `pnpm lint:fix && pnpm format` locally, commit.
- `e2e` failure → download the `playwright-report` artifact, diagnose; a selector/timing issue is a real bug to fix, not to retry.

Do not proceed to Task 4 until CI is green on the PR.

---

### Task 4: README badge + branch protection note

**Files:**
- Modify: `README.md`
- Create: `docs/ci.md`

- [ ] **Step 1: Add the CI badge to the README**

At the very top of `README.md`, under the `# tau-web-ui` heading, add:

```markdown
[![CI](https://github.com/LEBOCQTitouan/tau-web-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/LEBOCQTitouan/tau-web-ui/actions/workflows/ci.yml)
```

- [ ] **Step 2: Document required-checks setup**

Create `docs/ci.md`:

```markdown
# CI

`.github/workflows/ci.yml` runs three jobs on every push to `main` and every PR:
- **rust** — `cargo fmt --check`, `clippy -D warnings`, `cargo build`, `cargo test`, and a ts-rs type-gen drift gate (`git diff web/src/types`).
- **web** — ESLint, Prettier check, `tsc --noEmit`, Vitest, `vite build`.
- **e2e** — builds the gateway + mock, installs Chromium, runs the Playwright suite; uploads a report artifact on failure.

## Make the checks required on `main`
Either in the GitHub UI (Settings → Branches → add rule for `main` → require status checks `rust`, `web`, `e2e`), or via:

\`\`\`bash
gh api -X PUT repos/LEBOCQTitouan/tau-web-ui/branches/main/protection \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[checks][][context]=rust' \
  -f 'required_status_checks[checks][][context]=web' \
  -f 'required_status_checks[checks][][context]=e2e' \
  -F 'enforce_admins=true' \
  -F 'required_pull_request_reviews=' \
  -F 'restrictions='
\`\`\`

(Run after at least one CI run exists so the check contexts are known.)
```

- [ ] **Step 3: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add README.md docs/ci.md
git commit -m "docs(ci): add CI badge + required-checks setup notes"
```

---

## Self-review

1. **Spec coverage (Part A):** A.2 jobs → Task 3 (all three jobs, drift gate, artifact upload). A.3 supporting: scripts + packageManager → Task 1; ESLint/Prettier configs → Task 1; `reuseExistingServer: !CI` → Task 2; README badge → Task 4; branch-protection note → Task 4. A.4 acceptance → covered by Task 3 Step 4 (green run) + the per-tool failure modes listed. ✓
2. **Placeholder scan:** no TBD/TODO; every config file is given in full. ✓
3. **Consistency:** job names `rust`/`web`/`e2e` match between the workflow and the branch-protection contexts; pnpm scripts referenced by the `web` job (`lint`, `format:check`, `typecheck`, `vitest run` via `pnpm vitest run`... note: the `web` job calls `pnpm vitest run` directly, not the `test` script — both work; `test` script is `vitest run`). The `e2e` job uses `pnpm e2e` which maps to `playwright test`. ✓
4. **Gap check:** the `web` job runs `pnpm vitest run` rather than `pnpm test` — both are equivalent; keep `pnpm vitest run` for clarity. The drift gate assumes `cargo test` writes `web/src/types` (it does, via ts-rs export tests + `.cargo/config.toml`). ✓
