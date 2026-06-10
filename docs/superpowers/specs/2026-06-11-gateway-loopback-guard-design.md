# Gateway loopback Origin/Host guard

**Date:** 2026-06-11
**Finding:** `audit/security.md` S1 (HIGH) — gateway exposes powerful, unauthenticated
mutating APIs with no Origin/CORS defense.

## Problem

`tau-gateway` binds `127.0.0.1:4317` with no authentication, no CORS policy, and no
`Origin`/`Host` validation on either the REST routes or the WebSocket upgrade. The API
is highly privileged: it clones arbitrary git URLs, writes provider credentials,
launches agent runs that execute tooling, and mutates `tau.toml`/skills/agents on disk.

Because a browser will attach to `ws://localhost:4317` and `fetch` to `/api/...` with no
origin enforcement, **any web page the developer visits can drive the gateway**
cross-origin (CSRF), and combined with DNS-rebinding the listener is reachable even when
the attacker controls only their own domain. Impact: drive-by code execution and
credential/run-data exfiltration from the developer's machine.

## How the legitimate UI reaches the gateway

The dev UI is served by Vite on `127.0.0.1:5173` and proxies `/api` (REST + WS) to
`127.0.0.1:4317` with `changeOrigin: true`. Therefore the gateway always sees:

- `Host: 127.0.0.1:4317` (rewritten by the proxy), and
- `Origin: http://127.0.0.1:5173` on browser requests that carry one (absent on
  same-origin GETs).

Both are loopback. A loopback allowlist does not break the local UI.

## Design (approach A — Origin/Host validation only)

A single `axum::middleware::from_fn` layered over the **whole** router. It runs before
routing and extractors, so it uniformly guards every HTTP route **and** the WS upgrade
(the upgrade is a plain GET on `/api/projects/{pid}/runs/{id}/events`).

Rules, evaluated per request:

1. **Host must be loopback.** Resolve the request authority from the `Host` header
   (falling back to the URI authority). Reject with `403` if it is not loopback. This
   defeats DNS-rebinding: a rebound request carries the attacker's `Host`.
2. **Origin, if present, must be loopback.** If an `Origin` header is present and is not
   a loopback origin, reject with `403`. This defeats CSRF: a real web page carries its
   own foreign origin. An absent `Origin` is allowed (non-browser clients like curl, and
   same-origin GETs) — the Host check still blocks rebinding.

"Loopback" host test: strip the optional port (handling `[::1]:port`), then allow the
literal `localhost` (case-insensitive) or any value that parses as an `IpAddr` whose
`is_loopback()` is true (covers `127.0.0.0/8` and `::1`). "Loopback" origin test: require
an `http`/`https` scheme and a loopback authority; `Origin: null` is rejected.

Applying the guard globally (not only to mutating routes) also closes the GET
data-exfiltration vector at no extra cost, since the legit UI's GETs are loopback too.

### Why not a CSRF token / shared secret

Origin+Host validation already closes both CSRF and DNS-rebinding. A per-session CSRF
token or shared secret is defense-in-depth but would add an endpoint, client-side token
storage, and a header on every UI call — refactoring the API surface, which the finding's
remediation scope explicitly avoids. Out of scope for this change.

## Components

- `gateway/src/api/guard.rs` (new): the middleware fn `loopback_guard` plus pure helpers
  `host_is_loopback(authority)` and `origin_is_loopback(origin)`. Pure helpers are unit-
  testable without a server.
- `gateway/src/api/mod.rs`: `pub mod guard;` and `.layer(middleware::from_fn(guard::loopback_guard))`
  on the returned router. No route changes.

## Testing

- Unit (in `guard.rs`): loopback/non-loopback host and origin matrices, port stripping,
  IPv6, `Origin: null`.
- Integration (`gateway/tests/gateway_guard.rs`):
  - Foreign `Origin` on a sensitive route (`POST /api/projects`) → `403`.
  - Foreign `Host` (DNS-rebinding sim) on a route → `403`.
  - WS upgrade with foreign `Origin` → handshake rejected (`403`).
  - Legit loopback request (loopback `Origin` + `Host`) → success; WS upgrade with no
    `Origin` (existing `ws_e2e`) still streams.

## Out of scope

CSRF tokens, shared secrets, TLS, authn, and the other audit findings (S2/S3).
