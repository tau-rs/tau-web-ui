# S6 — Error grouping / "Issues" (handoff brief)

> **For agentic workers:** **Brainstorm-first** handoff and the largest item in the program. Error fingerprinting is a design problem — brainstorm in-session (superpowers:brainstorming) before writing-plans + execution. Do not start until **S3 has merged** (this builds on its cross-run event endpoint).

**Goal:** Sentry's signature view — group/deduplicate errors into "Issues" with occurrence count, first/last-seen, and affected runs. The unit is an *issue*, not a log line, so this is a **new view**, not a `LogStream`.

**Depends on (committed artifacts only):**
- Spec §3 #6, §4 (hard edge: S3 → S6).
- **S3's cross-run event endpoint** (committed). Reuse it as the error source.
- Frozen contract `web/src/logs/types.ts` for the per-issue occurrence list (each occurrence can render as a `LogEntry`).

**Read before brainstorming:**
- `gateway/src/trace/mod.rs:60-63` — `RunError { kind, detail }` and the error kinds (`gateway_restart`, `FatalError`, `rpc:<code>`, `step_failed`, `workflow_error`) populated in `gateway/src/state.rs`.
- The `fatal_error` event payload (`gateway/src/adapters/serve.rs:179-186`) — message/variant fields to fingerprint on.
- S3's endpoint (whatever shape it shipped).

**Brainstorm these decisions (fingerprinting is the whole ballgame):**
1. **Fingerprint:** what makes two errors "the same issue"? Candidate key = `(error.kind, normalized message)` where normalization strips run-specific noise (ids, paths, timestamps, numbers). Get this wrong and you either over-merge (distinct bugs collapse) or under-merge (one bug = 100 issues). Prototype on real data.
2. **Where it computes:** gateway-side aggregation endpoint (`GET /api/projects/:pid/issues`) vs client-side grouping over S3's events. Recommend **gateway-side** for stable counts and so it can scale; client grouping is acceptable for a v0 spike.
3. **Issue shape:** `Issue { fingerprint, kind, title, count, first_seen, last_seen, run_ids[] }`.
4. **View:** new "Issues" route/tab — list of issues sorted by last_seen/count; drill into an issue → its occurrences (each an `onEntryClick` → trace) reusing `LogStream`.

**Acceptance shape:**
- Fingerprinting with Rust tests proving stability (same error → same fingerprint; distinct errors → distinct) across the known `RunError` kinds.
- Aggregation endpoint + tests (counts, first/last-seen).
- `web/src/logs/IssuesPage.tsx` (list + drill-in).
- Gates incl. `prettier` / `cargo fmt` / `clippy`.

**Next step (print on completion):**
> ✅ **S6 complete.** Error grouping / Issues view shipped. **This is the final session** — the full log-views program (per-run logs, failure detail, toasts, project feed, build logs, gateway log, issues) is now complete.
> Consider revisiting the spec's "out of scope" list (alerting on issues, IR/bundle inspector #50) for future work.
