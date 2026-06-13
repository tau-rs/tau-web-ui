# S3 — Project-wide event feed (handoff brief)

> **For agentic workers:** This is a **brainstorm-first** handoff: the backend query path is new and must be designed in-session (superpowers:brainstorming) before writing-plans + execution. Do NOT skip to coding — the endpoint shape is the deliverable's risk.

**Goal:** A top-level "Logs" sidebar route that aggregates events across **all runs** in a project into one reverse-chron, filterable stream; clicking an entry jumps to its trace.

**Depends on (committed artifacts only — no S1 chat context):**
- Spec `docs/superpowers/specs/2026-06-13-log-views-program-design.md` (§3 #4, §5).
- **Frozen contract** `web/src/logs/types.ts` + `web/src/logs/mapEvent.ts` (shipped by S1). Reuse `LogStream` and `LogEntry` directly — do not fork them.

**Read before brainstorming:**
- `gateway/src/store/mod.rs` — per-run NDJSON; events are per-run only today. A cross-run read is the new work.
- `gateway/src/api/projects.rs:22-29` — existing cross-run **run-header** endpoint (`/api/projects/runs`, status filter). Mirror its shape for events.
- `gateway/src/api/ws.rs`, `web/src/api/client.ts` — existing event/trace transport.
- `web/src/App.tsx:24-41` (route table), `web/src/app/AppShell.tsx` (sidebar nav) — where the route + nav item slot in.

**Brainstorm these decisions (the risk surface):**
1. **Query path:** new `GET /api/projects/:pid/events?since=…&kind=…&limit=…` returning `Vec<Event>` across runs? Aggregating per-run NDJSON on read may not scale — decide: read-time scan with a `limit`/time-window cap, or an append-only project-level index. **Log any cap you impose (no silent truncation).**
2. **Live vs snapshot:** does the feed live-tail (new WS/SSE multiplexing all running runs) or poll a REST window? Recommend REST + poll for v1 (reuse the poll-scheduler pattern in `store.ts`); defer multiplexed live tail.
3. **Filters:** run id, agent, kind, level, time window, full-text. `LogStream` already does level/kind/query client-side; server handles time-window + limit.
4. **Entry → trace navigation:** `onEntryClick` navigates to `/projects/:pid/runs/:runId` and selects the span.

**Acceptance shape:**
- New gateway endpoint with Rust tests at the boundary (shape, limit honored, status/kind filter).
- New `web/src/logs/ProjectLogsPage.tsx` mounting `LogStream` + sidebar nav entry + route.
- Maps server `Event[]` via the **frozen** `eventToLogEntry`.
- Per-task gates include `prettier` (frontend) and `cargo fmt`/`clippy` (gateway).

**Next step (print on completion):**
> ✅ **S3 complete.** Project-wide Logs feed live; cross-run event endpoint shipped.
> **Unblocked:** S6 (Issues) builds on this endpoint — open `docs/superpowers/plans/2026-06-13-log-views-S6-issues.md`.
