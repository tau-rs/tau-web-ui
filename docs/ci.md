# CI

`.github/workflows/ci.yml` runs three jobs on every push to `main` and every PR (concurrency-cancelled per ref):

- **rust** — `cargo fmt --check`, `clippy -D warnings`, `cargo build --workspace`, `cargo test --workspace`, and a **ts-rs type-gen drift gate** (`git diff --quiet -- web/src/types`): the test run regenerates the TypeScript bindings, so a stale `web/src/types` (Rust model changed without regenerating) fails the job.
- **web** — ESLint, Prettier `--check`, `tsc --noEmit`, Vitest, `vite build`.
- **e2e** — builds the gateway + mock, installs Chromium (`playwright install --with-deps chromium`), runs the Playwright suite; uploads a `playwright-report` artifact on failure.

## Branch protection (required checks on `main`)
Applied via the GitHub API (run after at least one CI run exists so the check contexts are known):

```bash
gh api -X PUT repos/LEBOCQTitouan/tau-web-ui/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "checks": [
    { "context": "rust" }, { "context": "web" }, { "context": "e2e" }
  ]},
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

- `strict: true` — branches must be up to date with `main` before merging.
- `enforce_admins: false` — the repo owner can still push directly in an emergency; normal flow goes through PRs with green checks.
- `required_pull_request_reviews: null` — no mandatory reviewer (solo repo); flip to an object to require approvals.

To inspect current protection: `gh api repos/LEBOCQTitouan/tau-web-ui/branches/main/protection`.
