# Nav Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the sidebar into a grouped Dashboard + **Build** + **Operate** menu and register every IA surface as a route with a styled stub page, so the whole product is navigable end-to-end before features land.

**Architecture:** A reusable `StubPage` (title + subtitle + optional `gated` badge) renders every not-yet-built surface; the route table gains `/agents`, `/workflows`, `/tools`, `/packages`, `/config`, `/ship` (existing `/dashboard`, `/runs`, `/runs/:id`, `/health` keep working). The flat `Sidebar` becomes grouped sections with a small `gated` badge on partially-gated areas, keeping the live running-count badge on Runs.

**Tech Stack:** React 18, react-router-dom v6, Tailwind (Slate Compact), Zustand, Vitest.

**Source spec:** `docs/superpowers/specs/2026-05-31-product-information-architecture.md` §7. **CI gate:** ESLint + Prettier + tests enforced — run `pnpm lint && pnpm format:check && pnpm vitest run && pnpm build` before each commit. Work from `web/`. Branch `impl/gateway-v1`. End commit messages with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File structure
```
web/src/app/StubPage.tsx(+test)   # reusable placeholder page (title/subtitle/gated)
web/src/app/Sidebar.tsx(+test)    # grouped Build/Operate nav + gated badges
web/src/App.tsx                   # new routes via StubPage
web/src/app/Navbar.tsx            # titleFor() covers new routes
web/src/health/HealthPage.tsx     # DELETED — replaced by inline StubPage route
web/src/app/routing.test.tsx      # smoke for new routes
```

---

### Task 1: StubPage component

**Files:** Create `web/src/app/StubPage.tsx`, `web/src/app/StubPage.test.tsx`

- [ ] **Step 1: Failing test** `web/src/app/StubPage.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StubPage } from "./StubPage";

describe("StubPage", () => {
  it("renders title and subtitle", () => {
    render(<StubPage title="Agents" subtitle="Author agents — coming soon." />);
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText(/author agents/i)).toBeInTheDocument();
    expect(screen.queryByText(/gated/i)).toBeNull();
  });
  it("shows a gated badge + gate note when gated is set", () => {
    render(<StubPage title="Workflows" subtitle="x" gated="β.2" />);
    expect(screen.getByText(/gated/i)).toBeInTheDocument();
    expect(screen.getByText(/waits on tau β\.2/i)).toBeInTheDocument();
  });
});
```
Run `pnpm vitest run src/app/StubPage.test.tsx` → FAIL.

- [ ] **Step 2: Implement** `web/src/app/StubPage.tsx`:
```tsx
export function StubPage({
  title,
  subtitle,
  gated,
}: {
  title: string;
  subtitle: string;
  gated?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="rounded-lg border border-border bg-surface px-8 py-10 text-center">
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {gated && (
            <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">
              gated
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
        {gated && <p className="mt-1 text-xs text-muted">waits on tau {gated}</p>}
      </div>
    </div>
  );
}
```
Run → PASS. `pnpm lint && pnpm format:check && pnpm build` clean. Commit:
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/app/StubPage.tsx web/src/app/StubPage.test.tsx
git commit -m "feat(web): reusable StubPage (title/subtitle/gated badge)"
```

---

### Task 2: Grouped Sidebar

**Files:** Modify `web/src/app/Sidebar.tsx`; modify `web/src/app/Sidebar.test.tsx`

- [ ] **Step 1: Extend the test** — replace `web/src/app/Sidebar.test.tsx` with:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ runs: [] }));

describe("Sidebar", () => {
  it("renders the Build and Operate group labels", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Operate")).toBeInTheDocument();
  });

  it("renders all surface links with correct hrefs", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const expected: [RegExp, string][] = [
      [/dashboard/i, "/dashboard"],
      [/agents/i, "/agents"],
      [/workflows/i, "/workflows"],
      [/tools/i, "/tools"],
      [/packages/i, "/packages"],
      [/config/i, "/config"],
      [/runs/i, "/runs"],
      [/ship/i, "/ship"],
      [/health/i, "/health"],
    ];
    for (const [name, href] of expected) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("badges the partially-gated areas (Workflows, Config, Ship)", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/gated/i)).toHaveLength(3);
  });

  it("shows a running-count badge on Runs when runs are in flight", () => {
    useStore.setState({
      runs: [{ id: "a", status: "running" } as never, { id: "b", status: "completed" } as never],
    });
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
```
Run `pnpm vitest run src/app/Sidebar.test.tsx` → FAIL (groups/new links not present yet).

- [ ] **Step 2: Implement** — replace `web/src/app/Sidebar.tsx`:
```tsx
import { NavLink } from "react-router-dom";
import { useStore } from "../store/store";

interface Item {
  to: string;
  label: string;
  icon: string;
  gated?: boolean;
}
const GROUPS: { title: string | null; items: Item[] }[] = [
  { title: null, items: [{ to: "/dashboard", label: "Dashboard", icon: "▦" }] },
  {
    title: "Build",
    items: [
      { to: "/agents", label: "Agents", icon: "◆" },
      { to: "/workflows", label: "Workflows", icon: "⛓", gated: true },
      { to: "/tools", label: "Tools & Skills", icon: "⚒" },
      { to: "/packages", label: "Packages", icon: "▣" },
      { to: "/config", label: "Config & Caps", icon: "⚙", gated: true },
    ],
  },
  {
    title: "Operate",
    items: [
      { to: "/runs", label: "Runs", icon: "≣" },
      { to: "/ship", label: "Ship / Targets", icon: "⬡", gated: true },
      { to: "/health", label: "Health", icon: "♥" },
    ],
  },
];

export function Sidebar() {
  const running = useStore((s) => s.runs.filter((r) => r.status === "running").length);
  return (
    <aside className="flex w-[150px] flex-col gap-0.5 border-r border-border bg-surface px-2 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        <span className="h-4 w-4 rounded bg-accent" />
        <strong className="text-xs">tau-web-ui</strong>
      </div>
      {GROUPS.map((group, gi) => (
        <div key={group.title ?? `g${gi}`} className="mb-1">
          {group.title && (
            <div className="px-2 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-wider text-muted">
              {group.title}
            </div>
          )}
          {group.items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                  isActive ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:text-fg"
                }`
              }
            >
              <span aria-hidden>{it.icon}</span>
              {it.label}
              {it.gated && (
                <span className="ml-auto rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">
                  gated
                </span>
              )}
              {it.to === "/runs" && running > 0 && (
                <span className="ml-auto rounded-full bg-st-running-soft px-1.5 text-[10px] font-semibold text-st-running">
                  {running}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </aside>
  );
}
```
Run `pnpm vitest run src/app/Sidebar.test.tsx` → PASS (4 tests). `pnpm lint && pnpm format:check && pnpm build` clean. Commit:
```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/app/Sidebar.tsx web/src/app/Sidebar.test.tsx
git commit -m "feat(web): grouped Build/Operate sidebar + gated badges"
```

---

### Task 3: Routes + navbar titles

**Files:** Modify `web/src/App.tsx`, `web/src/app/Navbar.tsx`, `web/src/app/routing.test.tsx`; delete `web/src/health/HealthPage.tsx`

- [ ] **Step 1: Extend routing test** — replace `web/src/app/routing.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { useStore } from "../store/store";

beforeEach(() => useStore.setState({ currentTrace: null, runs: [] }));

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("routing", () => {
  it("renders the Runs page at /runs", () => {
    at("/runs");
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });

  it("renders the Dashboard at /dashboard", () => {
    at("/dashboard");
    expect(screen.getAllByText(/wip/i).length).toBeGreaterThan(0);
  });

  it("renders stub pages for the new Build/Operate surfaces", () => {
    at("/agents");
    expect(screen.getByText(/author agents/i)).toBeInTheDocument();
  });

  it("renders the Workflows stub as gated", () => {
    at("/workflows");
    expect(screen.getByText(/waits on tau/i)).toBeInTheDocument();
  });

  it("renders the Packages stub", () => {
    at("/packages");
    expect(screen.getByText(/install & manage packages/i)).toBeInTheDocument();
  });

  it("renders the Ship stub", () => {
    at("/ship");
    expect(screen.getByText(/targets, build/i)).toBeInTheDocument();
  });

  it("redirects unknown paths to /runs", () => {
    at("/nope");
    expect(screen.getByLabelText("prompt")).toBeInTheDocument();
  });
});
```
Run `pnpm vitest run src/app/routing.test.tsx` → FAIL (new routes missing).

- [ ] **Step 2: Delete the bespoke HealthPage**
```bash
cd /Users/titouanlebocq/code/tau-ui
git rm web/src/health/HealthPage.tsx
```

- [ ] **Step 3: Route table** — replace `web/src/App.tsx`:
```tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { StubPage } from "./app/StubPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { RunsPage } from "./runs/RunsPage";
import { TracePage } from "./trace/TracePage";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route
          path="agents"
          element={<StubPage title="Agents" subtitle="Author agents — coming soon." />}
        />
        <Route
          path="workflows"
          element={
            <StubPage
              title="Workflows"
              subtitle="Author & run workflows — coming soon."
              gated="β.2 (visual graph)"
            />
          }
        />
        <Route
          path="tools"
          element={<StubPage title="Tools & Skills" subtitle="Skills & plugins — coming soon." />}
        />
        <Route
          path="packages"
          element={<StubPage title="Packages" subtitle="Install & manage packages — coming soon." />}
        />
        <Route
          path="config"
          element={
            <StubPage
              title="Config & Capabilities"
              subtitle="Project config & capability profiles — coming soon."
              gated="β.5 (credentials)"
            />
          }
        />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<TracePage />} />
        <Route
          path="ship"
          element={
            <StubPage
              title="Ship / Targets"
              subtitle="Targets, build & verify — coming soon."
              gated="β.6 (conformance)"
            />
          }
        />
        <Route
          path="health"
          element={<StubPage title="Health checks" subtitle="tau check & sandbox — coming soon." />}
        />
        <Route path="*" element={<Navigate to="/runs" replace />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 4: Navbar titles for the new routes** — in `web/src/app/Navbar.tsx`, replace the `titleFor` function with:
```tsx
function titleFor(pathname: string, agent?: string): string {
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/runs/")) return `Trace · ${agent ?? "…"}`;
  if (pathname.startsWith("/runs")) return "Runs";
  if (pathname.startsWith("/agents")) return "Agents";
  if (pathname.startsWith("/workflows")) return "Workflows";
  if (pathname.startsWith("/tools")) return "Tools & Skills";
  if (pathname.startsWith("/packages")) return "Packages";
  if (pathname.startsWith("/config")) return "Config & Capabilities";
  if (pathname.startsWith("/ship")) return "Ship / Targets";
  if (pathname.startsWith("/health")) return "Health";
  return "tau-web-ui";
}
```
(Leave the rest of `Navbar.tsx` unchanged.)

- [ ] **Step 5: Verify + commit**

Run: `pnpm vitest run && pnpm lint && pnpm format:check && pnpm build`
Expected: all green. The routing test now covers the new surfaces; `HealthPage.tsx` is gone (nothing imports it — confirm with `grep -rn HealthPage web/src` returns nothing).
```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "feat(web): route every IA surface to a stub page; navbar titles; drop HealthPage"
```

---

### Task 4: End-to-end verification

**Files:** none (verification + evidence)

- [ ] **Step 1: Full local gate** — `cd web && pnpm vitest run && pnpm lint && pnpm format:check && pnpm typecheck && pnpm build`. All green.

- [ ] **Step 2: e2e** —
```bash
cd /Users/titouanlebocq/code/tau-ui && cargo build --workspace
cd web && pnpm exec playwright install chromium && CI=1 pnpm e2e
```
Expected: both Playwright tests pass (the runs flow is untouched; Dashboard/Runs/Trace unchanged; the sidebar gained items but the e2e navigates by labels/roles that still resolve). If a selector breaks, a visible string changed — restore it.

- [ ] **Step 3: Manual look (no commit)** — start the gateway + `pnpm dev`; click every sidebar item under Build and Operate and confirm each lands on a styled page, the three gated areas show the amber badge, the navbar title updates, and Runs still shows its running-count badge.

- [ ] **Step 4: Push + confirm CI**
```bash
cd /Users/titouanlebocq/code/tau-ui
git push
gh run watch "$(gh run list --branch impl/gateway-v1 --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status --interval 20
```
Expected: `rust`, `web`, `e2e` all green. Fix any failure at its source and re-push.

---

## Self-review
1. **Spec coverage (§7):** grouped Build/Operate sidebar → Task 2; new routes + StubPage → Tasks 1, 3; gated badges → Task 1 (StubPage) + Task 2 (Sidebar); keep running-count badge → Task 2; tests (sidebar groups/items/hrefs/gated + routing smoke) → Tasks 2, 3; existing unit + e2e green → Task 4; Health stays a stub (now via StubPage) → Task 3. ✓
2. **Placeholder scan:** every component/test is complete code; no TBD. ✓
3. **Type consistency:** `StubPage` props `{ title, subtitle, gated? }` used identically in App routes and its test; `Sidebar` `Item`/`GROUPS` shape internal and consistent; `titleFor(pathname, agent?)` signature unchanged. Routing test asserts unique stub *subtitles* (not titles, which collide with nav labels). ✓
4. **Note (deviation from §7):** §7 mentioned a separate `NavGroup` component; this plan renders groups inline in `Sidebar` via `GROUPS.map` (one focused file, YAGNI) — same behavior, fewer files. New stub surfaces are rendered inline via `<StubPage .../>` in the route table rather than per-page files, so each swaps to its real page component when that sub-project lands.
