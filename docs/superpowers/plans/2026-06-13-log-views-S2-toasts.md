# S2 — Silent-failure toasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace silent `.catch(() => {})` on user-initiated operations and primary page loads with `surfaceError`, so failures show a toast instead of a blank screen.

**Architecture:** No new code — `surfaceError(context, err)` already exists (`web/src/notify/notify.ts:39`) and logs + pushes an error toast. This session wires the silent sites to it. **Independent of S1; can land first.**

**Tech Stack:** React 18, TypeScript, vitest + @testing-library/react. Run from `web/`.

**Read first:**
- `web/src/notify/notify.ts` (the `surfaceError` helper)
- Spec §3 #3: scope is the five surfaces **Ship, Workflows, Packages, Agents index, Tools**.

**Scope rule (important):** Wrap **user-initiated operations** (install/build/verify/import/update/uninstall) and **primary first-load** of a page's main data. **Do NOT** wrap recurring background pollers or loads that already surface their own UI state — explicitly leave these as-is:
- `app/AppShell.tsx:14`, `app/ProjectScope.tsx:18-20`, `projects/ProjectsHome.tsx:33` (background project/project-scope loads)
- `health/HealthPage.tsx:58` (already renders `healthError`)
- `trace/TracePage.tsx:13` (TraceView shows its own "select a run" state)
- `runs/Launcher.tsx:25` (optional workflow list)
- `providers/ProvidersPage.tsx:26` (`getCredentials` — optional, uses `useAsync` elsewhere)

`config/ConfigPage.tsx` and `providers/ProvidersPage.tsx:35` are out of scope for this session (config already uses `surfaceError` on save) — listed as optional follow-ups at the end.

---

## Task 1: Representative test — a failed primary load shows a toast

**Files:**
- Test: `web/src/agents/AgentsIndexPage.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/agents/AgentsIndexPage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentsIndexPage } from "./AgentsIndexPage";
import { useNotifications } from "../notify/notify";

vi.mock("../api/client", () => ({
  listAgents: vi.fn(() => Promise.reject(new Error("boom"))),
}));

describe("AgentsIndexPage", () => {
  beforeEach(() => useNotifications.setState({ items: [] }));
  it("pushes an error toast when the agent list fails to load", async () => {
    render(<MemoryRouter><AgentsIndexPage /></MemoryRouter>);
    await waitFor(() =>
      expect(useNotifications.getState().items.some((n) => n.kind === "error")).toBe(true),
    );
  });
});
```

> Note: adjust the `vi.mock` factory to match `AgentsIndexPage`'s actual import (it may import from `../api/client` or a more specific module — check the file's import line and mock that exact path/function name).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/agents/AgentsIndexPage.test.tsx`
Expected: FAIL — no error toast (the catch is currently silent).

- [ ] **Step 3: Wire AgentsIndexPage**

Modify `web/src/agents/AgentsIndexPage.tsx`:
- Add import: `import { surfaceError } from "../notify/notify";`
- Line 14: replace `.catch(() => {})` with `.catch((e) => surfaceError("Failed to load agents", e))`.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/agents/AgentsIndexPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
npx prettier --write src/agents/AgentsIndexPage.tsx src/agents/AgentsIndexPage.test.tsx
git add src/agents/AgentsIndexPage.tsx src/agents/AgentsIndexPage.test.tsx
git commit -m "feat(notify): toast on agent list load failure"
```

---

## Task 2: Wire the remaining sites (mechanical, uniform transform)

For each site below: add `import { surfaceError } from "../notify/notify";` (relative path adjusted per file depth) if not already present, then replace the silent catch with a contextual `surfaceError`. The transform is uniform:

`.catch(() => {})` → `.catch((e) => surfaceError("<context>", e))`
`.catch(() => [])` → `.catch((e) => { surfaceError("<context>", e); return []; })`

- [ ] **Step 1: Ship** — `web/src/ship/ShipPage.tsx`
  - Line 38 (targets/bundles load): `surfaceError("Failed to load ship targets", e)`
  - Line 41 (the second load catch): `surfaceError("Failed to load bundles", e)`
  - Any `build`/`verify` try/catch that swallows: surface `"Build failed"` / `"Bundle verify failed"` (read lines ~48-63; if they use try/catch rather than `.catch`, add `surfaceError(...)` in the catch block).

- [ ] **Step 2: Workflows** — `web/src/graph/GraphEditor.tsx`
  - Line 43: `surfaceError("Failed to load providers", e)`
  - Line 58: `surfaceError("Failed to load agents", e)`
  - Line 67: `surfaceError("Failed to load workflows", e)`
  - Line 80: `surfaceError("Failed to load workflow graph", e)`

- [ ] **Step 3: Packages** — `web/src/packages/PackagesPage.tsx`
  - Line 41 (list load): `surfaceError("Failed to load packages", e)`
  - Line 50 (install): `surfaceError("Install failed", e)`
  - Line 55 (verify, returns `[]`): `.catch((e) => { surfaceError("Verify failed", e); return []; })`
  - Line 82 (resolve): `surfaceError("Resolve failed", e)`
  - Line 123 (update): `surfaceError("Update failed", e)`
  - Line 133 (uninstall): `surfaceError("Uninstall failed", e)`

- [ ] **Step 4: Tools** — three files
  - `web/src/tools/ToolsTab.tsx:16`: `surfaceError("Failed to load tools", e)`
  - `web/src/tools/SkillsIndex.tsx:16`: `surfaceError("Failed to load skills", e)`
  - `web/src/tools/SkillsIndex.tsx:25` (import): `surfaceError("Skill import failed", e)`
  - `web/src/tools/PluginsTab.tsx:18`: `surfaceError("Failed to load plugins", e)`

- [ ] **Step 5: Verify no silent catches remain in the five surfaces**

Run:
```bash
grep -rn "catch(() => {})\|catch(() => \[\])" src/ship src/graph src/packages src/agents src/tools
```
Expected: no matches.

- [ ] **Step 6: Typecheck, lint, format**

Run:
```bash
npx tsc --noEmit && npx eslint src/ship src/graph src/packages src/agents src/tools && npx prettier --write src/ship src/graph src/packages src/agents src/tools
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ship src/graph src/packages src/tools
git commit -m "feat(notify): surface silent failures on ship, workflows, packages, tools"
```

---

## Task 3: Final gate

- [ ] **Step 1:** Run `npx vitest run && npx tsc --noEmit && npx eslint . && npx prettier --check src`
Expected: all PASS.

## Optional follow-ups (note to orchestrator, not in this session's PR)
- `config/ConfigPage.tsx:50` (importAgent), `providers/ProvidersPage.tsx:35` (install) — same transform if desired.

## Next step (print this on completion)

> ✅ **S2 complete.** Five config surfaces now toast on failure instead of failing silently.
> **No sessions are blocked on S2** — it's independent. If S1 hasn't merged yet, that's the only remaining Phase-1 work; S3/S4/S5 unblock when **S1** merges (not S2).
