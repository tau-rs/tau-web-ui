# Security findings — tau-web-ui

Scope: the `web/` React app and, where it bears directly on the UI's trust model,
the `gateway/` crate it talks to. Severity reflects the project's stated threat
model (a **local** dev/monitoring tool bound to `127.0.0.1`), not a public service.

## S1 — Gateway exposes powerful, unauthenticated mutating APIs with no Origin/CSRF defense
**Severity:** High
**Location:** `gateway/src/main.rs:38`, `gateway/src/api/mod.rs:28-79`, `gateway/src/api/ws.rs:13-19`

The gateway binds `127.0.0.1:4317` with **no authentication, no CORS policy, and no
Origin check** on either the REST routes or the WebSocket upgrade. The exposed API is
highly privileged: it clones arbitrary git URLs (`POST /api/projects`,
`/packages/install`), writes provider credentials (`PUT /api/credentials/{backend}`),
launches agent runs that execute tooling, and mutates `tau.toml`/skills/agents on disk.

Because the browser will attach to `ws://localhost:4317` and issue `fetch` to
`/api/...` with no Origin enforcement, any web page the developer visits in the same
browser can drive the gateway cross-origin: simple `POST` requests with
`content-type: application/json` are not always preflighted, and the WS upgrade is
reachable from any origin. Combined with DNS-rebinding this is a classic "localhost
daemon" CSRF/SSRF surface — an attacker page could install a malicious package or
exfiltrate run data.

**Impact:** Drive-by code execution / credential and data exfiltration from a
developer's machine via a malicious or compromised web page.
**Recommendation:** Validate the `Origin`/`Host` header on every mutating route and on
the WS upgrade (reject anything but the dev UI origin); add a CSRF token or a
loopback-only shared secret; reject non-loopback `Host` headers to block DNS
rebinding. At minimum, require a same-origin custom header that simple cross-origin
requests cannot set.

## S2 — Path segments interpolated into API URLs without `encodeURIComponent`
**Severity:** Medium
**Location:** `web/src/api/client.ts:28-30,73,75,82` (`scoped`), `web/src/api/agents.ts:11,14,21`, `web/src/api/skills.ts:13,16,23`, `web/src/api/config.ts:35,38`, `web/src/api/client.ts` run id paths

`scoped()` builds `/api/projects/${activeProject}${path}` and the per-resource modules
append `${id}` / `${name}` / `${agent.id}` directly into the URL. None of these are
percent-encoded (only `credentials.ts:17,24` and the query params in
`projects.ts`/`client.ts` use encoding). Values flow from `useParams()` (URL-controlled)
and from backend-provided lists. A name/id containing `/`, `..`, `?`, `#`, or `%` can
break out of the intended path segment, hit a different route, or smuggle query
parameters. Client-side `NAME_RE`/`ID_RE` only guard *newly created* names, not
existing ones loaded from the backend or typed into the URL bar.

**Impact:** Path/route confusion and request-shape tampering; with the missing Origin
checks (S1) this widens what a crafted link can make the gateway do.
**Recommendation:** Encode every interpolated path segment with
`encodeURIComponent`, including `activeProject` in `scoped()`.

## S3 — Vulnerable build/test dependencies, not gated in CI
**Severity:** Medium
**Location:** `web/package.json:46-47` (`vite ^5`, `vitest ^2`), `web/pnpm-lock.yaml` (`vite@5.4.21`)

`pnpm audit` reports 1 critical + 2 moderate advisories in the toolchain:
- **vitest `<3.2.6` (critical, GHSA-5xrq-8626-4rwp)** — arbitrary file read/exec when the Vitest UI server is listening.
- **esbuild `<=0.24.2` (moderate, GHSA-67mh-4wv8-2f99)** — any website can send requests to the dev server and read responses.
- **vite `<=6.4.1` (moderate, GHSA-4w7w-66w2-5vf9)** — path traversal in optimized-deps `.map` handling.

The CI workflow (`.github/workflows/ci.yml`) runs lint/typecheck/test/build but never
runs `pnpm audit`, so these regress silently. The esbuild/vite dev-server advisories
compound S1 (the dev server is another unauthenticated localhost listener).

**Impact:** Developer-machine compromise via the dev server / test runner.
**Recommendation:** Bump vite/vitest to patched majors; add `pnpm audit --audit-level=moderate` (or `osv-scanner`) as a CI gate.

## S4 — Untrusted WebSocket/backend JSON is cast, not validated, before driving state
**Severity:** Low
**Location:** `web/src/api/client.ts:83-89`, `web/src/store/store.ts:146-175`, `web/src/types/Event.ts` (`payload: unknown`)

`openRunSocket` does `JSON.parse(ev.data) as WsMessage` and feeds it straight into
`applyWs`, which `switch`es on `m.type` and reads `m.run`, `m.span`, `m.event.payload`
with no runtime schema check. `Event.payload` is `unknown` and is cast `as { text?: string }`
when concatenated into `assistantText`. The data originates from `tau serve` (an external
process) proxied verbatim by the gateway. Today rendering is via React text nodes and
`JSON.stringify` (no HTML sink — see note below), so the blast radius is limited to state
corruption / crashes, but a malformed frame that isn't valid JSON is silently dropped
(`catch {}`), masking protocol drift.

**Impact:** Silent data loss / state corruption from a misbehaving or malicious engine.
**Recommendation:** Validate frames against the `WsMessage` union (e.g. a small zod/valibot
schema or hand-written guards) and surface decode failures instead of swallowing them.

## S5 — `local secret value` input lacks autocomplete suppression
**Severity:** Low
**Location:** `web/src/providers/CredentialChainEditor.tsx:171-183`

The write-only API-key field is `type="password"` but has no `autoComplete="off"` /
`autoComplete="new-password"`. Browsers/password managers may offer to store the
provider secret, persisting a high-value credential outside the gateway's 0600 store.

**Impact:** Provider API keys leak into browser credential stores.
**Recommendation:** Add `autoComplete="off"` (and `spellCheck={false}`) to the secret input.

---

### Positive notes (verified, not findings)
- **No HTML-injection sinks.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or
  `document.write` anywhere in `web/src` or `index.html`. Backend-controlled strings
  (remediation text, finding `location`, span attributes, plugin transcripts) are
  rendered as React text or `JSON.stringify`'d into `<pre>`, so they are auto-escaped —
  XSS risk from untrusted report/plugin content is low.
- **Credential secrets at rest** are written atomically at `0o600` on Unix
  (`gateway/src/credentials/mod.rs:359-379`) and never echoed back to the client. They
  are stored *plaintext* (not encrypted) and the non-Unix path does **not** set
  restrictive permissions — worth noting for a hardening pass but acceptable for a
  local tool.
- No secrets or tokens are hardcoded in client code.
