# Workflow canvas — interaction half (Plan 3b of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the (gated) workflow graph editor best-in-class to *edit* — sub-project **B**, the interaction half (Levels 2–4 of the n8n-grade canvas): a per-node **hover toolbar** (inspect · disable · duplicate · delete), **inline `+`** to add the next step and **`+` on an edge** to insert between, and a **searchable add-step palette**. All graph mutations live in **pure, unit-tested helpers**; edits stay **local-only**, Save → IR remains gated.

**Architecture:** A new pure module `web/src/graph/edit.ts` owns every mutation (`addNextStep`, `insertStepOnEdge`, `deleteNode`, `duplicateNode`, `toggleDisabled`) returning fresh `{nodes, edges}` — directly unit-tested. A `StepPalette` component is a searchable picker (`agent.run` / `tool.call` / an agent by name). Actions reach the React Flow custom node/edge through a small **context** (`GraphActions`) provided around the canvas; `StepNode` gains a `<NodeToolbar>` + an inline `+`, and a custom `StepEdge` renders a midpoint `+` via `EdgeLabelRenderer`. `GraphEditor` wires the handlers (calling `edit.ts`), holds the palette state, and fetches the agent list. The live canvas is covered by e2e; the helpers + palette by jsdom unit tests (React Flow nodes aren't reliably assertable in jsdom).

**Tech Stack:** React 18, `@xyflow/react` v12 (`NodeToolbar`, `EdgeLabelRenderer`, `BaseEdge`, `getBezierPath`, `useReactFlow`), Tailwind, Vitest, Playwright. No gateway/Rust changes (the display half shipped the data).

**Builds on Plan 3a:** `StepNodeData` already carries `provider`/`tools`; `StepNode` is icon-forward; the inspector + minimap exist. This plan adds the edit interactions on top. **Final-review carry-over:** edit-time added `agent.run` nodes re-resolve `provider` to the recommended backend (handled in `edit.ts` `buildStepNode`).

---

## File Structure

**New:** `web/src/graph/edit.ts` (pure mutations), `web/src/graph/edit.test.ts`, `web/src/graph/StepPalette.tsx`, `web/src/graph/StepPalette.test.tsx`, `web/src/graph/GraphActions.tsx` (context), `web/src/graph/StepEdge.tsx` (custom edge).
**Modified:** `web/src/graph/layout.ts` (export `X_GAP`, add optional `disabled` to `StepNodeData`, tag edges `type: "step"`), `web/src/graph/StepNode.tsx` (toolbar + inline `+` + disabled styling), `web/src/graph/GraphCanvas.tsx` (register `edgeTypes`, wrap in `GraphActions`), `web/src/graph/GraphEditor.tsx` (handlers + palette state + agents fetch; remove the old sidebar add-buttons), `web/src/graph/GraphEditor.test.tsx` (update edit-mode test), `web/e2e/run.spec.ts` (e2e).

---

## Task 1: Pure graph-edit helpers (`edit.ts`) + unit tests

**Files:** Modify `web/src/graph/layout.ts`; Create `web/src/graph/edit.ts`, `web/src/graph/edit.test.ts`.

- [ ] **Step 1: In `web/src/graph/layout.ts` — export `X_GAP` and add an optional `disabled` field**

(a) Change `const X_GAP = 220;` to `export const X_GAP = 220;` (leave `Y_GAP` as-is).

(b) Add to the `StepNodeData` interface (after `tools: string[];`):

```ts
  disabled?: boolean;
```

(c) Tag laid-out edges with the custom type — in `workflowToFlow`, change the edges map to add `type: "step"`:

```ts
  const edges: Edge[] = graph.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    type: "step",
  }));
```

(`disabled` is optional, so existing `StepNodeData` literals elsewhere keep compiling.)

- [ ] **Step 2: Write the failing tests `web/src/graph/edit.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import type { StepNodeData } from "./layout";
import {
  addNextStep,
  insertStepOnEdge,
  deleteNode,
  duplicateNode,
  toggleDisabled,
  nextStepId,
} from "./edit";

function n(id: string, x = 0, y = 0): Node<StepNodeData> {
  return {
    id,
    type: "step",
    position: { x, y },
    data: { label: id, kind: "agent.run", agent: "researcher", tool: null, input: null, provider: "anthropic", tools: [] },
  };
}
const e = (source: string, target: string): Edge => ({ id: `${source}->${target}`, source, target, type: "step" });

describe("edit helpers", () => {
  it("nextStepId returns step-(max+1)", () => {
    expect(nextStepId([n("gather"), n("step-2")])).toBe("step-3");
    expect(nextStepId([n("gather")])).toBe("step-1");
  });

  it("addNextStep appends a node + a connecting edge from the source", () => {
    const { nodes, edges } = addNextStep([n("a")], [], "a", { kind: "agent.run" }, "anthropic");
    expect(nodes).toHaveLength(2);
    const added = nodes[1];
    expect(added.id).toBe("step-1");
    expect(added.data.kind).toBe("agent.run");
    expect(added.data.provider).toBe("anthropic"); // re-resolved to recommended
    expect(edges).toEqual([{ id: "a->step-1", source: "a", target: "step-1", type: "step" }]);
  });

  it("addNextStep with a tool.call pick has a null provider", () => {
    const { nodes } = addNextStep([n("a")], [], "a", { kind: "tool.call" }, "anthropic");
    expect(nodes[1].data.kind).toBe("tool.call");
    expect(nodes[1].data.provider).toBeNull();
    expect(nodes[1].data.tool).toBe("fs-write");
  });

  it("addNextStep with a specific agent presets it", () => {
    const { nodes } = addNextStep([n("a")], [], "a", { kind: "agent.run", agent: "greeter" }, "anthropic");
    expect(nodes[1].data.agent).toBe("greeter");
  });

  it("addNextStep on a missing source is a no-op", () => {
    const before = { nodes: [n("a")], edges: [] as Edge[] };
    const after = addNextStep(before.nodes, before.edges, "nope", { kind: "agent.run" }, "anthropic");
    expect(after.nodes).toHaveLength(1);
    expect(after.edges).toHaveLength(0);
  });

  it("insertStepOnEdge replaces A->B with A->new->B (net +1 node, +1 edge)", () => {
    const nodes = [n("a", 0, 0), n("b", 440, 0)];
    const edges = [e("a", "b")];
    const out = insertStepOnEdge(nodes, edges, "a->b", { kind: "agent.run" }, "anthropic");
    expect(out.nodes).toHaveLength(3);
    const mid = out.nodes[2];
    expect(mid.id).toBe("step-1");
    expect(mid.position.x).toBe(220); // midpoint of 0 and 440
    expect(out.edges.map((x) => x.id).sort()).toEqual(["a->step-1", "step-1->b"]);
  });

  it("insertStepOnEdge on a missing edge is a no-op", () => {
    const out = insertStepOnEdge([n("a")], [e("a", "b")], "x->y", { kind: "agent.run" }, "anthropic");
    expect(out.nodes).toHaveLength(1);
    expect(out.edges).toHaveLength(1);
  });

  it("deleteNode removes the node and its connected edges", () => {
    const nodes = [n("a"), n("b"), n("c")];
    const edges = [e("a", "b"), e("b", "c")];
    const out = deleteNode(nodes, edges, "b");
    expect(out.nodes.map((x) => x.id)).toEqual(["a", "c"]);
    expect(out.edges).toHaveLength(0);
  });

  it("duplicateNode clones with a fresh id + offset, no edges", () => {
    const out = duplicateNode([n("a", 10, 10)], "a");
    expect(out.newId).toBe("step-1");
    expect(out.nodes).toHaveLength(2);
    const copy = out.nodes[1];
    expect(copy.id).toBe("step-1");
    expect(copy.data.label).toBe("step-1");
    expect(copy.position).toEqual({ x: 50, y: 60 });
  });

  it("toggleDisabled flips the disabled flag on the matching node only", () => {
    const out = toggleDisabled([n("a"), n("b")], "a");
    expect(out[0].data.disabled).toBe(true);
    expect(out[1].data.disabled).toBeFalsy();
    expect(toggleDisabled(out, "a")[0].data.disabled).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail** — `cd web && pnpm test -- src/graph/edit.test.ts` → FAIL (cannot resolve `./edit`).

- [ ] **Step 4: Create `web/src/graph/edit.ts`**

```ts
import type { Node, Edge } from "@xyflow/react";
import { type StepNodeData, X_GAP } from "./layout";

export interface StepPick {
  kind: "agent.run" | "tool.call";
  agent?: string | null;
}

type Graph = { nodes: Node<StepNodeData>[]; edges: Edge[] };

/** Next `step-N` id (one past the highest existing numeric suffix). */
export function nextStepId(nodes: Node<StepNodeData>[]): string {
  let max = 0;
  for (const node of nodes) {
    const m = /^step-(\d+)$/.exec(node.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `step-${max + 1}`;
}

function buildStepNode(
  id: string,
  pick: StepPick,
  recommended: string,
  position: { x: number; y: number },
): Node<StepNodeData> {
  const isAgent = pick.kind === "agent.run";
  return {
    id,
    type: "step",
    position,
    data: {
      label: id,
      kind: pick.kind,
      agent: isAgent ? (pick.agent ?? "researcher") : null,
      tool: isAgent ? null : "fs-write",
      input: null,
      provider: isAgent ? recommended || null : null,
      tools: [],
      disabled: false,
    },
  };
}

/** Add a step after `fromId` and connect them. No-op if `fromId` is missing. */
export function addNextStep(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
  fromId: string,
  pick: StepPick,
  recommended: string,
): Graph {
  const from = nodes.find((node) => node.id === fromId);
  if (!from) return { nodes, edges };
  const id = nextStepId(nodes);
  const node = buildStepNode(id, pick, recommended, {
    x: from.position.x + X_GAP,
    y: from.position.y,
  });
  return {
    nodes: [...nodes, node],
    edges: [...edges, { id: `${fromId}->${id}`, source: fromId, target: id, type: "step" }],
  };
}

/** Insert a step on `edgeId`, rewiring A->B into A->new->B. No-op if missing. */
export function insertStepOnEdge(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
  edgeId: string,
  pick: StepPick,
  recommended: string,
): Graph {
  const edge = edges.find((ed) => ed.id === edgeId);
  if (!edge) return { nodes, edges };
  const a = nodes.find((node) => node.id === edge.source);
  const b = nodes.find((node) => node.id === edge.target);
  const id = nextStepId(nodes);
  const position =
    a && b
      ? { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 }
      : { x: (a?.position.x ?? 0) + X_GAP, y: a?.position.y ?? 0 };
  const node = buildStepNode(id, pick, recommended, position);
  return {
    nodes: [...nodes, node],
    edges: [
      ...edges.filter((ed) => ed.id !== edgeId),
      { id: `${edge.source}->${id}`, source: edge.source, target: id, type: "step" },
      { id: `${id}->${edge.target}`, source: id, target: edge.target, type: "step" },
    ],
  };
}

/** Remove a node and any edge touching it. */
export function deleteNode(nodes: Node<StepNodeData>[], edges: Edge[], id: string): Graph {
  return {
    nodes: nodes.filter((node) => node.id !== id),
    edges: edges.filter((ed) => ed.source !== id && ed.target !== id),
  };
}

/** Clone a node with a fresh id + offset position (no edges copied). */
export function duplicateNode(
  nodes: Node<StepNodeData>[],
  id: string,
): { nodes: Node<StepNodeData>[]; newId: string | null } {
  const src = nodes.find((node) => node.id === id);
  if (!src) return { nodes, newId: null };
  const newId = nextStepId(nodes);
  const copy: Node<StepNodeData> = {
    ...src,
    id: newId,
    position: { x: src.position.x + 40, y: src.position.y + 50 },
    selected: false,
    data: { ...src.data, label: newId },
  };
  return { nodes: [...nodes, copy], newId };
}

/** Toggle the local `disabled` flag on one node (visual marker; Save is gated). */
export function toggleDisabled(nodes: Node<StepNodeData>[], id: string): Node<StepNodeData>[] {
  return nodes.map((node) =>
    node.id === id ? { ...node, data: { ...node.data, disabled: !node.data.disabled } } : node,
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass** — `cd web && pnpm test -- src/graph/edit.test.ts` → PASS (10 tests). Then `pnpm typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/graph/layout.ts web/src/graph/edit.ts web/src/graph/edit.test.ts
git commit -m "feat(web): pure graph-edit helpers (add/insert/delete/duplicate/disable)"
```

---

## Task 2: StepPalette component + test

**Files:** Create `web/src/graph/StepPalette.tsx`, `web/src/graph/StepPalette.test.tsx`.

- [ ] **Step 1: Write the failing test `web/src/graph/StepPalette.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepPalette } from "./StepPalette";

describe("StepPalette", () => {
  it("lists kinds + agents and picks one", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<StepPalette agents={["researcher", "greeter"]} onPick={onPick} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "agent.run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tool.call" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "researcher" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "greeter" }));
    expect(onPick).toHaveBeenCalledWith({ kind: "agent.run", agent: "greeter" });
  });

  it("filters by the search term", async () => {
    const user = userEvent.setup();
    render(<StepPalette agents={["researcher", "greeter"]} onPick={() => {}} onClose={() => {}} />);
    await user.type(screen.getByLabelText("search steps"), "greet");
    expect(screen.getByRole("button", { name: "greeter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "researcher" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "agent.run" })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd web && pnpm test -- src/graph/StepPalette.test.tsx` → FAIL (no module).

- [ ] **Step 3: Create `web/src/graph/StepPalette.tsx`**

```tsx
import { useState } from "react";
import type { StepPick } from "./edit";

export function StepPalette({
  agents,
  onPick,
  onClose,
}: {
  agents: string[];
  onPick: (pick: StepPick) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const ql = q.toLowerCase();
  const showAgentRun = "agent.run".includes(ql);
  const showToolCall = "tool.call".includes(ql);
  const matched = agents.filter((a) => a.toLowerCase().includes(ql));
  const item = "flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent/10";
  const dot = "flex h-4 w-4 flex-none items-center justify-center rounded text-[8px]";
  return (
    <div
      role="dialog"
      aria-label="add step"
      className="w-44 overflow-hidden rounded-lg border border-border bg-surface text-xs shadow-lg"
    >
      <input
        autoFocus
        aria-label="search steps"
        placeholder="search…"
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        onKeyDown={(ev) => ev.key === "Escape" && onClose()}
        className="w-full border-b border-border bg-surface px-2 py-1.5 text-xs outline-none"
      />
      <div className="max-h-44 overflow-auto py-1">
        {showAgentRun && (
          <button type="button" className={item} onClick={() => onPick({ kind: "agent.run" })}>
            <span className={`${dot} bg-accent text-white`}>◆</span>
            agent.run
          </button>
        )}
        {showToolCall && (
          <button type="button" className={item} onClick={() => onPick({ kind: "tool.call" })}>
            <span className={`${dot} bg-st-running text-white`}>⚒</span>
            tool.call
          </button>
        )}
        {matched.length > 0 && (
          <div className="px-2 pb-0.5 pt-1.5 text-[9px] uppercase text-muted">agents</div>
        )}
        {matched.map((a) => (
          <button
            key={a}
            type="button"
            className={item}
            onClick={() => onPick({ kind: "agent.run", agent: a })}
          >
            <span className={`${dot} bg-accent/20 text-accent`}>◆</span>
            {a}
          </button>
        ))}
        {!showAgentRun && !showToolCall && matched.length === 0 && (
          <div className="px-2 py-1 text-muted">no matches</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `cd web && pnpm test -- src/graph/StepPalette.test.tsx` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/graph/StepPalette.tsx web/src/graph/StepPalette.test.tsx
git commit -m "feat(web): searchable add-step palette"
```

---

## Task 3: Hover toolbar + node actions (context + NodeToolbar + disabled styling)

**Files:** Create `web/src/graph/GraphActions.tsx`; Modify `web/src/graph/StepNode.tsx`, `web/src/graph/GraphCanvas.tsx`, `web/src/graph/GraphEditor.tsx`.

Context: actions reach the custom node through a React context (avoids stuffing functions into node `data`). This task wires **inspect/disable/duplicate/delete**; Task 4 extends the same context with add/insert. `NodeToolbar` (from `@xyflow/react`) renders a floating toolbar tied to the node's selection.

- [ ] **Step 1: Create `web/src/graph/GraphActions.tsx`**

```tsx
import { createContext, useContext } from "react";

export interface GraphActions {
  editable: boolean;
  onInspect: (id: string) => void;
  onDisable: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  // Extended in Plan 3b Task 4 (inline add / edge insert):
  onRequestAdd: (fromId: string, at: { x: number; y: number }) => void;
  onRequestInsert: (edgeId: string, at: { x: number; y: number }) => void;
}

const noop = () => {};
export const GraphActionsContext = createContext<GraphActions>({
  editable: false,
  onInspect: noop,
  onDisable: noop,
  onDuplicate: noop,
  onDelete: noop,
  onRequestAdd: noop,
  onRequestInsert: noop,
});

export const useGraphActions = () => useContext(GraphActionsContext);
```

- [ ] **Step 2: Add the `<NodeToolbar>` + disabled styling to `web/src/graph/StepNode.tsx`**

Replace the file with (keeps the Plan 3a icon node, adds the toolbar + a `disabled` dim/marker):

```tsx
import { Handle, Position, NodeToolbar, type Node, type NodeProps } from "@xyflow/react";
import type { StepNodeData } from "./layout";
import { useGraphActions } from "./GraphActions";

export function StepNode({ id, data, selected }: NodeProps<Node<StepNodeData>>) {
  const tool = data.kind === "tool.call";
  const who = data.agent ?? data.tool;
  const actions = useGraphActions();
  const handle = "!h-2 !w-2 !border !border-border !bg-muted";
  const tbtn = "rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10";
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top} className="flex gap-0.5 rounded-md bg-fg px-1 py-0.5 text-bg">
        <button type="button" title="inspect" className={tbtn} onClick={() => actions.onInspect(id)}>
          ⊙
        </button>
        {actions.editable && (
          <>
            <button type="button" title="disable" className={tbtn} onClick={() => actions.onDisable(id)}>
              ⏸
            </button>
            <button type="button" title="duplicate" className={tbtn} onClick={() => actions.onDuplicate(id)}>
              ⧉
            </button>
            <button type="button" title="delete" className={tbtn} onClick={() => actions.onDelete(id)}>
              🗑
            </button>
          </>
        )}
      </NodeToolbar>
      <div
        className={`flex min-w-[150px] items-center gap-2 rounded-lg border bg-surface px-2.5 py-2 text-xs shadow-sm ${
          selected ? "ring-2 ring-accent" : ""
        } ${tool ? "border-st-running/40" : "border-accent/40"} ${data.disabled ? "opacity-50" : ""}`}
      >
        <Handle type="target" position={Position.Left} className={handle} />
        <div
          aria-hidden
          className={`flex h-7 w-7 flex-none items-center justify-center rounded-md text-sm text-white ${
            tool ? "bg-st-running" : "bg-accent"
          }`}
        >
          {tool ? "⚒" : "◆"}
        </div>
        <div className="min-w-0">
          <div className={`truncate font-semibold ${data.disabled ? "line-through" : ""}`}>
            {data.label}
          </div>
          <div className="flex items-center gap-1 text-muted">
            <span className="truncate">{who ?? data.kind}</span>
            {!tool && data.provider && (
              <span className="flex-none rounded bg-accent/10 px-1 text-[9px] font-medium text-accent">
                ⚡ {data.provider}
              </span>
            )}
          </div>
        </div>
        <Handle type="source" position={Position.Right} className={handle} />
      </div>
    </>
  );
}
```

(`bg-fg`/`text-bg` are the inverse surface tokens used for dark chips; if they don't resolve, use `bg-[#0f172a] text-white` — verify against the theme and report.)

- [ ] **Step 3: Wrap the canvas in the context provider in `web/src/graph/GraphCanvas.tsx`**

(a) Import the provider + the type:

```tsx
import { GraphActionsContext, type GraphActions } from "./GraphActions";
```

(b) Add an `actions: GraphActions` prop to `GraphCanvas`'s props (add `actions` to the destructured params and the props type: `actions: GraphActions;`).

(c) Wrap the returned `<div className="h-[420px] …">…</div>` in the provider:

```tsx
  return (
    <GraphActionsContext.Provider value={actions}>
      <div className="relative h-[420px] w-full rounded-md border border-border">
        <ReactFlow … >
          …
        </ReactFlow>
      </div>
    </GraphActionsContext.Provider>
  );
```

(Add `relative` to the wrapper div — Task 4 anchors the palette popover inside it. Keep everything else in the `<ReactFlow>` unchanged.)

- [ ] **Step 4: Wire the four handlers + pass `actions` in `web/src/graph/GraphEditor.tsx`**

(a) Add imports:

```tsx
import { deleteNode, duplicateNode, toggleDisabled } from "./edit";
import type { GraphActions } from "./GraphActions";
```

(b) Build the actions object (place after `updateCurrent`, before the `inputCls` line). Use `useMemo` so the context value is stable; `setNodes`/`setEdges`/`setSelId` are stable setters:

```tsx
  const actions: GraphActions = useMemo(
    () => ({
      editable: edit,
      onInspect: (id) => setSelId(id),
      onDisable: (id) => setNodes((ns) => toggleDisabled(ns, id)),
      onDuplicate: (id) =>
        setNodes((ns) => {
          const out = duplicateNode(ns, id);
          if (out.newId) setSelId(out.newId);
          return out.nodes;
        }),
      onDelete: (id) =>
        setNodes((ns) => {
          setEdges((es) => deleteNode(ns, es, id).edges);
          setSelId((cur) => (cur === id ? null : cur));
          return deleteNode(ns, es_unused(), id).nodes; // replaced below
        }),
      // add/insert wired in Task 4:
      onRequestAdd: () => {},
      onRequestInsert: () => {},
    }),
    [edit],
  );
```

**IMPORTANT — implement `onDelete` cleanly** (the snippet above is illustrative; do NOT use `es_unused`). Because deleting must update BOTH nodes and edges atomically and `deleteNode` needs both, use the current state via the functional updaters without cross-reading. Write it as:

```tsx
      onDelete: (id) => {
        setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
        setNodes((ns) => ns.filter((n) => n.id !== id));
        setSelId((cur) => (cur === id ? null : cur));
      },
```

(That is exactly `deleteNode`'s two filters inlined across the two setters — keeping each setter pure. `deleteNode` itself stays unit-tested for callers that have both arrays at hand.) Import `useMemo` (already imported in GraphEditor — it's used for `toolCount`).

(c) Pass `actions` to `<GraphCanvas … actions={actions} />` (add the prop to the existing `<GraphCanvas …/>` usage).

(d) **Remove the old sidebar add-step buttons + `addStep`/`counter`** — delete the `function addStep(...)` and the `const counter = useRef(0);`, and remove the edit-mode `<div className="space-y-1">…+ agent.run…+ tool.call…</div>` block in the sidebar (Levels 3–4 replace it). Leave the rest of the edit-mode sidebar (the `step` inspector) intact. (`useRef` may become unused — drop it from the React import if so.)

- [ ] **Step 5: Update `web/src/graph/GraphEditor.test.tsx`** — the existing "toggles edit mode" test asserts a `+ agent.run` button that no longer exists. Change that test to assert only the local-changes banner (the add UX is now the canvas `+`/palette, covered by e2e):

Replace the body of the `it("toggles edit mode ...")` test's assertions:

```tsx
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByText(/changes are local/i)).toBeInTheDocument();
```

(Remove the `expect(screen.getByRole("button", { name: /\+ agent\.run/i }))…` line. Keep the rest.)

- [ ] **Step 6: Typecheck + run graph tests** — `cd web && pnpm typecheck && pnpm test -- src/graph/` → green (edit/palette/layout tests + the two GraphEditor tests; GraphCanvas is mocked in GraphEditor.test so the toolbar isn't exercised in jsdom).

- [ ] **Step 7: Commit**

```bash
git add web/src/graph/GraphActions.tsx web/src/graph/StepNode.tsx web/src/graph/GraphCanvas.tsx web/src/graph/GraphEditor.tsx web/src/graph/GraphEditor.test.tsx
git commit -m "feat(web): per-node hover toolbar (inspect/disable/duplicate/delete)"
```

---

## Task 4: Inline `+` add + custom edge insert + palette wiring

**Files:** Create `web/src/graph/StepEdge.tsx`; Modify `web/src/graph/StepNode.tsx`, `web/src/graph/GraphCanvas.tsx`, `web/src/graph/GraphEditor.tsx`.

Context: a `+` on a node (edit mode) opens the palette anchored at the click; the palette pick calls `addNextStep`. A custom edge renders a midpoint `+` opening the palette for `insertStepOnEdge`. The palette renders as an absolutely-positioned popover inside the canvas wrapper (which Task 3 made `relative`). The `at` coords passed to `onRequestAdd/onRequestInsert` are the click's `clientX/clientY`; `GraphEditor` converts them to wrapper-relative using the wrapper's `getBoundingClientRect()`.

- [ ] **Step 1: Add an inline `+` to `web/src/graph/StepNode.tsx`** (edit mode only)

Inside the node `<div>`, right before the closing source `<Handle …/>`, add a `+` button shown when `actions.editable`:

```tsx
        {actions.editable && (
          <button
            type="button"
            title="add next step"
            aria-label="add next step"
            onClick={(ev) => {
              ev.stopPropagation();
              actions.onRequestAdd(id, { x: ev.clientX, y: ev.clientY });
            }}
            className="absolute -right-3 top-1/2 z-10 -mt-2.5 flex h-5 w-5 items-center justify-center rounded-full border border-accent bg-surface text-xs font-bold text-accent"
          >
            +
          </button>
        )}
```

(The node `<div>` already needs `relative` for the absolute `+`; add `relative` to its className if not present — the Plan 3a node uses `flex … `; add `relative`.)

- [ ] **Step 2: Create the custom edge `web/src/graph/StepEdge.tsx`**

```tsx
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { useGraphActions } from "./GraphActions";

export function StepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const actions = useGraphActions();
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      {actions.editable && (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="insert step here"
            aria-label="insert step"
            onClick={(ev) => {
              ev.stopPropagation();
              actions.onRequestInsert(id, { x: ev.clientX, y: ev.clientY });
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full border border-accent bg-surface text-xs font-bold text-accent"
          >
            +
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
```

- [ ] **Step 3: Register the edge type in `web/src/graph/GraphCanvas.tsx`**

(a) Import `StepEdge`: `import { StepEdge } from "./StepEdge";`
(b) Add `const edgeTypes = { step: StepEdge };` next to `const nodeTypes = { step: StepNode };`.
(c) Pass `edgeTypes={edgeTypes}` on the `<ReactFlow … />` element (alongside `nodeTypes={nodeTypes}`).

- [ ] **Step 4: Wire the palette + add/insert handlers in `web/src/graph/GraphEditor.tsx`**

(a) Add imports:

```tsx
import { useRef } from "react";
import { addNextStep, insertStepOnEdge, type StepPick } from "./edit";
import { StepPalette } from "./StepPalette";
import { listAgents } from "../api/agents";
```

(Merge `useRef` into the existing `react` import; merge `addNextStep`/`insertStepOnEdge`/`StepPick` into the existing `./edit` import from Task 3.)

(b) Add state: an agents list, a wrapper ref, and the palette descriptor. Place near the other `useState`s:

```tsx
  const [agents, setAgents] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<
    { mode: "add" | "insert"; anchorId: string; x: number; y: number } | null
  >(null);

  useEffect(() => {
    listAgents()
      .then((as) => setAgents(as.map((a) => a.id)))
      .catch(() => {});
  }, []);
```

(c) In the `actions` object (from Task 3), implement `onRequestAdd`/`onRequestInsert` to open the palette at wrapper-relative coords:

```tsx
      onRequestAdd: (fromId, at) => {
        const r = wrapRef.current?.getBoundingClientRect();
        setPalette({ mode: "add", anchorId: fromId, x: at.x - (r?.left ?? 0), y: at.y - (r?.top ?? 0) });
      },
      onRequestInsert: (edgeId, at) => {
        const r = wrapRef.current?.getBoundingClientRect();
        setPalette({ mode: "insert", anchorId: edgeId, x: at.x - (r?.left ?? 0), y: at.y - (r?.top ?? 0) });
      },
```

Add `recommended` and `agents` are not needed in the `useMemo` deps for these (they read live state via closures only for `recommended`); include `recommended` in the deps array since `onPick` below uses it. Actually the pick handler lives outside `actions` — see (d). Keep `actions` deps `[edit]` plus add nothing here.

(d) Add the pick handler + render the palette. Add this function near `updateCurrent`:

```tsx
  function onPickStep(pick: StepPick) {
    if (!palette) return;
    if (palette.mode === "add") {
      setNodes((ns) => {
        setEdges((es) => addNextStep(ns, es, palette.anchorId, pick, recommended).edges);
        return addNextStep(ns, edges, palette.anchorId, pick, recommended).nodes;
      });
    } else {
      setNodes((ns) => {
        setEdges((es) => insertStepOnEdge(ns, es, palette.anchorId, pick, recommended).edges);
        return insertStepOnEdge(ns, edges, palette.anchorId, pick, recommended).nodes;
      });
    }
    setPalette(null);
  }
```

**IMPORTANT — avoid the stale-`edges` closure:** the snippet above reads `edges` from the outer closure for the nodes branch, which can be stale. Implement it by computing the new graph ONCE from current state and applying both setters. Cleaner version to use:

```tsx
  function onPickStep(pick: StepPick) {
    if (!palette) return;
    setNodes((ns) => {
      setEdges((es) => {
        const out =
          palette.mode === "add"
            ? addNextStep(ns, es, palette.anchorId, pick, recommended)
            : insertStepOnEdge(ns, es, palette.anchorId, pick, recommended);
        // stash the computed nodes for the outer setter via a ref-free trick:
        pendingNodes = out.nodes;
        return out.edges;
      });
      return pendingNodes ?? ns;
    });
    setPalette(null);
  }
```

The cross-setter stash is awkward. **Use this clean approach instead** (compute from a single source of truth by reading current state with the functional `setNodes`, and derive edges inside the same pass via a local). Since React batches, the simplest correct implementation reads both arrays from a single `setNodes` updater that ALSO schedules the edges update using the same `ns` plus the latest `edges` captured by reading a ref. To keep it simple and correct, store edges in a ref mirror:

Add near the state: `const edgesRef = useRef<Edge[]>([]); useEffect(() => { edgesRef.current = edges; }, [edges]);`

Then:

```tsx
  function onPickStep(pick: StepPick) {
    if (!palette) return;
    const cur = { nodes, edges: edgesRef.current };
    const out =
      palette.mode === "add"
        ? addNextStep(cur.nodes, cur.edges, palette.anchorId, pick, recommended)
        : insertStepOnEdge(cur.nodes, cur.edges, palette.anchorId, pick, recommended);
    setNodes(out.nodes);
    setEdges(out.edges);
    setPalette(null);
  }
```

(`nodes` is already current in render scope; `edgesRef` mirrors the latest edges. This computes one new graph and applies both setters — no stale closure, no cross-setter stash.)

(e) Wrap the canvas + palette in the `wrapRef` container and render the palette popover. Change the `<GraphCanvas … />` usage to be wrapped:

```tsx
        <div ref={wrapRef} className="relative">
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            editable={edit}
            actions={actions}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelect={setSelId}
          />
          {palette && (
            <div
              className="absolute z-20"
              style={{ left: palette.x, top: palette.y }}
            >
              <StepPalette agents={agents} onPick={onPickStep} onClose={() => setPalette(null)} />
            </div>
          )}
        </div>
```

(Keep the existing grid layout; this replaces the bare `<GraphCanvas … />` in the left grid cell. `Edge` type is already imported in GraphEditor.)

- [ ] **Step 5: Typecheck + run graph tests** — `cd web && pnpm typecheck && pnpm test -- src/graph/` → green (jsdom still mocks GraphCanvas, so the inline `+`/edge/palette popover are exercised by e2e, not here; the unit suites for edit/palette cover the logic).

- [ ] **Step 6: Commit**

```bash
git add web/src/graph/StepEdge.tsx web/src/graph/StepNode.tsx web/src/graph/GraphCanvas.tsx web/src/graph/GraphEditor.tsx
git commit -m "feat(web): inline + add, edge-insert, and palette wiring"
```

---

## Task 5: E2e + final gate

**Files:** Modify `web/e2e/run.spec.ts`.

- [ ] **Step 1: Read `web/e2e/run.spec.ts`** to match conventions (the Plan 3a workflow-graph test is at the end). React Flow nodes are `.react-flow__node`; edges `.react-flow__edge`. Append a new top-level `test(...)`.

- [ ] **Step 2: Append the e2e spec** — drive edit mode, add a step via the inline `+` → palette, and assert the node count grows + Save stays gated:

```ts
test("workflows: edit mode adds a step via the inline + and palette", async ({ page }) => {
  await page.goto("/projects/demo/workflows");
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 5000 });
  const before = await page.locator(".react-flow__node").count();
  // enter edit mode
  await page.getByRole("button", { name: /^edit$/i }).click();
  // hover the first node to reveal its inline "+", then click it
  const node = page.locator(".react-flow__node").first();
  await node.hover();
  await node.getByRole("button", { name: "add next step" }).click();
  // the searchable palette opens; pick agent.run
  await expect(page.getByRole("dialog", { name: "add step" })).toBeVisible();
  await page.getByRole("button", { name: "agent.run" }).click();
  // a node was added
  await expect(page.locator(".react-flow__node")).toHaveCount(before + 1);
  // Save → IR stays gated
  await expect(page.getByRole("button", { name: /build from ir/i })).toBeDisabled();
});
```

(If revealing the inline `+` on `hover` is flaky because the node must also be selected for some styles, click the node first (`await node.click()`) then the `+`. The `+` button itself is always rendered in edit mode — `hover`/`click` only matters for visual reveal, not DOM presence — so `node.getByRole("button", { name: "add next step" }).click()` should work without the hover; keep the hover as a best-effort.)

- [ ] **Step 3: Kill stale servers, rebuild, run e2e**

```bash
lsof -nP -iTCP:4317 -iTCP:5173 -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null; sleep 1
cargo build -p tau-gateway -p fake-tau-serve
cd web && pnpm exec playwright test
```
Expected: ALL pass. `web/playwright.config.ts` auto-starts the servers (`reuseExistingServer: !CI`). Real ASSERTION failure → STOP, report BLOCKED with the failing assertion. Missing-browser → `pnpm exec playwright install chromium` then retry; if not permitted, `pnpm exec playwright test --list` to confirm parse and note e2e deferred to CI, then proceed with Steps 4–6 (unit gate must be green).

- [ ] **Step 4: Restore fixtures**

```bash
cd /Users/titouanlebocq/code/tau-ui
git checkout fixtures/demo/tau.toml docs/verification/trace-complete.png 2>/dev/null
git clean -fd fixtures/demo/skills >/dev/null 2>&1; git checkout fixtures/demo/skills 2>/dev/null
git status --porcelain fixtures/demo   # must be empty
true
```

- [ ] **Step 5: Full web gate** — `cd /Users/titouanlebocq/code/tau-ui/web && pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` → green (run `pnpm format` if format:check fails, and include the formatted files in the commit). **Note (from the per-task-gate memory):** run `pnpm format` proactively — earlier tasks' new files (`edit.test.ts`, `StepPalette.test.tsx`, etc.) may not be prettier-clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/titouanlebocq/code/tau-ui
git add web/e2e/run.spec.ts
# include any prettier-formatted source (check git status)
git commit -m "test(web): e2e edit-mode add step via inline + and palette"
```

---

## Self-Review

**Spec coverage** (the edit interactions of B in §4.3 Levels 2–4):
- Level 2 hover toolbar — `<NodeToolbar>` with inspect (always) + disable/duplicate/delete (edit mode), via the `GraphActions` context → Task 3. ✓
- Level 3 inline add — `+` on a node calls `addNextStep`; `+` on a custom `StepEdge` calls `insertStepOnEdge`; pure helpers in `edit.ts` → Tasks 1 (logic) + 4 (wiring). ✓
- Level 4 palette — `StepPalette` searchable picker (agent.run / tool.call / agent by name) opened from any `+` → Tasks 2 (component) + 4 (wiring). ✓
- Helpers are pure + unit-tested; the live canvas is e2e-tested → Tasks 1, 2, 5. ✓
- Edits local-only, Save → IR gated (asserted disabled in the e2e). ✓
- Carry-over from 3a review: new `agent.run` nodes re-resolve `provider` to the recommended backend (`buildStepNode`). ✓

**Placeholder scan:** none. (Task 4 Step 4 deliberately shows a wrong-then-right `onPickStep`/`onDelete` to steer the implementer to the clean version — the FINAL code to write is the last block in each case.)

**Type consistency:** `StepPick { kind: "agent.run" | "tool.call"; agent?: string | null }` is shared by `edit.ts`, `StepPalette`, and `GraphEditor.onPickStep`. The helpers operate on `Node<StepNodeData>[]`/`Edge[]` and return the same. `StepNodeData` gains optional `disabled?: boolean`; `X_GAP` is exported from `layout.ts`. The `GraphActions` context interface (defined in Task 3, extended-in-place in Task 4) is consumed by `StepNode` + `StepEdge` and provided by `GraphCanvas` from `GraphEditor`'s `actions`. Edges now carry `type: "step"` (layout + helpers) matching `edgeTypes = { step: StepEdge }`.

**Read/write boundary:** all mutations are local React state; no API writes; the gated "Build from IR" button is untouched. `getProviders` (recommended) + `listAgents` (palette) are the only new reads, both from existing Plan-1 endpoints.

**After this plan:** sub-project B (the n8n-grade canvas) is complete across both halves. The spec roadmap then goes to **credentials handling** (the explicit next sub-project — the gated "Set API key" seam), then **C** (non-determinism representation).
