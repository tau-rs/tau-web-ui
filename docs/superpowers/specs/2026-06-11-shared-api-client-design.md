# Shared API request client

**Status:** approved
**Finding:** `audit/design.md` D2 (MEDIUM, design) — duplicated `json<T>` fetch
helper across ~12 modules; no shared API client.

## Problem

The same helper is copy-pasted into every API module:

```ts
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
```

It is declared in `web/src/api/client.ts` and re-declared verbatim in
`checks.ts`, `agents.ts`, `config.ts`, `credentials.ts`, `projects.ts`,
`skills.ts`, `tools.ts`, `providers.ts`, `ship.ts`, `graph.ts`, `plugins.ts`.

There is no central place for base URL, default headers, timeouts, abort
signals, retry, or error normalization. Adding the Origin header (audit S1) or a
request timeout would mean editing a dozen files.

## Goal

Introduce the smallest seam that lets every module make requests through one
helper that owns base URL, default headers, and error normalization — and is the
single future home for abort/timeout/Origin. Pure consolidation: every exported
function signature stays unchanged. No new cross-cutting behavior in this PR.

## The seam

Three additions to `web/src/api/client.ts` (the natural home — it already owns
`scoped`/`scopedPath`):

```ts
const BASE = ""; // single future home for an absolute base URL

/** The one place every request flows through: base URL lives here, and this is
 *  the single home for adding default headers (Origin — audit S1), a timeout,
 *  or an abort signal later, applied to every call without touching call sites.
 *  Argument-less requests stay argument-less, so behavior is identical to a
 *  direct `fetch`. */
function send(path: string, init?: RequestInit): Promise<Response> {
  const url = `${BASE}${path}`;
  return init ? fetch(url, init) : fetch(url);
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await check(await send(path, init));
  return res.json() as Promise<T>;
}

export async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  await check(await send(path, init));
}
```

Error normalization lives only in `check`; the single `fetch` call lives in
`send` (the future home for base URL / default headers). The standalone
`json<T>` is deleted from `client.ts` and from all 11 modules.

`send` keeps argument-less requests argument-less (`fetch(url)` rather than
`fetch(url, undefined)`) so the consolidation is byte-identical to the previous
direct-`fetch` call sites — an earlier merge-based draft passed `{ headers: {} }`
on every GET, which is observably different and is avoided here.

## Migration (mechanical, signatures unchanged)

- `fetch(p).then(json<T>)` → `request<T>(p)`
- `fetch(p, init).then(json<T>)` → `request<T>(p, init)`
- the three no-body delete handlers (`deleteAgent`, `deleteSkill`,
  `removeProject`), which today throw `new Error(\`${res.status}\`)` with no
  response text, route through `requestVoid(p, { method: "DELETE" })`. Their
  thrown error gains the `: ${text}` suffix, i.e. they become **consistent**
  with every other call site — this is the "normalization in one place" the
  finding asks for (decision A).
- `client.ts`'s own functions (`getHealth`, `getProject`, `launchRun`,
  `listRuns`, `getWorkflows`, `launchWorkflow`, `getTrace`, `cancelRun`) also
  route through `request`. `openRunSocket` (WebSocket) is untouched.
- Call sites keep passing their own `content-type` header — not stripped (that
  would be churn beyond the seam). `send` forwards each call's `init` unchanged
  (and omits it entirely when absent), so request behavior is byte-identical to
  today.

## Out of scope (explicitly NOT in this PR)

- No auth / timeout / retry / Origin behavior — just the seam that makes them a
  one-file change later.
- No base URL value (`BASE` stays `""`).
- No removing per-call `content-type` headers.
- No unrelated refactors.

## Testing

TDD, failing test first, added to `web/src/api/client.test.ts`:

1. `request<T>` throws `${status}: ${text}` on a non-OK response.
2. `request<T>` returns parsed JSON on an OK response.
3. `requestVoid` throws `${status}: ${text}` on a non-OK response (and resolves
   on OK without parsing).
4. A representative module (`getChecks`) surfaces the normalized error, proving
   it routes through the shared helper rather than a private copy.

## Verification

- `vitest` green (new + existing, including the existing project-scoped tests).
- `tsc` typecheck green.
- `eslint` + `prettier` clean.
- Existing e2e unaffected (no public signature or path changed).

## Files touched

`web/src/api/`: `client.ts`, `client.test.ts`, `checks.ts`, `agents.ts`,
`config.ts`, `credentials.ts`, `projects.ts`, `skills.ts`, `tools.ts`,
`providers.ts`, `ship.ts`, `graph.ts`, `plugins.ts`.
