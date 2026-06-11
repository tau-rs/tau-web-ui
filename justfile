# tau-ui task runner — one set of verbs shared by local dev, git hooks
# (lefthook.yml) and CI (.github/workflows/ci.yml), so that local == CI.
#
# Verbs fan out to BOTH stacks:
#   web   → pnpm   (web/, packageManager pnpm@10.14.0)
#   rust  → cargo  (gateway/ + fake-tau-serve/ workspace at the repo root)
#
# Aggregate verbs (`just lint`, `just ci`, …) run both stacks for local dev.
# Per-stack slices (`…-web` / `…-rust`) let each CI job run only its stack.
# CI jobs and lefthook call the SAME recipe bodies, so the two cannot drift.

set shell := ["bash", "-euo", "pipefail", "-c"]

web := "web"

# Show the available recipes.
default:
    @just --list

# Format both stacks in place (prettier --write + cargo fmt).
fmt: fmt-web fmt-rust
fmt-web:
    cd {{web}} && pnpm format
fmt-rust:
    cargo fmt --all

# Check formatting without writing (CI gate).
fmt-check: fmt-check-web fmt-check-rust
fmt-check-web:
    cd {{web}} && pnpm format:check
fmt-check-rust:
    cargo fmt --all -- --check

# Lint both stacks (eslint + tsc; clippy -D warnings).
lint: lint-web lint-rust
lint-web:
    cd {{web}} && pnpm lint && pnpm typecheck
lint-rust:
    cargo clippy --all-targets --all-features -- -D warnings

# Run unit tests for both stacks (vitest; cargo test --locked).
test: test-web test-rust
test-web:
    cd {{web}} && pnpm vitest run
# Depends on build-rust: the acceptance integration test spawns the built
# fake-tau-serve binary from target/, so the workspace must be built first
# (mirrors CI's build→test order; the rebuild is cache-instant when fresh).
test-rust: build-rust
    cargo test --workspace --locked

# Build both stacks (vite build; cargo build --workspace).
build: build-web build-rust
build-web:
    cd {{web}} && pnpm build
build-rust:
    cargo build --workspace --locked

# Supply-chain audit, both stacks. web: pnpm audit (gates the known vitest/vite
# advisories, ci.yml #33). rust: cargo-deny against deny.toml (advisories +
# licenses + bans + sources, DV2). CI's rust job runs the same check via
# EmbarkStudios/cargo-deny-action; this verb is the local/lefthook entry point.
deny: deny-web deny-rust
deny-web:
    cd {{web}} && pnpm audit --audit-level=moderate
deny-rust:
    cargo deny --all-features check

# Autofix both stacks (local convenience; not run in CI).
fix: fix-web fix-rust
fix-web:
    cd {{web}} && pnpm lint:fix && pnpm format
fix-rust:
    cargo fmt --all
    cargo clippy --all-targets --all-features --fix --allow-dirty --allow-staged

# T1 bundle — exactly what ci.yml's fast gate runs, both stacks.
ci: ci-rust ci-web
ci-rust: deny-rust fmt-check-rust lint-rust build-rust test-rust
ci-web: deny-web lint-web fmt-check-web test-web build-web

# Run the Playwright e2e suite (web) vs the fake-tau-serve mock.
e2e:
    cd {{web}} && pnpm e2e

# T2 heavy bundle — runs e2e locally. The full heavy tier (mutation, coverage,
# SBOM) lives in the dedicated CI workflows (heavy.yml / nightly.yml), not in a
# local verb; this stays a thin local convenience.
heavy: e2e
    @echo "heavy: full mutation / coverage / SBOM tiers run in CI (heavy.yml, nightly.yml)"

# Install git hooks (lefthook); prefer the pinned web binary, else PATH.
hooks:
    @if [ -x {{web}}/node_modules/.bin/lefthook ]; then {{web}}/node_modules/.bin/lefthook install; else lefthook install; fi
