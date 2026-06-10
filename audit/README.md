# tau-web-ui — Security & Design Audit

## Project overview
tau-web-ui is a local dev/monitoring web UI for the `tau` agent runtime. It is a
React + Vite + zustand SPA (`web/`) that talks to a Rust/axum **gateway** (`gateway/`)
which fronts `tau serve` over a stable HTTP+WS API; a `fake-tau-serve` crate mocks the
wire protocol for dev/test. The UI surfaces dashboards, run traces (live over WS),
agent/skill/workflow authoring, package & provider/credential management, ship targets,
and a Health/Checks page with severity/remediation/location findings.

## Findings by severity
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 7 |
| Medium | 11 |
| Low | 8 |
| **Total** | **26** |

Breakdown by file:
- `security.md` — 5: 1 High (S1), 2 Medium (S2, S3), 2 Low (S4, S5)
- `design.md` — 15: 3 High (D1, D10, D11), 7 Medium (D2, D3, D4, D7, D12, D13, D14), 5 Low (D5, D6, D8, D9, D15)
- `diagnostics.md` — 6: 3 High (G1, G2, G3), 2 Medium (G4, G5), 1 Low (G6)
- `devops.md` — DevOps & CI/CD audit: tau-ui's pipeline vs the canonical shared model (14 gaps — 4 High, 6 Medium, 4 Low — emphasizing re-converging from drift: no merge_group, missing nightly/mutation/auto-rerun-flaky, no lefthook/justfile, no supply-chain gating).

## Top 5 issues
1. **(High, security) Unauthenticated, no-Origin-check localhost gateway** — the gateway
   exposes git-clone, credential-write, and run-launch APIs + WS with no auth/CORS/Origin
   validation, opening a drive-by CSRF/DNS-rebinding surface from any web page.
   `gateway/src/main.rs:38`, `gateway/src/api/mod.rs:28-79`, `gateway/src/api/ws.rs:13`.
2. **(High, UX/diagnostics) Pervasive silent error swallowing** — 38 `.catch(() => {})`
   sites mean gateway/network failures render as "empty" with no message and no console
   log; "broken" is indistinguishable from "empty". `web/src/health/HealthPage.tsx:37`,
   `web/src/store/store.ts:74-93`, et al.
3. **(High, UX) Config save reports "✓ saved" on failure** — `onSave` swallows the
   rejection then unconditionally shows success, creating a data-loss illusion.
   `web/src/config/ConfigPage.tsx:31-43`.
4. **(High, code design) Active project is a mutable module global set during render** —
   `client.ts`'s `activeProject` is mutated in `ProjectScope`'s render body, coupling
   routing to every fetch and risking cross-project request leakage.
   `web/src/api/client.ts:23-30`, `web/src/app/ProjectScope.tsx:15-17`.
5. **(High, diagnostics) WebSocket has no error/close/reconnect handling** — a dropped
   socket silently freezes the live trace with no indication or resync.
   `web/src/api/client.ts:80-91`, `web/src/store/store.ts:116-132`.

Honorable mention: **severity types are bare `string` and unknown values fall back to a
benign "warning" badge** (`web/src/types/CheckFinding.ts:4`, `web/src/health/HealthPage.tsx:15`),
silently downgrading severity on a health surface; and a **critical vitest advisory**
(plus moderate vite/esbuild) ungated in CI (`web/package.json`, `.github/workflows/ci.yml`).

## Notable strengths
- No HTML-injection sinks — all backend strings are React-escaped or `JSON.stringify`'d
  (XSS surface is low despite untrusted plugin/report content).
- Credential secrets written atomically at `0o600` (Unix) and never echoed to the client.
- A ts-rs type-drift CI gate keeps `web/src/types` in sync with the Rust models.
- Strong happy-path unit + e2e coverage and a fail-closed CI summary gate.

## Picking up from here
This audit lives in a dedicated git worktree:
- **Worktree path:** `/Users/titouanlebocq/code/tau-ui-worktrees/audit`
- **Branch:** `audit/design-security`
- The audit deliverables are under `audit/` (`README.md`, `security.md`, `design.md`,
  `diagnostics.md`). They were committed in one commit; **no source code was modified**.

To continue remediation:
1. `cd /Users/titouanlebocq/code/tau-ui-worktrees/audit` and stay on
   `audit/design-security` (do not touch the sibling `tau-ui` checkout).
2. Each finding carries `path:line` locations and a concrete recommendation — start with
   the 5 High items above. Quick wins: D11/G3 (config false success), D10/G1 (add a
   shared error surface + `console.error`), S5 (`autoComplete="off"`), S2
   (`encodeURIComponent` in `client.ts:scoped` and the resource modules).
3. Structural items (D1 active-project global, D2 shared API client, G2 WS lifecycle)
   are best tackled together since they all touch `web/src/api/` and `web/src/store/`.
4. Re-run `pnpm audit`, `pnpm lint`, `pnpm typecheck`, `pnpm vitest run`, and `pnpm e2e`
   (against `fake-tau-serve`) to validate changes; consider adding error-path e2e tests
   (D8) since none exist today.
