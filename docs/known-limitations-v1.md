# Known v1 limitations (gateway)

Tracked here so Plan 2 (frontend) and future work don't mistake these for bugs.

1. ~~**Assistant prose is live-only; not replayed.**~~ **RESOLVED (2026-05-31).**
   `WsMessage::Snapshot`, `load_trace`, and `GET /api/runs/:id` now carry
   `events: Vec<Event>`, and the frontend store reconstructs `assistantText` from the
   `text_delta` events on both REST replay and WS snapshot. Reopening or deep-linking a
   run (`/runs/:id`) shows the full assistant prose, and the fix also closes the
   WS-connect race that could drop early text on a freshly launched run.

2. **`channels` map grows unbounded.** `AppState` never removes a run's
   `broadcast::Sender` after the run finalizes (`gateway/src/state.rs`). Negligible at
   v1 scale (tens of runs); for a long-lived production gateway, clean it up in
   `finalize` (publish the terminal `RunUpdate` first, then remove the entry).

3. **`TraceDelta::RunUpdated` is dormant.** The variant exists but no v1 adapter emits
   it; it publishes without persisting. Wire persistence if log/otlp adapters ever
   produce it.

4. **Fleet list shows stale token/turn data for in-flight runs.** `GET /api/runs`
   reflects the initial `Running` snapshot until `finalize`. A *completed* run never
   shows as Running (finalize updates the map atomically). Per-run live data is on the
   WS. Acceptable for v1.
