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
