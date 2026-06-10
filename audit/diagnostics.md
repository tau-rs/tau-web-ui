# Diagnostics findings — tau-web-ui

How are errors surfaced to users and developers? How observable are backend
failures? The short answer: **errors are systematically discarded**, both for the user
and the developer. There is no logging, no error boundary, and no connectivity/observability
surface beyond two status dots.

## G1 — Backend/network failures are discarded with no developer signal either
**Severity:** High
**Location:** 38 `.catch(() => {})` sites across `web/src` (see `design.md` D10 for the list); `web/src/store/store.ts:74-93,103-109` (`loadHealth`/`loadProjects`/`loadWorkflows` all `catch {}`)

Every catch site discards the error object entirely — it is neither shown to the user
(D10) **nor** logged. There is not a single `console.error`/`console.warn` in
`web/src` (verified by grep). So when the gateway 500s or a request fails, there is no
breadcrumb in the devtools console, no error message in the UI, and no telemetry. A
developer debugging "why is the agents list empty?" has nothing to go on.

**Impact:** Failures are invisible to users *and* undiagnosable by developers.
**Recommendation:** At minimum `console.error` in catch handlers; better, route errors
through a small logger/error-bus that both logs and feeds a user-visible surface.

## G2 — WebSocket has no error/close/reconnect handling; drops are silent
**Severity:** High
**Location:** `web/src/api/client.ts:80-91`, `web/src/store/store.ts:116-132`

`openRunSocket` wires only `onmessage`. There is no `onerror`, no `onclose`, and no
reconnect. If the socket drops mid-run (gateway restart, network blip, proxy timeout)
the live trace simply **stops updating** with no indication — the run appears frozen at
its last frame, indistinguishable from a stalled run. Malformed frames are also
swallowed (`catch {}` at `client.ts:86`), hiding protocol drift between the UI and
`tau serve`. The store never learns the socket died, so `RunControls` keeps showing a
"Cancel" button for a connection that's gone.

**Impact:** Silent loss of live telemetry; users stare at a stale trace believing it's
live.
**Recommendation:** Handle `onerror`/`onclose`, show a "connection lost — reconnecting"
banner, attempt bounded reconnect (re-fetch the REST snapshot to resync), and log
decode failures.

## G3 — Success is reported on failure (false-positive diagnostics)
**Severity:** High
**Location:** `web/src/config/ConfigPage.tsx:31-43`

Beyond hiding errors, `ConfigPage` actively reports the **wrong** outcome: a failed
`putConfig`/`importAgent` still flips to "✓ saved to tau.toml" / reloads as if it
worked (detailed in `design.md` D11). This is worse than silence — the diagnostic
signal is inverted.

**Impact:** Operators trust state that was never persisted.
**Recommendation:** Tie the success indicator to a resolved promise; show the rejection.

## G4 — No error boundary: a single bad render blanks the app with only a console trace
**Severity:** Medium
**Location:** `web/src/main.tsx:8-14`, `web/src/App.tsx`

`<App/>` is mounted with no surrounding error boundary. The app renders backend-derived
shapes optimistically (`as Record<string, unknown>` casts in `SpanInspector.tsx:26`,
unchecked `attributes`/`payload` access). If any of those assumptions break at runtime,
React unmounts the whole tree and the user sees a blank page; the only diagnostic is an
uncaught error in the console (which, per G1, no one is watching).

**Impact:** Localized data problems become total, opaque outages.
**Recommendation:** Add an error boundary per route with a fallback that shows the error
and a reload action, and reports it to the logger from G1.

## G5 — Connectivity is reduced to two unexplained status dots; no failure detail
**Severity:** Medium
**Location:** `web/src/app/Navbar.tsx:89-96`, `web/src/app/Footer.tsx:5-17`, `web/src/health/HealthPage.tsx:58-78`

The only observability of gateway/engine health is a green/red dot in the navbar and
footer (`project ? ok : down`) and the Health page strip. There is no surfaced *reason*
(timeout? 500? engine crash? wrong port?), no last-error text, and no timestamp of the
last successful contact. `loadHealth` swallows the error (`store.ts:74-79`) so even the
nature of "down" is lost. For a tool whose entire purpose is monitoring, the failure
diagnostics are thinner than the success diagnostics.

**Impact:** "Gateway down" gives the operator no actionable detail.
**Recommendation:** Capture and display the last error (status/message) and
last-contact time on the Health page; distinguish "unreachable" from "reachable but
engine down."

## G6 — Gateway WS serializer uses `unwrap()` on the send path
**Severity:** Low
**Location:** `gateway/src/api/ws.rs:55-57`

`send` does `serde_json::to_string(m).unwrap()`. A serialization failure (unexpected for
the current types, but possible if a payload contains a non-serializable value) panics
the task handling that socket. Not user-facing, but it's an un-instrumented crash path
on the live-telemetry seam.

**Impact:** Potential task panic with no graceful close frame to the client.
**Recommendation:** Map the error and close the socket cleanly with a log line instead
of `unwrap()`.

---

### Positive notes
- The gateway has structured `tracing` with an env-filtered subscriber to stderr
  (`gateway/src/main.rs:7-10`) and warns on registration failures — server-side
  diagnostics are reasonable. The gap is almost entirely on the **web** side and on the
  client↔gateway error-propagation seam.
- The ts-rs type-drift CI gate (`.github/workflows/ci.yml`, "ts-rs type-gen drift gate")
  is a strong *compile-time* diagnostic that keeps `web/src/types` honest against the
  Rust models — a good pattern the runtime side should mirror with frame validation.
