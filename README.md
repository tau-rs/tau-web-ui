# tau-web-ui

[![CI](https://github.com/LEBOCQTitouan/tau-web-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/LEBOCQTitouan/tau-web-ui/actions/workflows/ci.yml)

Local dev-and-monitoring UI for [tau](https://github.com/LEBOCQTitouan/tau). Two crates + a web app:

- `gateway/` — Rust/axum service fronting `tau serve` behind a stable HTTP+WS API.
- `fake-tau-serve/` — faithful mock of the `tau serve` wire protocol for dev/test (real `tau serve` is not yet implemented upstream).
- `web/` — React + Vite UI (see Plan 2).

## Pinned tau contract
- Source: tau serve design doc `2026-05-17-tau-serve-mode-design.md`.
- Pinned at tau commit `58f6ba6`, branch `feat/tau-serve-mode`, version `0.0.0`.
- Wire contract snapshot: `docs/tau-contract-v1.md`.

## Run against the mock
```
cargo run -p tau-gateway -- --project ./fixtures/demo --tau-bin ./target/debug/fake-tau-serve
```

## Run against real tau (when serve lands)
```
TAU_BIN=/path/to/tau cargo run -p tau-gateway -- --project /path/to/tau/project
```

## Local development

[`just`](https://github.com/casey/just) is the one place every check is
defined; the same verbs run locally, in git hooks, and in CI (`ci.yml`), so
local == CI. Each verb fans out to **both** stacks (web via pnpm, Rust gateway
via cargo); `…-web` / `…-rust` slices run a single stack.

```
just            # list all recipes
just fmt        # format both stacks (prettier --write + cargo fmt)
just lint       # eslint + tsc + clippy -D warnings
just test       # vitest + cargo test --locked
just deny       # supply-chain audit (pnpm audit + cargo-deny against deny.toml)
just ci         # the full T1 gate CI runs (lint + test + audit + build, both)
just fix        # autofix: eslint --fix + prettier + cargo fmt + clippy --fix
```

Git hooks are managed by [lefthook](https://github.com/evilmartians/lefthook)
(installed via `pnpm install`):

```
just hooks      # install the pre-commit / pre-push hooks
```

- **pre-commit** (seconds): `just fmt` + `just lint` — fast static checks only.
- **pre-push** (bounded): `just test` + `just deny`.

Heavy checks (e2e, full OS matrix, mutation) never run in hooks — they live in
the CI tiers.
