# S5 — Gateway system log (handoff brief)

> **For agentic workers:** **Brainstorm-first** handoff. Adds a `tracing` sink + log endpoint to the gateway — design in-session (superpowers:brainstorming) before writing-plans + execution.

**Goal:** Expose the gateway's own `tracing` output (currently stderr-only) to a dev/ops viewer in the UI, reusing `LogStream`.

**Audience note:** this is a **developer/operator** surface, not an end-user feature. Keep it behind a clearly-labeled "System log" view, low-prominence in nav.

**Depends on (committed artifacts only):**
- Spec §3 #7.
- **Frozen contract** `web/src/logs/types.ts` (S1). Reuse `LogStream`.
- Independent of S3/S4 — fully parallel.

**Read before brainstorming:**
- Gateway `tracing` usage: `grep -rn "tracing::" gateway/src` (e.g. `main.rs`, `serve_client/mod.rs:154`).
- `gateway/src/main.rs` — where the `tracing_subscriber` is initialized (the sink attaches here).
- `gateway/src/api/ws.rs` — SSE/WS pattern for streaming to the browser.

**Brainstorm these decisions:**
1. **Sink:** add a custom `tracing_subscriber` layer that pushes structured records into a bounded ring buffer (cap N lines — **log the cap**), exposed via `GET /api/gateway/log` (snapshot) and/or an SSE stream for live tail.
2. **Structure:** map `tracing` level (TRACE/DEBUG/INFO/WARN/ERROR) → `LogLevel`; fields → `LogEntry.detail`. Write a `traceRecordToLogEntry` mapper in `web/src/logs/` targeting the frozen `LogEntry` (do **not** edit the frozen mapper).
3. **Scope/security:** gateway log is project-agnostic (global). Confirm it exposes nothing sensitive (tokens/credentials) — redact or exclude credential spans. This is a hard requirement, not optional.
4. **Placement:** a dedicated low-key route (e.g. under a "System"/"Diagnostics" area), not the per-project sidebar's primary list.

**Acceptance shape:**
- Gateway ring-buffer sink + endpoint with Rust tests (records captured, cap honored, credentials excluded).
- `web/src/logs/GatewayLogPage.tsx` mounting `LogStream`.
- Gates incl. `prettier` / `cargo fmt` / `clippy`.

**Next step (print on completion):**
> ✅ **S5 complete.** Gateway system log viewable in-UI (redacted, capped).
> **Leaf session** — unblocks nothing. If S3/S4 still open, they're independent. S6 (Issues) depends on S3.
