# CI setup + UI restyle — design

**Date:** 2026-05-31
**Status:** Approved (brainstorm), pending spec review → writing-plans
**Repo:** github.com/LEBOCQTitouan/tau-web-ui
**Scope:** Two independent workstreams in one spec: (A) clean GitHub Actions CI; (B) restyle the React UI from ad-hoc inline styles to a coherent Tailwind design system, plus a new Timeline tab in the trace view. Each can be planned/implemented separately.

## 0. Decisions (locked in brainstorm)
- **Styling:** Tailwind CSS (v3.4 + PostCSS), replacing all inline `style={{}}`.
- **Theme:** Light "Slate Compact" only now, structured **dark-ready** (semantic CSS-variable tokens; a `.dark {}` block + `html.dark` toggle is a future drop-in — no toggle UI in this scope).
- **CI scope:** Full — Rust (fmt/clippy/test) + type-gen drift gate, Web (lint/format/typecheck/unit/build), and Playwright e2e.
- **Web lint:** ESLint + Prettier, enforced in CI.
- **Trace view:** Graph (React Flow) stays the **default**; **Timeline** (nested tree + waterfall) added as a secondary tab.

---

## Part A — Continuous Integration

### A.1 Provider & triggers
GitHub Actions, file `.github/workflows/ci.yml`. Triggers: `push` to `main`, and `pull_request`. Concurrency group per-ref with `cancel-in-progress: true` to supersede stale runs.

### A.2 Jobs (3, parallel where possible, all cached)

**`rust`** (ubuntu-latest):
1. `actions/checkout`
2. `dtolnay/rust-toolchain@stable` with components `rustfmt, clippy`
3. `Swatinem/rust-cache` (keyed on Cargo.lock)
4. `cargo fmt --all -- --check`
5. `cargo clippy --all-targets --all-features -- -D warnings`
6. `cargo build --workspace` — guarantees `target/debug/fake-tau-serve` exists before tests reference it
7. `cargo test --workspace`
8. **Type-gen drift gate:** `git diff --exit-code -- web/src/types` — step 7 regenerates the ts-rs bindings (the `export_bindings` + per-type export tests write `web/src/types/*.ts`); if they differ from the committed copies the Rust Trace model changed without regeneration → fail with a helpful message.

**`web`** (ubuntu-latest):
1. checkout
2. `pnpm/action-setup` (version from `packageManager` field) + `actions/setup-node@v4` (node 20, `cache: pnpm`)
3. `pnpm install --frozen-lockfile`
4. `pnpm lint` — ESLint
5. `pnpm format:check` — Prettier `--check`
6. `pnpm typecheck` — `tsc --noEmit`
7. `pnpm vitest run`
8. `pnpm build`

**`e2e`** (ubuntu-latest) — needs both toolchains:
1. checkout
2. Rust toolchain + rust-cache → `cargo build --workspace`
3. pnpm/node setup → `pnpm install --frozen-lockfile`
4. `pnpm exec playwright install --with-deps chromium`
5. `pnpm e2e`
6. `actions/upload-artifact` (if: failure) → `web/playwright-report/` and `web/test-results/`

### A.3 Supporting changes
- `web/package.json`: add `"packageManager": "pnpm@<locked-version>"`, and scripts:
  - `"typecheck": "tsc --noEmit"`
  - `"lint": "eslint ."`
  - `"lint:fix": "eslint . --fix"`
  - `"format": "prettier --write ."`
  - `"format:check": "prettier --check ."`
- `web/eslint.config.js`: ESLint 9 **flat config** — `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-plugin-react-hooks` (rules-of-hooks + exhaustive-deps), `eslint-plugin-react-refresh`. Ignore `dist/`, `src/types/` (generated), `playwright-report/`, `test-results/`.
- `web/.prettierrc.json` (+ `.prettierignore` excluding `src/types/`, `dist/`, lockfile).
- Set `reuseExistingServer: !process.env.CI` in `web/playwright.config.ts`.
- README: add CI status badge.
- Branch protection: document (and optionally apply via `gh api`) making `rust`, `web`, `e2e` **required** status checks on `main`. Applying it is a one-time repo-settings action, noted in the plan as a manual/optional step (not code).

### A.4 CI acceptance criteria
1. On a PR, all three jobs run and pass on the current `main`+branch state.
2. Introducing a `cargo fmt` violation, a clippy warning, an ESLint error, a Prettier diff, a failing test, or a **stale `web/src/types`** each fails the corresponding job.
3. `e2e` runs Chromium headless and passes (or uploads a report artifact on failure).
4. Caching makes warm runs substantially faster than cold.

---

## Part B — UI restyle (Tailwind, Slate Compact, dark-ready) + Timeline tab

### B.1 Tailwind foundation
- Add dev deps: `tailwindcss@^3.4`, `postcss`, `autoprefixer`. `npx tailwindcss init -p` → `tailwind.config.ts` + `postcss.config.js`.
- `tailwind.config.ts`: `darkMode: 'class'`; `content: ["./index.html", "./src/**/*.{ts,tsx}"]`; theme `extend.colors` mapped to CSS variables (see B.2) using the `rgb(var(--x) / <alpha-value>)` pattern so opacity utilities work.
- `src/index.css`: `@tailwind base; @tailwind components; @tailwind utilities;` + a `:root { … }` block defining the light token values, and an empty/stub `.dark { … }` block (commented placeholder) documenting the dark-ready seam. Import `index.css` in `main.tsx` (alongside the existing React Flow CSS import).

### B.2 Design tokens (semantic CSS variables, RGB triplets)
Defined in `:root` (light). Names are semantic, not color-named, so dark is a value swap:

| Token | Light value | Role |
|---|---|---|
| `--bg` | `248 250 252` (slate-50) | app background |
| `--surface` | `255 255 255` | cards / panels / rows |
| `--border` | `226 232 240` (slate-200) | hairlines |
| `--fg` | `30 41 59` (slate-800) | primary text |
| `--muted` | `100 116 139` (slate-500) | secondary text |
| `--accent` | `124 58 237` (violet-600) | primary action / selection |
| `--accent-fg` | `255 255 255` | text on accent |
| `--status-running` / `-soft` | `37 99 235` / `219 234 254` | blue |
| `--status-ok` / `-soft` | `22 163 74` / `220 252 231` | green |
| `--status-error` / `-soft` | `220 38 38` / `254 226 226` | red |
| `--status-cancelled` / `-soft` | `161 98 7` / `254 243 199` | amber |

Tailwind theme exposes these as `bg`, `surface`, `border`, `fg`, `muted`, `accent`, `accent-fg`, and `status-{running,ok,error,cancelled}` (+ `-soft`). Base layer sets `body { @apply bg-bg text-fg; }` and a mono utility for ids/timestamps.

### B.3 Component migration (replace inline styles with Tailwind classes)
Per file, no behavior change beyond styling:
- `app/ProjectBar.tsx` — top bar: title, project path, `tau <ver>`, engine dot (green/red).
- `runs/Launcher.tsx` — styled `<select>` + `<input>` + accent Run button.
- `runs/RunsTable.tsx` — compact table, row hover, click target preserved.
- `runs/badges.tsx` — `StatusBadge` = soft bg + strong text per status (e.g. completed → `bg-status-ok-soft text-status-ok`); `SubstrateModeBadge` = outline chip; `formatTokens`/`formatDuration` unchanged (logic).
- `trace/TraceView.tsx` — toolbar (back, agent, status, metrics, cancel) + **Tabs** + panes.
- `trace/TraceGraph.tsx` — custom `SpanNode` restyled via Tailwind class map (status → fill/border).
- `trace/SpanInspector.tsx`, `trace/RunControls.tsx`, `trace/AssistantStream.tsx` — restyled.

### B.4 New: Trace view tabs
- A small segmented control component `trace/Tabs.tsx` (or inline) with `Graph | Timeline`.
- Active tab held in `TraceView` local `useState`, default `"graph"`.
- Graph tab → existing `TraceGraph`. Timeline tab → new `TraceTimeline`. Inspector (right) + AssistantStream (bottom) shared, unchanged across tabs.

### B.5 New: Timeline (tree + waterfall)
- **Pure layout module `trace/timeline.ts`** (unit-tested like `layout.ts`): given `Span[]`, compute the run window `[t0, t1]` where `t0 = min(started_at)`, `t1 = max(ended_at ?? <fallback "now"/max-known>)`; for each span compute `offsetPct`, `widthPct` (min width clamp, e.g. 1.5%), `depth`, `hasChildren`, in DFS order (reuse the parent-resolution logic shared with `layout.ts` — extract a `buildForest(spans)` helper used by both). Running spans (no `ended_at`) extend to `t1`. Guard divide-by-zero when `t1==t0`.
- **`trace/TraceTimeline.tsx`**: renders rows — indentation by depth, a status dot, span name, a track with the positioned duration bar (status-colored), and a duration label. Clicking a row calls `selectSpan(id)` (shared inspector). Basic collapse: local `Set<string>` of collapsed span ids; a caret on rows with children toggles visibility of descendants. Selected row highlighted with accent.

### B.6 Test-compatibility constraint (must hold after restyle)
Existing unit + e2e tests assert on text/roles, not styles. Preserve exactly:
- `aria-label="agent"`, `aria-label="prompt"`; button names `Run`, `Cancel`; `← Back to runs`.
- Badge text: status words (`running/completed/failed/cancelled`), `SubstrateModeBadge` rendering `"host · dev"`.
- Trace node/row label `fs-read`; token text matching `/tok/` (e.g. `"20 tok"`).
- The empty-state text `/no runs yet/i`; inspector `/select a node/i`.
The Tabs default = Graph means the e2e `fs-read` assertions still resolve against the graph node without switching tabs.

### B.7 Testing
- New: `trace/timeline.test.ts` (pure) — offset/width math, DFS nesting order, running-span-extends-to-end, single-span, zero-window guard, orphan-parent tolerance.
- Optional: a `TraceTimeline` render test (renders rows, fires `selectSpan` on click).
- All existing vitest + Playwright tests must remain green. The Playwright spec is unchanged (Graph is default).

### B.8 UI acceptance criteria
1. No remaining ad-hoc inline `style={{}}` in components (Tailwind classes throughout; trivial dynamic styles like a computed bar width may use inline `style={{ width }}` where a class can't express it — those are allowed and noted).
2. App matches the Slate Compact light direction; tokens live as CSS variables; `body` uses `bg`/`fg` tokens.
3. Dark-ready smoke check: temporarily adding `class="dark"` to `<html>` + a filled `.dark {}` token block restyles the app with no component edits (documented; the toggle UI itself is out of scope).
4. Trace view shows a **Graph | Timeline** tab control; Graph is default; Timeline renders the waterfall with duration bars and a working inspector selection; collapse toggles descendants.
5. Every pre-existing unit + e2e test still passes.

---

## Non-goals (YAGNI)
- No dark-mode toggle UI, no theme persistence (only the dark-ready token seam).
- No component library (shadcn/Radix) — Tailwind + tokens only.
- No changes to the gateway, API, data model, or the deferred surfaces.
- No new gateway features; CI does not deploy or publish anything.

## File-change summary
- **CI:** `.github/workflows/ci.yml` (new); `web/eslint.config.js`, `web/.prettierrc.json`, `web/.prettierignore` (new); `web/package.json` (scripts + packageManager); `web/playwright.config.ts` (CI flag); `README.md` (badge).
- **UI:** `web/tailwind.config.ts`, `web/postcss.config.js` (new); `web/src/index.css` (new, tokens + Tailwind layers); `web/src/main.tsx` (import index.css); restyle the 9 component files in B.3; `web/src/trace/timeline.ts`, `web/src/trace/timeline.test.ts`, `web/src/trace/TraceTimeline.tsx`, `web/src/trace/Tabs.tsx` (new); extract shared `buildForest` used by `layout.ts` + `timeline.ts`.
