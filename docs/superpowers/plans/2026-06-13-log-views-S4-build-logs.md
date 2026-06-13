# S4 — Ship / build output logs (handoff brief)

> **For agentic workers:** **Brainstorm-first** handoff. The build-output capture seam is new gateway work and must be designed in-session (superpowers:brainstorming) before writing-plans + execution.

**Goal:** Surface build/verify output on the Ship page so a build that fails (or succeeds) shows its log instead of nothing.

**Depends on (committed artifacts only):**
- Spec §3 #5.
- **Frozen contract** `web/src/logs/types.ts` + `web/src/logs/mapEvent.ts` (S1). Reuse `LogStream`.
- Builds on top of S2's Ship toasts where present (not required).

**Read before brainstorming:**
- `web/src/ship/ShipPage.tsx` — current build/verify flow (silent today; `building` boolean only).
- `gateway/src/api/*` ship handlers + the ship/build source (search `build`, `verifyBundle`, `listTargets` in `gateway/src`).
- `gateway/src/adapters/serve.rs` + `gateway/src/store/mod.rs` — the existing event-capture pattern to mirror (build output should become events/records, not a bespoke channel).

**Brainstorm these decisions:**
1. **Capture mechanism:** does `tau build` stream stdout/stderr the gateway can tail (like the workflow JSONL tail in `gateway/src/adapters/log.rs`), or is it a blocking call whose combined output is returned once? This determines live-tail vs after-the-fact.
2. **Data model:** represent build output as run-style `Event`s (reuse store + `LogStream` for free) or a simpler `BuildLog { lines: [...] }` returned by the build endpoint? Prefer reusing the event/store path if `tau build` streams.
3. **Mapping:** if events, extend `eventToLogEntry` is **not** allowed (frozen) — instead write a small `buildLineToLogEntry` mapper in `web/src/logs/` that targets the same `LogEntry` contract.
4. **Where it renders:** an expandable log panel under the build form in `ShipPage`, mounting `LogStream live={building}`.

**Acceptance shape:**
- Gateway captures build output (tests at the boundary: success + failure produce retrievable output).
- `ShipPage` shows a `LogStream` of the latest build; errors visible.
- Frontend + gateway gates incl. `prettier` / `cargo fmt` / `clippy`.

**Next step (print on completion):**
> ✅ **S4 complete.** Ship builds now show their output log.
> **Unblocks nothing further** — S4 is a leaf. Remaining Phase-2 work: S5 (gateway log) if not yet done. S6 (Issues) depends on S3, not S4.
