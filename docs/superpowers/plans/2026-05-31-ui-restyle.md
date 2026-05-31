# UI Restyle (Tailwind + Timeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tau-web-ui frontend's ad-hoc inline `style={{}}` styling with a coherent Tailwind design system ("Slate Compact" light, dark-ready via CSS-variable tokens), and add a Timeline (tree + waterfall) tab to the trace view alongside the default Graph.

**Architecture:** Tailwind v3.4 with `darkMode: 'class'`; semantic design tokens defined as CSS variables in `src/index.css` and mapped into the Tailwind theme so dark mode is a future value-swap with no component edits. Every component is rewritten to use Tailwind classes, preserving all test-visible text/roles/aria-labels so existing unit + e2e tests stay green. A shared pure `buildForest` helper feeds both the existing graph layout and a new pure `spansToTimeline` layout; `TraceTimeline` renders the waterfall.

**Tech Stack:** Tailwind CSS 3.4, PostCSS, Autoprefixer, React 18, React Flow, Vitest.

**Source spec:** `docs/superpowers/specs/2026-05-31-ci-and-ui-cleanup-design.md` (Part B). **Prerequisite:** the CI plan may land first or after; this plan is independent but its new lint/format rules (if CI plan landed) will check the restyled code — keep it ESLint/Prettier-clean.

---

## File structure

```
web/tailwind.config.ts          # theme tokens → Tailwind colors; darkMode: class
web/postcss.config.js           # tailwind + autoprefixer
web/src/index.css               # @tailwind layers + :root tokens (+ .dark stub)
web/src/main.tsx                # import ./index.css
web/src/app/ProjectBar.tsx      # restyle
web/src/runs/badges.tsx         # restyle (status class map)
web/src/runs/Launcher.tsx       # restyle
web/src/runs/RunsTable.tsx      # restyle
web/src/trace/TraceGraph.tsx    # restyle SpanNode
web/src/trace/TraceView.tsx     # restyle + Graph|Timeline tabs
web/src/trace/RunControls.tsx   # restyle
web/src/trace/SpanInspector.tsx # restyle
web/src/trace/AssistantStream.tsx # restyle
web/src/trace/forest.ts         # NEW shared tree builder (DFS rows)
web/src/trace/forest.test.ts    # NEW
web/src/trace/layout.ts         # refactor to use forest.ts
web/src/trace/timeline.ts       # NEW pure waterfall layout
web/src/trace/timeline.test.ts  # NEW
web/src/trace/TraceTimeline.tsx # NEW waterfall component
web/src/trace/Tabs.tsx          # NEW segmented control
```

---

### Task 1: Tailwind foundation + tokens

**Files:**
- Create: `web/tailwind.config.ts`, `web/postcss.config.js`, `web/src/index.css`
- Modify: `web/src/main.tsx`, `web/package.json` (deps)

- [ ] **Step 1: Install Tailwind**

Run (in `web/`):

```bash
pnpm add -D tailwindcss@^3.4 postcss@^8 autoprefixer@^10
```

- [ ] **Step 2: PostCSS config**

Create `web/postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Tailwind config with token-backed colors**

Create `web/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: rgb("--bg"),
        surface: rgb("--surface"),
        border: rgb("--border"),
        fg: rgb("--fg"),
        muted: rgb("--muted"),
        accent: rgb("--accent"),
        "accent-fg": rgb("--accent-fg"),
        "st-running": rgb("--status-running"),
        "st-running-soft": rgb("--status-running-soft"),
        "st-ok": rgb("--status-ok"),
        "st-ok-soft": rgb("--status-ok-soft"),
        "st-error": rgb("--status-error"),
        "st-error-soft": rgb("--status-error-soft"),
        "st-cancelled": rgb("--status-cancelled"),
        "st-cancelled-soft": rgb("--status-cancelled-soft"),
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4: index.css with tokens + Tailwind layers**

Create `web/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: 248 250 252;
  --surface: 255 255 255;
  --border: 226 232 240;
  --fg: 30 41 59;
  --muted: 100 116 139;
  --accent: 124 58 237;
  --accent-fg: 255 255 255;
  --status-running: 37 99 235;
  --status-running-soft: 219 234 254;
  --status-ok: 22 163 74;
  --status-ok-soft: 220 252 231;
  --status-error: 220 38 38;
  --status-error-soft: 254 226 226;
  --status-cancelled: 161 98 7;
  --status-cancelled-soft: 254 243 199;
}

/* Dark-ready seam: fill these + add `class="dark"` on <html> to enable dark mode.
   No toggle UI in this scope (see spec §B Non-goals).
.dark {
  --bg: 15 17 21;
  --surface: 22 27 34;
  --border: 33 38 45;
  --fg: 230 237 243;
  --muted: 125 133 144;
  --accent: 167 139 250;
  --accent-fg: 15 17 21;
}
*/

@layer base {
  body {
    @apply bg-bg text-fg antialiased;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
}
```

- [ ] **Step 5: Import the stylesheet**

In `web/src/main.tsx`, add the CSS import near the React Flow CSS import:

```tsx
import "./index.css";
import "@xyflow/react/dist/style.css";
```

- [ ] **Step 6: Verify build + tests unaffected**

Run (in `web/`):

```bash
pnpm build
pnpm vitest run
```
Expected: `build` succeeds (Tailwind compiles); `vitest` 17 passed (no component changed yet).

- [ ] **Step 7: Eyeball it (optional)**

Run the app (`pnpm dev` + the gateway) and confirm the page still renders (it will look mostly unchanged since components still use inline styles, but the body background should now be slate-50). Then commit.

- [ ] **Step 8: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "feat(web): add Tailwind + semantic CSS-variable design tokens (dark-ready)"
```

---

### Task 2: Restyle badges

**Files:**
- Modify: `web/src/runs/badges.tsx`
- Test: `web/src/runs/RunsTable.test.tsx` (unchanged — must still pass)

- [ ] **Step 1: Rewrite badges with Tailwind classes (preserve all text)**

Replace `web/src/runs/badges.tsx`:

```tsx
import type { Run } from "../types/Run";

const STATUS_CLASS: Record<Run["status"], string> = {
  running: "bg-st-running-soft text-st-running",
  completed: "bg-st-ok-soft text-st-ok",
  failed: "bg-st-error-soft text-st-error",
  cancelled: "bg-st-cancelled-soft text-st-cancelled",
};

export function StatusBadge({ status }: { status: Run["status"] }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
      {status}
    </span>
  );
}

export function SubstrateModeBadge({ substrate, mode }: { substrate: Run["substrate"]; mode: Run["mode"] }) {
  return (
    <span className="inline-block rounded border border-border px-2 py-0.5 text-xs text-muted">
      {substrate} · {mode}
    </span>
  );
}

export function formatTokens(run: Run): string {
  const t = run.token_usage;
  return t ? `${t.total_tokens ?? t.input_tokens + t.output_tokens} tok` : "—";
}

export function formatDuration(run: Run): string {
  if (!run.ended_at) return run.status === "running" ? "…" : "—";
  const ms = Date.parse(run.ended_at) - Date.parse(run.started_at);
  return `${(ms / 1000).toFixed(1)}s`;
}
```

(The `<span>` still renders the status word and `"<substrate> · <mode>"` text the tests assert on; only classes changed.)

- [ ] **Step 2: Verify the table tests + full suite still pass**

Run (in `web/`): `pnpm vitest run src/runs/RunsTable.test.tsx && pnpm vitest run`
Expected: RunsTable 2 pass; full suite 17 pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/runs/badges.tsx
git commit -m "style(web): badges → Tailwind status tokens"
```

---

### Task 3: Restyle ProjectBar, Launcher, RunsTable

**Files:**
- Modify: `web/src/app/ProjectBar.tsx`, `web/src/runs/Launcher.tsx`, `web/src/runs/RunsTable.tsx`
- Tests: `web/src/app/ProjectBar.test.tsx`, `web/src/runs/RunsTable.test.tsx` (must still pass)

- [ ] **Step 1: ProjectBar**

Replace `web/src/app/ProjectBar.tsx` (keep the `loadProject` effect + all text):

```tsx
import { useEffect } from "react";
import { useStore } from "../store/store";

export function ProjectBar() {
  const project = useStore((s) => s.project);
  const loadProject = useStore((s) => s.loadProject);
  useEffect(() => {
    loadProject().catch(() => {});
  }, [loadProject]);

  return (
    <header className="flex items-center gap-4 border-b border-border bg-surface px-4 py-2">
      <strong className="text-sm">tau-web-ui</strong>
      <span className="font-mono text-xs text-muted">{project?.project_path ?? "connecting…"}</span>
      <span className="ml-auto text-xs text-muted">tau {project?.tau_version ?? "—"}</span>
      <span
        title={project ? "engine reachable" : "no engine"}
        className={`h-2.5 w-2.5 rounded-full ${project ? "bg-st-ok" : "bg-st-error"}`}
      />
    </header>
  );
}
```

- [ ] **Step 2: Launcher**

Replace `web/src/runs/Launcher.tsx` (keep `aria-label`s, the `Run` button text, and behavior):

```tsx
import { useState } from "react";
import { useStore } from "../store/store";

export function Launcher() {
  const project = useStore((s) => s.project);
  const launch = useStore((s) => s.launch);
  const [agent, setAgent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const agents = project?.agents ?? [];
  const selected = agent || agents[0] || "";

  async function onRun() {
    if (!selected || !prompt.trim()) return;
    setBusy(true);
    try {
      await launch(selected, prompt);
      setPrompt("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setAgent(e.target.value)}
        aria-label="agent"
        className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
      >
        {agents.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <input
        className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
        placeholder="Prompt…"
        value={prompt}
        aria-label="prompt"
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onRun()}
      />
      <button
        onClick={onRun}
        disabled={busy || !selected}
        className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
      >
        {busy ? "Running…" : "Run"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: RunsTable**

Replace `web/src/runs/RunsTable.tsx` (keep empty-state text + click behavior + columns):

```tsx
import type { Run } from "../types/Run";
import { StatusBadge, SubstrateModeBadge, formatTokens, formatDuration } from "./badges";

export function RunsTable({ runs, onOpen }: { runs: Run[]; onOpen: (id: string) => void }) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted">No runs yet. Launch one above.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-3 py-2 font-medium">Agent</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Substrate/Mode</th>
            <th className="px-3 py-2 font-medium">Started</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="px-3 py-2 font-medium">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
            >
              <td className="px-3 py-2 font-medium">{r.agent_id}</td>
              <td className="px-3 py-2">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-3 py-2">
                <SubstrateModeBadge substrate={r.substrate} mode={r.mode} />
              </td>
              <td className="px-3 py-2 font-mono text-xs text-muted">
                {r.started_at.replace("T", " ").slice(0, 19)}
              </td>
              <td className="px-3 py-2 text-xs">{formatDuration(r)}</td>
              <td className="px-3 py-2 text-xs">{formatTokens(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Also restyle `web/src/runs/RunsView.tsx` container — replace its `<section>`/`<h2>` inline styles:

```tsx
import { useEffect } from "react";
import { useStore } from "../store/store";
import { Launcher } from "./Launcher";
import { RunsTable } from "./RunsTable";

export function RunsView() {
  const runs = useStore((s) => s.runs);
  const refreshRuns = useStore((s) => s.refreshRuns);
  const openTrace = useStore((s) => s.openTrace);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  return (
    <section className="p-4">
      <h2 className="mb-3 text-base font-semibold">Runs</h2>
      <Launcher />
      <RunsTable runs={runs} onOpen={openTrace} />
    </section>
  );
}
```

- [ ] **Step 4: Verify tests**

Run (in `web/`): `pnpm vitest run`
Expected: 17 pass (ProjectBar 1, RunsTable 2, etc.). The assertions are on `/p/demo`, `0.0.0-mock`, `greeter`, `completed`, `host · dev`, `/no runs yet/i` — all preserved.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/app/ProjectBar.tsx web/src/runs/Launcher.tsx web/src/runs/RunsTable.tsx web/src/runs/RunsView.tsx
git commit -m "style(web): ProjectBar, Launcher, RunsTable → Tailwind"
```

---

### Task 4: Restyle TraceGraph node

**Files:**
- Modify: `web/src/trace/TraceGraph.tsx`

- [ ] **Step 1: Rewrite SpanNode with Tailwind (keep label text + selection behavior)**

Replace `web/src/trace/TraceGraph.tsx`:

```tsx
import { useMemo } from "react";
import { ReactFlow, Background, Controls, Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Span } from "../types/Span";
import { spansToFlow, type SpanNodeData } from "./layout";
import { useStore } from "../store/store";

const FILL: Record<string, string> = {
  running: "bg-st-running-soft border-st-running/40",
  ok: "bg-st-ok-soft border-st-ok/40",
  error: "bg-st-error-soft border-st-error/40",
};

function SpanNode({ data, id }: NodeProps<Node<SpanNodeData>>) {
  const selected = useStore((s) => s.selectedSpanId === id);
  return (
    <div
      className={`min-w-[120px] rounded-lg border px-2.5 py-1.5 text-xs ${FILL[data.status] ?? "border-border bg-surface"} ${
        selected ? "ring-2 ring-accent" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="font-semibold">{data.label}</div>
      <div className="text-muted">
        {data.kind} · {data.status}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { span: SpanNode };

export function TraceGraph({ spans }: { spans: Span[] }) {
  const select = useStore((s) => s.selectSpan);
  const { nodes, edges } = useMemo(() => spansToFlow(spans), [spans]);
  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + tests**

Run (in `web/`): `pnpm build && pnpm vitest run`
Expected: build clean; 17 pass (layout.test unaffected).

- [ ] **Step 3: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/trace/TraceGraph.tsx
git commit -m "style(web): TraceGraph nodes → Tailwind status tokens"
```

---

### Task 5: Restyle TraceView shell + RunControls + SpanInspector + AssistantStream

**Files:**
- Modify: `web/src/trace/TraceView.tsx`, `web/src/trace/RunControls.tsx`, `web/src/trace/SpanInspector.tsx`, `web/src/trace/AssistantStream.tsx`
- Test: `web/src/trace/SpanInspector.test.tsx` (must still pass)

> Tabs are added in Task 8. This task keeps TraceView showing only the graph (as today) but restyled, so we don't depend on Task 8 yet.

- [ ] **Step 1: AssistantStream**

Replace `web/src/trace/AssistantStream.tsx`:

```tsx
import { useStore } from "../store/store";

export function AssistantStream() {
  const text = useStore((s) => s.assistantText);
  return (
    <div className="max-h-44 overflow-auto border-t border-border bg-surface p-3 font-mono text-[13px] whitespace-pre-wrap">
      {text || <span className="text-muted">No assistant output yet…</span>}
    </div>
  );
}
```

- [ ] **Step 2: SpanInspector**

Replace `web/src/trace/SpanInspector.tsx` (keep `/select a node/i`, name, and JSON of args/result):

```tsx
import type { Span } from "../types/Span";

function Section({ title, value }: { title: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="mb-2.5">
      <div className="text-[11px] uppercase text-muted">{title}</div>
      <pre className="m-0 overflow-auto rounded-md bg-bg p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

export function SpanInspector({ span }: { span: Span | null }) {
  if (!span) return <p className="p-3 text-sm text-muted">Select a node to inspect.</p>;
  const attrs = (span.attributes ?? {}) as Record<string, unknown>;
  return (
    <div className="overflow-auto p-3">
      <h3 className="mt-0 mb-1 text-sm font-semibold">{span.name}</h3>
      <div className="mb-2 text-xs text-muted">
        {span.kind} · {span.status}
      </div>
      <Section title="Args" value={attrs.args} />
      <Section title="Result" value={attrs.result} />
      <Section title="Tokens / usage" value={attrs.usage ?? attrs.token_usage} />
      <Section title="Error" value={attrs.error} />
    </div>
  );
}
```

- [ ] **Step 3: RunControls**

Replace `web/src/trace/RunControls.tsx`:

```tsx
import { useStore } from "../store/store";
import { StatusBadge, formatTokens, formatDuration } from "../runs/badges";

export function RunControls() {
  const trace = useStore((s) => s.currentTrace);
  const cancel = useStore((s) => s.cancelCurrent);
  if (!trace) return null;
  const { run } = trace;
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2">
      <StatusBadge status={run.status} />
      <span className="text-xs text-muted">turns: {run.total_turns ?? "—"}</span>
      <span className="text-xs text-muted">{formatTokens(run)}</span>
      <span className="text-xs text-muted">{formatDuration(run)}</span>
      {run.status === "running" && (
        <button
          onClick={() => cancel()}
          className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs hover:bg-bg"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: TraceView shell (no tabs yet)**

Replace `web/src/trace/TraceView.tsx`:

```tsx
import { useStore } from "../store/store";
import { TraceGraph } from "./TraceGraph";
import { AssistantStream } from "./AssistantStream";
import { SpanInspector } from "./SpanInspector";
import { RunControls } from "./RunControls";

export function TraceView() {
  const trace = useStore((s) => s.currentTrace);
  const selectedId = useStore((s) => s.selectedSpanId);
  const close = useStore((s) => s.closeTrace);

  if (!trace) {
    return <section className="p-4 text-sm text-muted">Select a run to view its trace.</section>;
  }
  const selected = trace.spans.find((s) => s.id === selectedId) ?? null;

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <strong className="text-sm">Trace · {trace.run.agent_id}</strong>
        <button onClick={close} className="text-xs text-accent">
          ← Back to runs
        </button>
      </div>
      <RunControls />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[2] border-r border-border">
          <TraceGraph spans={trace.spans} />
        </div>
        <div className="min-w-[280px] flex-1 overflow-auto">
          <SpanInspector span={selected} />
        </div>
      </div>
      <AssistantStream />
    </section>
  );
}
```

- [ ] **Step 5: Restyle the App shell container**

In `web/src/App.tsx`, replace the inline-styled wrappers:

```tsx
import { useStore } from "./store/store";
import { ProjectBar } from "./app/ProjectBar";
import { RunsView } from "./runs/RunsView";
import { TraceView } from "./trace/TraceView";

export function App() {
  const hasTrace = useStore((s) => s.currentTrace !== null);
  return (
    <div className="flex h-screen flex-col">
      <ProjectBar />
      <main className="min-h-0 flex-1">{hasTrace ? <TraceView /> : <RunsView />}</main>
    </div>
  );
}
```

- [ ] **Step 6: Verify**

Run (in `web/`): `pnpm vitest run && pnpm build`
Expected: 17 pass (SpanInspector 2 still green — name/args/result text preserved); build clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/trace/TraceView.tsx web/src/trace/RunControls.tsx web/src/trace/SpanInspector.tsx web/src/trace/AssistantStream.tsx web/src/App.tsx
git commit -m "style(web): TraceView shell, controls, inspector, stream → Tailwind"
```

---

### Task 6: Extract shared `buildForest` helper (refactor layout)

**Files:**
- Create: `web/src/trace/forest.ts`, `web/src/trace/forest.test.ts`
- Modify: `web/src/trace/layout.ts`
- Test: `web/src/trace/layout.test.ts` (must still pass)

- [ ] **Step 1: Write the failing forest test**

Create `web/src/trace/forest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildForest } from "./forest";
import type { Span } from "../types/Span";

function span(id: string, parent: string | null): Span {
  return { id, parent_id: parent, run_id: "R1", kind: "tool_call", name: id,
    status: "ok", started_at: "t", ended_at: null, attributes: {} };
}

describe("buildForest", () => {
  it("returns DFS order with depth and resolved parents", () => {
    const rows = buildForest([
      span("t1", null),
      span("a", "t1"),
      span("b", "a"),
      span("c", "t1"),
    ]);
    expect(rows.map((r) => r.span.id)).toEqual(["t1", "a", "b", "c"]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
    expect(rows.find((r) => r.span.id === "b")!.resolvedParent).toBe("a");
  });

  it("flags hasChildren", () => {
    const rows = buildForest([span("t1", null), span("a", "t1")]);
    expect(rows.find((r) => r.span.id === "t1")!.hasChildren).toBe(true);
    expect(rows.find((r) => r.span.id === "a")!.hasChildren).toBe(false);
  });

  it("treats a missing parent as a root (orphan tolerance)", () => {
    const rows = buildForest([span("x", "ghost")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].resolvedParent).toBeNull();
  });
});
```

Run: `pnpm vitest run src/trace/forest.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement forest.ts**

Create `web/src/trace/forest.ts`:

```ts
import type { Span } from "../types/Span";

export interface ForestRow {
  span: Span;
  depth: number;
  resolvedParent: string | null;
  hasChildren: boolean;
}

/** Depth-first rows. A parent_id that isn't present in `spans` is treated as a root. */
export function buildForest(spans: Span[]): ForestRow[] {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const childrenOf = new Map<string | null, Span[]>();
  for (const s of spans) {
    const key = s.parent_id && byId.has(s.parent_id) ? s.parent_id : null;
    const list = childrenOf.get(key) ?? [];
    list.push(s);
    childrenOf.set(key, list);
  }
  const rows: ForestRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of childrenOf.get(parent) ?? []) {
      const resolvedParent = s.parent_id && byId.has(s.parent_id) ? s.parent_id : null;
      rows.push({ span: s, depth, resolvedParent, hasChildren: (childrenOf.get(s.id) ?? []).length > 0 });
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
```

Run: `pnpm vitest run src/trace/forest.test.ts` → PASS (3 tests).

- [ ] **Step 3: Refactor layout.ts to use buildForest**

Replace `web/src/trace/layout.ts`:

```ts
import type { Node, Edge } from "@xyflow/react";
import type { Span } from "../types/Span";
import { buildForest } from "./forest";

export interface SpanNodeData extends Record<string, unknown> {
  label: string;
  kind: Span["kind"];
  status: Span["status"];
}

const X_GAP = 220;
const Y_GAP = 70;

/** Deterministic tree layout: x = depth, y = DFS order. Edges follow resolved parents. */
export function spansToFlow(spans: Span[]): { nodes: Node<SpanNodeData>[]; edges: Edge[] } {
  const rows = buildForest(spans);
  const nodes: Node<SpanNodeData>[] = rows.map((r, i) => ({
    id: r.span.id,
    position: { x: r.depth * X_GAP, y: i * Y_GAP },
    data: { label: r.span.name, kind: r.span.kind, status: r.span.status },
    type: "span",
  }));
  const edges: Edge[] = rows
    .filter((r) => r.resolvedParent !== null)
    .map((r) => ({ id: `${r.resolvedParent}->${r.span.id}`, source: r.resolvedParent as string, target: r.span.id }));
  return { nodes, edges };
}
```

- [ ] **Step 4: Verify the existing layout tests still pass**

Run: `pnpm vitest run src/trace/layout.test.ts && pnpm vitest run`
Expected: layout 3 pass; full suite now 23 pass (17 + 3 forest + 3 layout already counted... confirm count rises by 3 for forest).

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/trace/forest.ts web/src/trace/forest.test.ts web/src/trace/layout.ts
git commit -m "refactor(web): extract shared buildForest used by graph layout"
```

---

### Task 7: Timeline layout (pure)

**Files:**
- Create: `web/src/trace/timeline.ts`, `web/src/trace/timeline.test.ts`

- [ ] **Step 1: Write the failing timeline test**

Create `web/src/trace/timeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spansToTimeline } from "./timeline";
import type { Span } from "../types/Span";

function span(id: string, parent: string | null, start: string, end: string | null): Span {
  return { id, parent_id: parent, run_id: "R1", kind: "tool_call", name: id,
    status: end ? "ok" : "running", started_at: start, ended_at: end, attributes: {} };
}

const T = (s: number) => `2026-05-31T00:00:0${s}.000Z`;

describe("spansToTimeline", () => {
  it("places sequential spans by offset and width across the run window", () => {
    // window 0s..4s. A: 0-1s, B: 2-4s
    const rows = spansToTimeline([span("A", null, T(0), T(1)), span("B", null, T(2), T(4))]);
    const a = rows.find((r) => r.span.id === "A")!;
    const b = rows.find((r) => r.span.id === "B")!;
    expect(a.offsetPct).toBeCloseTo(0, 1);
    expect(a.widthPct).toBeCloseTo(25, 1); // 1s of 4s
    expect(b.offsetPct).toBeCloseTo(50, 1); // starts at 2s of 4s
    expect(b.widthPct).toBeCloseTo(50, 1); // 2s of 4s
  });

  it("extends a running span (no ended_at) to the window end", () => {
    // window 0..3 (B ends at 3); A running from 0
    const rows = spansToTimeline([span("A", null, T(0), null), span("B", null, T(1), T(3))]);
    const a = rows.find((r) => r.span.id === "A")!;
    expect(a.offsetPct).toBeCloseTo(0, 1);
    expect(a.widthPct).toBeCloseTo(100, 1);
  });

  it("preserves DFS nesting depth", () => {
    const rows = spansToTimeline([
      span("t", null, T(0), T(4)),
      span("c", "t", T(1), T(2)),
    ]);
    expect(rows.map((r) => r.span.id)).toEqual(["t", "c"]);
    expect(rows.find((r) => r.span.id === "c")!.depth).toBe(1);
    expect(rows.find((r) => r.span.id === "c")!.resolvedParent).toBe("t");
  });

  it("guards a zero-width window (all same timestamp) without NaN", () => {
    const rows = spansToTimeline([span("A", null, T(0), T(0))]);
    expect(Number.isFinite(rows[0].offsetPct)).toBe(true);
    expect(Number.isFinite(rows[0].widthPct)).toBe(true);
    expect(rows[0].widthPct).toBeGreaterThan(0);
  });
});
```

Run: `pnpm vitest run src/trace/timeline.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement timeline.ts**

Create `web/src/trace/timeline.ts`:

```ts
import type { Span } from "../types/Span";
import { buildForest } from "./forest";

export interface TimelineRow {
  span: Span;
  depth: number;
  resolvedParent: string | null;
  hasChildren: boolean;
  offsetPct: number;
  widthPct: number;
}

const MIN_WIDTH_PCT = 1.5;

/**
 * Waterfall layout: each span gets a horizontal bar positioned within the run's
 * [t0, t1] window. Running spans (no ended_at) extend to t1. `now` overrides the
 * window end for live runs; if omitted, the latest known timestamp is used.
 */
export function spansToTimeline(spans: Span[], now?: string): TimelineRow[] {
  const rows = buildForest(spans);
  const starts = spans.map((s) => Date.parse(s.started_at));
  const ends = spans.map((s) => (s.ended_at ? Date.parse(s.ended_at) : Number.NaN));
  const known = [...starts, ...ends.filter((n) => Number.isFinite(n))];
  const nowMs = now ? Date.parse(now) : known.length ? Math.max(...known) : 0;
  const t0 = starts.length ? Math.min(...starts) : 0;
  const t1 = Math.max(nowMs, ...starts);
  const span = t1 - t0;

  return rows.map((r) => {
    const start = Date.parse(r.span.started_at);
    const end = r.span.ended_at ? Date.parse(r.span.ended_at) : t1;
    const offsetPct = span > 0 ? ((start - t0) / span) * 100 : 0;
    const rawWidth = span > 0 ? ((end - start) / span) * 100 : MIN_WIDTH_PCT;
    return {
      span: r.span,
      depth: r.depth,
      resolvedParent: r.resolvedParent,
      hasChildren: r.hasChildren,
      offsetPct,
      widthPct: Math.max(MIN_WIDTH_PCT, rawWidth),
    };
  });
}
```

Run: `pnpm vitest run src/trace/timeline.test.ts` → PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/trace/timeline.ts web/src/trace/timeline.test.ts
git commit -m "feat(web): pure waterfall timeline layout"
```

---

### Task 8: Timeline component + Tabs, wired into TraceView

**Files:**
- Create: `web/src/trace/Tabs.tsx`, `web/src/trace/TraceTimeline.tsx`
- Modify: `web/src/trace/TraceView.tsx`
- Test: `web/src/trace/TraceTimeline.test.tsx` (new)

- [ ] **Step 1: Tabs segmented control**

Create `web/src/trace/Tabs.tsx`:

```tsx
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-xs">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`rounded px-2.5 py-1 font-medium ${
            value === t.id ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Failing TraceTimeline test**

Create `web/src/trace/TraceTimeline.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TraceTimeline } from "./TraceTimeline";
import { useStore } from "../store/store";
import type { Span } from "../types/Span";

function span(id: string, parent: string | null): Span {
  return { id, parent_id: parent, run_id: "R1", kind: "tool_call", name: id,
    status: "ok", started_at: "2026-05-31T00:00:00.000Z", ended_at: "2026-05-31T00:00:01.000Z", attributes: {} };
}

beforeEach(() => useStore.setState({ selectedSpanId: null }));

describe("TraceTimeline", () => {
  it("renders a row per span and selects on click", () => {
    render(<TraceTimeline spans={[span("turn1", null), span("fs-read", "turn1")]} />);
    expect(screen.getByText("turn1")).toBeInTheDocument();
    const row = screen.getByText("fs-read");
    fireEvent.click(row);
    expect(useStore.getState().selectedSpanId).toBe("fs-read");
  });
});
```

Run: `pnpm vitest run src/trace/TraceTimeline.test.tsx` → FAIL.

- [ ] **Step 3: Implement TraceTimeline**

Create `web/src/trace/TraceTimeline.tsx`:

```tsx
import { useMemo, useState } from "react";
import type { Span } from "../types/Span";
import { spansToTimeline } from "./timeline";
import { useStore } from "../store/store";

const BAR: Record<string, string> = {
  running: "bg-st-running",
  ok: "bg-st-ok",
  error: "bg-st-error",
};

export function TraceTimeline({ spans }: { spans: Span[] }) {
  const select = useStore((s) => s.selectSpan);
  const selectedId = useStore((s) => s.selectedSpanId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => spansToTimeline(spans), [spans]);

  const parentOf = useMemo(() => {
    const m = new Map<string, string | null>();
    rows.forEach((r) => m.set(r.span.id, r.resolvedParent));
    return m;
  }, [rows]);

  const hidden = (id: string) => {
    let p = parentOf.get(id) ?? null;
    while (p) {
      if (collapsed.has(p)) return true;
      p = parentOf.get(p) ?? null;
    }
    return false;
  };

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="h-full overflow-auto text-xs">
      <div className="flex border-b border-border px-3 py-1.5 text-muted">
        <span className="w-40">span</span>
        <span className="flex-1">timeline</span>
      </div>
      {rows
        .filter((r) => !hidden(r.span.id))
        .map((r) => (
          <div
            key={r.span.id}
            onClick={() => select(r.span.id)}
            className={`flex cursor-pointer items-center border-b border-border/60 px-3 py-1.5 hover:bg-bg ${
              selectedId === r.span.id ? "bg-accent/10" : ""
            }`}
          >
            <span className="flex w-40 items-center gap-1.5" style={{ paddingLeft: `${r.depth * 14}px` }}>
              {r.hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(r.span.id);
                  }}
                  className="text-muted"
                  aria-label={collapsed.has(r.span.id) ? "expand" : "collapse"}
                >
                  {collapsed.has(r.span.id) ? "▸" : "▾"}
                </button>
              ) : (
                <span className="w-[10px]" />
              )}
              <span
                className={`h-1.5 w-1.5 rounded-full ${BAR[r.span.status] ?? "bg-muted"}`}
              />
              <span className="truncate font-medium">{r.span.name}</span>
            </span>
            <span className="relative h-2 flex-1">
              <span
                className={`absolute top-0 h-1.5 rounded-sm ${BAR[r.span.status] ?? "bg-muted"} ${
                  r.span.status === "running" ? "opacity-70" : ""
                }`}
                style={{ left: `${r.offsetPct}%`, width: `${r.widthPct}%` }}
              />
            </span>
          </div>
        ))}
    </div>
  );
}
```

Run: `pnpm vitest run src/trace/TraceTimeline.test.tsx` → PASS.

- [ ] **Step 4: Wire the Tabs into TraceView**

Update `web/src/trace/TraceView.tsx` — add tab state and switch the left pane:

```tsx
import { useState } from "react";
import { useStore } from "../store/store";
import { TraceGraph } from "./TraceGraph";
import { TraceTimeline } from "./TraceTimeline";
import { AssistantStream } from "./AssistantStream";
import { SpanInspector } from "./SpanInspector";
import { RunControls } from "./RunControls";
import { Tabs } from "./Tabs";

type TraceTab = "graph" | "timeline";

export function TraceView() {
  const trace = useStore((s) => s.currentTrace);
  const selectedId = useStore((s) => s.selectedSpanId);
  const close = useStore((s) => s.closeTrace);
  const [tab, setTab] = useState<TraceTab>("graph");

  if (!trace) {
    return <section className="p-4 text-sm text-muted">Select a run to view its trace.</section>;
  }
  const selected = trace.spans.find((s) => s.id === selectedId) ?? null;

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-3">
          <strong className="text-sm">Trace · {trace.run.agent_id}</strong>
          <Tabs
            tabs={[
              { id: "graph", label: "Graph" },
              { id: "timeline", label: "Timeline" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        <button onClick={close} className="text-xs text-accent">
          ← Back to runs
        </button>
      </div>
      <RunControls />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[2] border-r border-border">
          {tab === "graph" ? <TraceGraph spans={trace.spans} /> : <TraceTimeline spans={trace.spans} />}
        </div>
        <div className="min-w-[280px] flex-1 overflow-auto">
          <SpanInspector span={selected} />
        </div>
      </div>
      <AssistantStream />
    </section>
  );
}
```

- [ ] **Step 5: Verify full suite + build**

Run (in `web/`): `pnpm vitest run && pnpm build`
Expected: all tests pass (now includes forest 3, timeline 4, TraceTimeline 1); build clean. Graph is still the default tab, so the Playwright `fs-read` assertions remain valid.

- [ ] **Step 6: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/src/trace/Tabs.tsx web/src/trace/TraceTimeline.tsx web/src/trace/TraceTimeline.test.tsx web/src/trace/TraceView.tsx
git commit -m "feat(web): trace Timeline tab (tree + waterfall) alongside default Graph"
```

---

### Task 9: Final verification — e2e, inline-style audit, dark-ready smoke

**Files:** none (verification + evidence)

- [ ] **Step 1: Audit for leftover ad-hoc inline styles**

Run (in `web/`):

```bash
grep -rn "style={{" src --include="*.tsx" | grep -v "left:" | grep -v "width:" | grep -v "paddingLeft:"
```
Expected: no matches except the dynamic timeline bar positioning (`left`/`width`) and the depth `paddingLeft` — those are legitimate computed values (spec §B.8 #1). If any static inline style remains, convert it to Tailwind classes and re-commit.

- [ ] **Step 2: Run the unit suite + typecheck + lint (if CI plan landed)**

Run (in `web/`): `pnpm vitest run && pnpm typecheck`
Expected: all green. If ESLint is present (`web/eslint.config.js` exists from the CI plan): `pnpm lint && pnpm format:check` — fix any issues.

- [ ] **Step 3: Run the Playwright e2e against the restyled UI**

Run:
```bash
cd /Users/titouanlebocq/code/tau-ui && cargo build
cd web && pnpm exec playwright install chromium && pnpm e2e
```
Expected: both tests pass (the restyle preserved labels/roles/text). If a selector now fails, it means a test-visible string changed — restore the exact string in the component (do not weaken the test).

- [ ] **Step 4: Dark-ready smoke check (manual, then revert)**

Temporarily uncomment the `.dark { … }` block in `web/src/index.css` and add `class="dark"` to `<html>` in `web/index.html`. Run `pnpm dev`, confirm the whole app re-themes to dark with no component edits. Then **revert both changes** (dark toggle UI is out of scope). This proves the token seam works.

- [ ] **Step 5: Capture fresh visual evidence**

Run `pnpm e2e` once more (it writes `docs/verification/trace-complete.png`). Commit the updated screenshot.

- [ ] **Step 6: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add -A
git commit -m "test(web): verify restyle keeps unit + e2e green; refresh visual evidence"
```

---

## Self-review

1. **Spec coverage (Part B):** B.1 Tailwind foundation → Task 1. B.2 tokens → Task 1 (`index.css` exact values + `tailwind.config.ts` mapping). B.3 component migration → Tasks 2–5 (badges, ProjectBar/Launcher/RunsTable/RunsView, TraceGraph, TraceView/RunControls/SpanInspector/AssistantStream/App). B.4 tabs → Task 8. B.5 timeline (pure + component) → Tasks 6 (forest), 7 (timeline), 8 (TraceTimeline). B.6 test-compat constraint → enforced by keeping text/roles in every restyle task + verified in Tasks 3/5/8/9. B.7 testing → forest.test, timeline.test, TraceTimeline.test + existing suites. B.8 acceptance → Task 9 (inline audit, dark smoke, e2e). ✓
2. **Placeholder scan:** every component is given as complete code; no TBD. ✓
3. **Type consistency:** `buildForest`→`ForestRow{span,depth,resolvedParent,hasChildren}` defined in Task 6 and consumed by `layout.ts` (Task 6) and `timeline.ts` (Task 7); `spansToTimeline`→`TimelineRow` consumed by `TraceTimeline` (Task 8); `Tabs<T>` props match TraceView usage (Task 8); token color names (`bg/surface/border/fg/muted/accent/accent-fg/st-*`) defined in Task 1 and used identically across all restyle tasks. ✓
4. **Gap check:** the dynamic timeline bar uses inline `left/width` — explicitly allowed by spec §B.8 #1 and whitelisted in the Task 9 audit grep. ✓
