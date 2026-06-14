# Sessions view — list, inspect, and export persisted tau chat sessions

**Date:** 2026-06-13
**Status:** design approved, pending spec review → implementation plan
**Track:** Track 2 of the tau-ui ↔ tau feature-gap handoffs (`.context/handoffs/02-sessions-view.md`)
**Precedent:** D2b Skills seam (`gateway/src/skills/mod.rs`, `2026-06-13-skills-real-tau-reads-design.md`) — this mirrors its `Mock*`/`Cli*` shell-out pattern.

## Summary

tau persists every `tau chat` session to disk and ships a full read surface over them
(`tau session list/show/export/delete`). The UI today has **zero** view of these — it
only surfaces live *runs* (serve `runtime.run_streaming` traces). This adds a net-new,
**read-only** Sessions surface: a paginated list, a transcript detail page, and file
export. It is shippable today — the read verbs exist; no tau change is required.

This surface is read-only *by nature*: tau serve has no multi-turn chat method, so the UI
can view persisted sessions but cannot create or resume one (see Out of scope).

## Verified tau seam

Read from `/Users/titouanlebocq/code/tau` source (binary not built; shapes confirmed from
`crates/tau-cli/src/cmd/session/` and `crates/tau-cli/src/session/store.rs`). Fixture
tests pin every shape below; if the live binary diverges, the parser is the single place
to adjust.

| Verb | Invocation | `--json`? | Output |
|---|---|---|---|
| list | `tau session list [--agent A] [--global] [--limit N] [--all] --json` | yes (JSONL) | envelope `{"event":"sessions","total","limit"}` then one `{"event":"session","id","prefix","agent","created_at","turns","title"}` per row |
| show | `tau session show <id> [--global] --json` | yes (JSONL passthrough) | header line + `{"type":"message","msg":<Message>}` + `{"type":"turn_summary","turn","stop_reason","input_tokens?","output_tokens?"}` |
| export | `tau session export <id> --format jsonl\|md\|json [--global]` | **ignored** — format set by `--format` only | jsonl=raw lines; json=`{header,messages,turn_summaries}` envelope; md=rendered transcript |
| delete | `tau session delete <id> [--global] [--force] --json` | yes | `{"event":"deleted","id"}` — **out of scope (read-only v1)** |

On-disk (`session/store.rs`, the durable contract): JSONL at `<project>/.tau/sessions/<uuid>.jsonl`
(project) or `~/.tau/sessions/` (global). Header line is `{type:"header", schema:1, id,
created_at, agent_id, package{name,version,resolved_commit}, llm_backend, title?}`. The
`schema:1` field + the `SessionHeader`/`TurnSummary` structs are a stable contract; the
inner `msg` body (`tau_domain::Message`) is **not** documented.

Id resolution: full 36-char UUID, or an 8+ char prefix. A prefix matching 2+ sessions
yields tau's `AmbiguousPrefix` error (distinct from not-found).

## Scope decisions (resolved in brainstorming)

| # | Question | Decision |
|---|---|---|
| 1 | Scope model | **Project-only v1.** Routes nest under `/api/projects/{pid}/sessions`; gateway shells in the project dir (no `--global`). The `Cli` seam carries a `global: bool` parameter from day one so adding global later is a query-param, not a rewrite. Global sessions deferred. |
| 2 | List columns / paging | Columns **id(prefix) · agent · created · turns**. `title` dropped (always null at tau v0.1). **Client-side pagination + agent filter, page size 25** — gateway returns the full ordered list once (`--all`); web slices and filters. tau has no offset flag, so paging must live above the CLI; the agent filter is therefore also client-side over the fetched list (tau's `--agent` flag unused in v1 — no re-shell). |
| 3 | Delete | **Excluded (read-only v1).** No mutating routes. Delete stays a CLI op; revisit as a focused follow-up. |
| 4 | Export | **All three formats** (jsonl, md, json). Gateway streams `tau session export --format <f>` stdout to the browser as a download. |
| 5 | Sessions vs Runs / rendering | **Separate nav entry** under "Operate" (between Runs and Ship); no cross-linking (different subsystems, no shared id). Transcript rendered by a **dedicated `SessionTranscript`** component, not a `TraceView` reuse (TraceView is bound to the live-run Zustand store; poor fit). |
| 6/D1 | How gateway builds detail JSON | Shell `tau session export --format json` — tau already emits the exact `{header,messages,turn_summaries}` envelope; gateway parses once and re-serves. (Not `show --json` line-folding.) |
| 6/D2 | Message typing | **Passthrough only the `msg` body** (`messages: Vec<serde_json::Value>`); type `header` + `turn_summaries` (those are contracted via `schema:1`). Web renders messages defensively with a JSON `<pre>` fallback. Forward-compatible: when tau documents the `Message` contract, the web swaps one helper to typed rendering — gateway unchanged, no data loss. |
| 7/D3 | Ambiguous short-id | Distinct **409** + candidate list (surfaces tau's `AmbiguousPrefix`), not folded into 404. |

## Architecture

```
state.rs::with_options(is_mock)
        ├─ is_mock ─▶ MockSessions      → seeded fixture session(s) (fake-tau-serve has no CLI)
        └─ real    ─▶ CliSessions{bin, project}   shells in project cwd:
                         ├─ tau session list --all --json        → Vec<SessionSummary>
                         ├─ tau session export <id> --format json → SessionDetail   (D1)
                         └─ tau session export <id> --format <f>  → Vec<u8>          (streamed)
```

New module `gateway/src/sessions/mod.rs`:

```rust
pub trait SessionsSource: Send + Sync {
    fn list(&self) -> Result<Vec<SessionSummary>, SessionError>;
    fn show(&self, id: &str) -> Result<SessionDetail, SessionError>;
    fn export(&self, id: &str, fmt: ExportFormat) -> Result<Vec<u8>, SessionError>;
}
```

`MockSessions` holds an in-memory fixture (one seeded session: a header + 2–3 messages +
turn summaries) so the mock tier and `fake-tau-serve` runs have data to render.
`CliSessions { bin, project, global: bool }` (global=false in v1) shells via a shared
`run(&[&str]) -> (bool, String, String)` helper using
`Command::new(&bin).args(args).current_dir(&project).output()` — copied from
`CliInstalled::run`.

`state.rs`: add `sessions_source: Box<dyn SessionsSource>` to `Inner`, wire it in
`with_options` behind `is_mock`, and expose `list_sessions`, `show_session`,
`export_session` on `AppState` (thin delegations).

### Wire types (ts-rs exported, mirrors `SkillSummary`/`SkillDetail`)

```rust
pub struct SessionSummary {              // list row
    pub id: String, pub prefix: String, pub agent: String,
    pub created_at: String, pub turns: u32,
}
pub struct SessionDetail {               // detail envelope
    pub header: SessionHeader,
    pub messages: Vec<serde_json::Value>,   // opaque passthrough (the one uncontracted field)
    pub turn_summaries: Vec<TurnSummary>,
}
pub struct TurnSummary {
    pub turn: u32, pub stop_reason: String,
    pub input_tokens: Option<u64>, pub output_tokens: Option<u64>,
}
pub struct SessionHeader {               // stable per schema:1
    pub id: String, pub created_at: String, pub agent_id: String,
    pub llm_backend: String, pub package: SessionPackage,
}
pub struct SessionPackage { pub name: String, pub version: String, pub resolved_commit: String }
pub enum ExportFormat { Jsonl, Md, Json }
```

`serde_json::Value` over ts-rs: follow whatever the repo already does for passthrough JSON
(verify during implementation; if ts-rs needs a concrete alias, export `messages` as a
`JsonValue`/`any` type — it must not require typing the `Message` body).

### Errors (`thiserror` at this boundary)

```rust
pub enum SessionError {
    NotFound(String),          // 404
    AmbiguousPrefix(Vec<String>), // 409 — candidate prefixes
    BadFormat(String),         // 400 — invalid export format / invalid id
    MalformedOutput(String),   // 502 — tau output not parseable
    Tau(String),               // 502 — spawn / non-zero exit
}
```

Note this seam uses `thiserror` (a typed boundary with distinct HTTP mappings), unlike the
D2b Skills seam which used silent-empty + `anyhow`. The list path may still degrade to `[]`
on spawn failure (tolerant, like Skills) — but `show`/`export` need typed errors to drive
404/409, so the enum is shared across all three.

**Arg guards (before shelling):** reject any id not matching `^[0-9a-fA-F-]{8,36}$`
(→ `BadFormat`); only `jsonl|md|json` reach `--format` (parsed from the `ExportFormat`
enum, so unreachable by construction from the route, but validated at the query-param
boundary). Prevents flag/argument injection into the tau invocation.

### Routes (`gateway/src/api/sessions.rs`, registered in `api/mod.rs`)

```
GET /api/projects/{pid}/sessions                       → Json<Vec<SessionSummary>>   (full list)
GET /api/projects/{pid}/sessions/{id}                  → Json<SessionDetail>          (404/409/502)
GET /api/projects/{pid}/sessions/{id}/export?format=…  → bytes + Content-Disposition
```

Handlers use the `Scoped` extractor (per `api/scope.rs`). Export sets `Content-Type`
(`application/x-ndjson` / `text/markdown` / `application/json`) and
`Content-Disposition: attachment; filename="session-<prefix>.<ext>"`. `format` defaults to
`jsonl` when absent; an unknown value → 400.

## UI

New page set under `web/src/sessions/`, route in `App.tsx`, nav entry in `Sidebar.tsx`
("Operate" group, `{ to: "sessions", label: "Sessions", icon: "◎" }`, between Runs and
Ship — **not** gated). API client `web/src/api/sessions.ts` mirroring `api/skills.ts`
(`listSessions`, `getSession`; export is a direct `<a href>` download to the scoped URL).

- **`SessionsPage`** (list): fetch full list on mount via `useProjectId()`; agent filter
  input (client-side substring on `agent` over the fetched list); table id·agent·created·turns
  with id linking to detail; client-side pagination footer (Prev / page numbers / Next),
  page size 25. Filtering and paging compose client-side: filter narrows the list, paging
  slices the filtered result.
- **`SessionDetailPage`**: header strip (id, agent, llm_backend, package, created_at) +
  export `<select>` (jsonl/md/json) + Download; stat tiles (turns, summed input/output
  tokens from `turn_summaries`); the transcript.
- **`SessionTranscript`**: renders the interleaved `messages` + `turn_summaries` in order.
  Each message: derive a role (`role`/`from`/fallback "message") and best-effort text
  (`text` / `payload.text` / `content`); if no text field is found, render the raw value in
  a `<pre>` JSON fallback block. Turn summaries render as inline dividers
  (`turn N · stop_reason · in/out tokens`). User messages right-aligned in accent tint,
  others left in surface cards — reuse existing Tailwind tokens (`bg-surface`,
  `border-border`, `text-muted`, `accent`). No dependency on the run store.

Ordering note: `messages` and `turn_summaries` are separate arrays in the envelope, but the
on-disk file interleaves them (a turn summary follows its turn's messages). v1 renders all
messages, then groups each turn summary after its `turn`-th boundary using the turn index;
exact interleave fidelity is a refinement if it matters — the data needed is present.

## Testing

- **Mock tier is the contract.** New `gateway/tests/sessions_api.rs` runs against the
  in-process mock (`is_mock=true`, `fake-tau-serve` bin, `fixtures/demo` project) — pins the
  wire shape of all three routes incl. 404/409/400 status codes. Mirrors `skills_api.rs`.
- **Parser unit tests (always-on).** Checked-in fixtures under
  `gateway/tests/fixtures/tau-json/` for real `tau session list --json` and
  `session export --format json`; unit-test parse into `SessionSummary` / `SessionDetail`,
  including malformed-output tolerance (→ `MalformedOutput`) and ambiguous/not-found mapping.
- **Gated real round-trip.** `gateway/tests/real_tau_sessions.rs`, env-gated on
  `TAU_REAL_BIN` (skip if unset/missing), HOME-isolated. Because creating a session needs
  `tau chat` (interactive), this test either (a) writes a known `.tau/sessions/<id>.jsonl`
  fixture into a temp project and asserts list→show→export read it back, or (b) is skipped
  if that proves brittle. Prefer (a) — it exercises the real CLI's read path against the
  durable on-disk contract without an interactive chat.
- **Web tests.** `api/sessions.test.ts` (URL/method, percent-encoding of id like
  `skills.test.ts`); `SessionsPage.test.tsx` (renders rows + links, pagination); a
  `SessionTranscript` test covering the JSON-fallback branch for an unrecognized message.

## Implementation order (parallelizable streams)

1. **Gateway core** — `sessions/mod.rs` (trait, types, `MockSessions`, `CliSessions`,
   `SessionError`), parser + unit tests, ts-rs exports. *(blocks 2, 4)*
2. **Gateway API** — `api/sessions.rs` routes + `api/mod.rs` registration + `state.rs`
   wiring + `sessions_api.rs`. *(after 1)*
3. **Web API + types** — `api/sessions.ts`, regenerate/confirm TS types, `sessions.test.ts`.
   *(after 1's ts-rs export; can overlap 2)*
4. **Web pages** — `SessionsPage`, `SessionDetailPage`, `SessionTranscript`, route + nav,
   tests. *(after 3)*
5. **Real round-trip test + docs** — `real_tau_sessions.rs`; update `docs/seams.md` /
   `tau-contract-v1.md` if they enumerate seams. *(after 2)*

Each frontend task's gate runs `prettier` (per-task gates omit `format:check`, so it drifts
otherwise — repo convention). Shared-file edits to watch at converge: `api/mod.rs` (route
table), `state.rs` (seam selection), `App.tsx` + `Sidebar.tsx` (route + nav) — all
append-only, low-conflict.

## Out of scope (named, not silently dropped)

- **Creating / resuming sessions from the UI** — blocked on a tau *serve-side* multi-turn
  method (serve only has `runtime.run`/`run_streaming` with `{agent, prompt}`, no session
  id). The natural next gap once tau exposes a serve session method.
- **Global-scope sessions** — seam is built `--global`-ready; surfacing them is a follow-up
  (needs a scope toggle + a routing decision for non-project-nested rows).
- **Delete** — `tau session delete --force` exists; deferred to keep v1 a pure read surface.
- **Ask tau to document the `Message` wire contract** — would let the web upgrade the
  defensive renderer to typed rendering (additive, gateway unchanged). Filed as a tau-side
  follow-up; not a prerequisite for this track.
- **Exact message/turn interleave fidelity** in the transcript — v1 groups by turn index.
