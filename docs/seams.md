# Deferred surfaces — designed seams (handoff spec §4)

These are NOT built in v1. Each has a named home + a stub so adding it is additive,
never a redesign. Every adapter produces the same `TraceDelta`/Trace model.

| Surface | Home (file) | Gating tau dependency |
|---|---|---|
| ① Graph editor (Workflow IR) | `web/src/graph/` (Plan 2 stub) + future `POST /api/build-from-ir` | tau β.2 Workflow IR (framing D) |
| ② Project/Config | future `GET/PUT /api/project/config` + `adapters` cli-json | tau δ.1 resolver |
| ③ Targets & Build | future `POST /api/build`, `GET /api/targets`, `GET /api/runs/:id/conformance` | tau B/C.2/γ, β.6 |
| ⑥ Checks/Health | future `POST /api/check` → SARIF render | available now (tau check --json/--sarif) |
| log-adapter (workflows) | `gateway/src/adapters/log.rs` | tau workflow JSONL (exists) — wire when workflow surface lands |
| otlp-adapter (prod) | `gateway/src/adapters/otlp.rs` | tau artifacts emitting OTLP |
| wasm/c-abi/mcu substrates | new `adapters/{wasm,cabi,mcu}.rs` | tau γ.2/3/4/5 |

Cross-cutting: `Substrate`/`Mode` already exist on `Run` as enums; deferred substrates
and prod mode are filters/badges, never new screens (spec §1.3).

## Why no holes
- New tau verb → one more command call (no API shape change).
- New substrate → one more ingest adapter emitting `TraceDelta` (no frontend change).
- The Trace model is OTLP-shaped (parent_id, started/ended, attributes) so otlp-adapter is a thin map.
