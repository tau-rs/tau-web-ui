# Workflow Canvas Layout Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Workflows Compiled-IR canvas fill the viewport, inspect nodes via an overlay drawer, and lay out nodes + route edges with ELK so edges never cross nodes and the retry edge routes around the node band.

**Architecture:** Add `elkjs` and an async `elkLayout` helper that assigns node positions (with `feedbackEdges`/cycle-breaking so the back-edge is accounted for). `projectChecks` stops assigning coordinates and instead contributes check nodes + a feedback (`rewind`) edge wired to dedicated **bottom** handles. The compiled view computes layout asynchronously in an effect and holds the positioned flow in state. Forward edges become orthogonal `smoothstep` with `ArrowClosed` markers; the rewind edge renders orthogonally from bottom handles with a pill label. The page becomes a full-height flex column with an overlay inspector drawer.

**Tech Stack:** React 19, TypeScript, `@xyflow/react` v12, `elkjs`, Vitest + Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-16-workflow-canvas-layout-upgrade-design.md`. Read it first.

---

## Conventions (every task)

- Tests (conductor worktree): `cd web && ./node_modules/.bin/vitest run src/<path>` (node_modules already installed; use `pnpm`, not `npm`, if you must install).
- Per-task gate: `cd web && ./node_modules/.bin/prettier --write <files> && ./node_modules/.bin/eslint <files> && npx tsc --noEmit`.
- Commits: conventional `feat(web):` / `refactor(web):`, end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Commit only at the end of each task.
- Scope: **Compiled IR view only**. Do NOT change the source-view layout path.

## File structure

| File | Change |
|---|---|
| `web/package.json` | add `elkjs` dependency |
| `web/src/graph/elkLayout.ts` (new) | async ELK layout → positioned `Node[]`; injectable ELK for tests |
| `web/src/graph/layout.ts` (`projectChecks`) | stop assigning coordinates; wire rewind edge to bottom handles (`sourceHandle`/`targetHandle = "rw"`) |
| `web/src/graph/CheckNode.tsx` | add bottom **source** handle `id="rw"` |
| `web/src/graph/StepNode.tsx` | add bottom **target** handle `id="rw"` |
| `web/src/graph/RewindEdge.tsx` | orthogonal `smoothstep` path + scaled `ArrowClosed` + pill label + dim |
| `web/src/graph/StepEdge.tsx` | bezier → `smoothstep` (orthogonal) |
| `web/src/graph/GraphCanvas.tsx` | `h-full w-full`; `defaultEdgeOptions` with `ArrowClosed` marker |
| `web/src/graph/GraphEditor.tsx` | async ELK for compiled view (state + effect); full-bleed flex layout; overlay inspector drawer + Esc |

---

### Task 1: Add elkjs + `elkLayout` helper

**Files:**
- Modify: `web/package.json`
- Create: `web/src/graph/elkLayout.ts`, `web/src/graph/elkLayout.test.ts`

- [ ] **Step 1: Install elkjs**

Run: `cd web && pnpm add elkjs`
Expected: `elkjs` appears under `dependencies` in `web/package.json`; lockfile updated.

- [ ] **Step 2: Write the failing test** (`web/src/graph/elkLayout.test.ts`) — uses an injected fake ELK so it does not depend on ELK running under jsdom:

```ts
import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { elkLayout } from "./elkLayout";

const fakeElk = {
  layout: async (g: { children: { id: string }[] }) => ({
    children: g.children.map((c, i) => ({ id: c.id, x: i * 200, y: 0 })),
  }),
};

describe("elkLayout", () => {
  it("maps ELK-assigned positions back onto the nodes", async () => {
    const nodes = [
      { id: "a", type: "step", position: { x: 0, y: 0 }, data: {} },
      { id: "b", type: "step", position: { x: 0, y: 0 }, data: {} },
    ] as unknown as Node[];
    const edges = [{ id: "a->b", source: "a", target: "b" }] as unknown as Edge[];
    const out = await elkLayout(nodes, edges, fakeElk);
    expect(out.find((n) => n.id === "a")!.position.x).toBe(0);
    expect(out.find((n) => n.id === "b")!.position.x).toBe(200);
  });

  it("preserves a node's prior position when ELK returns none", async () => {
    const elk = { layout: async () => ({ children: [] }) };
    const nodes = [{ id: "a", type: "step", position: { x: 9, y: 9 }, data: {} }] as unknown as Node[];
    const out = await elkLayout(nodes, [], elk);
    expect(out[0].position).toEqual({ x: 9, y: 9 });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/elkLayout.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `web/src/graph/elkLayout.ts`**

```ts
import ELKConstructor from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";

/** Minimal shape of the ELK instance we use — lets tests inject a fake. */
export interface ElkLike {
  layout(graph: unknown): Promise<{ children?: { id: string; x?: number; y?: number }[] }>;
}

const NODE_W = 172;
const NODE_H = 52;

const LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  // route the retry/back-edge around the node band instead of under nodes
  "elk.layered.feedbackEdges": "true",
  "elk.layered.cycleBreaking.strategy": "GREEDY",
  "elk.layered.spacing.nodeNodeBetweenLayers": "90",
  "elk.spacing.nodeNode": "44",
  "elk.layered.spacing.edgeNodeBetweenLayers": "30",
};

/**
 * Assign positions to `nodes` with ELK's layered algorithm. Edges (including the
 * cyclic rewind edge) inform layering/spacing; ELK detects the back-edge via
 * cycle-breaking + feedbackEdges. Returns a new array; inputs are not mutated.
 * `elk` is injectable for deterministic tests.
 */
export async function elkLayout(
  nodes: Node[],
  edges: Edge[],
  elk: ElkLike = new ELKConstructor() as unknown as ElkLike,
): Promise<Node[]> {
  const graph = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: nodes.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };
  const res = await elk.layout(graph);
  const pos = new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/elkLayout.test.ts`
Expected: PASS (2 tests). If TS complains about the default-import of `elk.bundled.js`, ensure `"esModuleInterop"`/`"allowSyntheticDefaultImports"` is already on (it is for this Vite project); the `as unknown as ElkLike` cast covers the loose ELK types.

- [ ] **Step 6: Gate**

Run: `cd web && ./node_modules/.bin/prettier --write src/graph/elkLayout.ts src/graph/elkLayout.test.ts && ./node_modules/.bin/eslint src/graph/elkLayout.ts src/graph/elkLayout.test.ts && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou
git add web/package.json web/pnpm-lock.yaml web/src/graph/elkLayout.ts web/src/graph/elkLayout.test.ts
git commit -m "feat(web): add elkjs and async elkLayout helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `projectChecks` — drop coordinates, wire rewind edge to bottom handles

**Files:**
- Modify: `web/src/graph/layout.ts` (`projectChecks`)
- Modify: `web/src/graph/layout.checks.test.ts`

- [ ] **Step 1: Update the test** so it no longer assumes coordinates and asserts the rewind edge targets bottom handles. Replace the first test body in `layout.checks.test.ts` (`"adds a check node …"`) with:

```ts
  it("adds a check node (no fixed coords), a goal badge, and a bottom-handle rewind edge", () => {
    const { nodes, edges } = projectChecks(baseNodes(), [], {
      checks: RESEARCH_CHECKS, build: RESEARCH_BUILD, producerOf: PRODUCER_OF,
    }, RUN_RETRY_MET);
    const checkNode = nodes.find((n) => n.id === "check-report")!;
    expect(checkNode.type).toBe("check");
    expect(checkNode.data.runStatus).toBe("met");
    expect(checkNode.data.attemptCount).toBe(2);
    const writer = nodes.find((n) => n.id === "writer")!;
    expect(writer.data.goalBadges?.[0].id).toBe("has_sources");
    const rewind = edges.find((e) => e.type === "rewind")!;
    expect(rewind.source).toBe("check-report");
    expect(rewind.target).toBe("writer");
    expect(rewind.sourceHandle).toBe("rw");
    expect(rewind.targetHandle).toBe("rw");
  });
```

Keep the existing `applyChecksSelection` test and the `"does not mutate the caller's input nodes"` test unchanged.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/layout.checks.test.ts`
Expected: FAIL (rewind edge has no `sourceHandle`/`targetHandle` yet).

- [ ] **Step 3: Edit `projectChecks` in `web/src/graph/layout.ts`.** In the deliverable branch, change the pushed check node to drop the computed `position` (ELK assigns it; use `{ x: 0, y: 0 }`) and remove the `producerNode`/`x`/`y` calculation. Replace the deliverable-branch body (everything after `if (c.verify.kind === "goal") { … continue; }`) with:

```ts
    // deliverable → node + forward edge + rewind (feedback) edge.
    // Positions are assigned later by ELK; we only declare the graph here.
    const checkId = `check-${c.id}`;
    outNodes.push({
      id: checkId,
      type: "check",
      position: { x: 0, y: 0 },
      connectable: false,
      data: {
        label: c.id,
        kind: "check.deliverable",
        agent: null,
        tool: null,
        input: null,
        provider: null,
        tools: [],
        checkKind: "deliverable",
        buildError: build?.status === "error" ? build.message : undefined,
        runStatus: run ? run.final : null,
        attemptCount: run?.attempts.length,
      },
    });
    outEdges.push({ id: `${producer}->${checkId}`, source: producer, target: checkId, type: "step" });
    outEdges.push({
      id: `${checkId}->${c.retry.gate}`,
      source: checkId,
      target: c.retry.gate,
      type: "rewind",
      sourceHandle: "rw",
      targetHandle: "rw",
      data: { attempts: run?.attempts.length ?? c.retry.max_attempts },
    });
```

Remove the now-unused `X_GAP` import usage **only if** nothing else in `layout.ts` uses it (it is still used by `workflowToFlow` — leave the import). Do not touch `workflowToFlow`/`irToFlow`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/layout.checks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Gate**

Run: `cd web && ./node_modules/.bin/prettier --write src/graph/layout.ts src/graph/layout.checks.test.ts && ./node_modules/.bin/eslint src/graph/layout.ts src/graph/layout.checks.test.ts && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou
git add web/src/graph/layout.ts web/src/graph/layout.checks.test.ts
git commit -m "refactor(web): projectChecks declares graph; ELK owns coords; bottom-handle rewind

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Bottom handles on CheckNode + StepNode

**Files:**
- Modify: `web/src/graph/CheckNode.tsx`, `web/src/graph/StepNode.tsx`

- [ ] **Step 1: CheckNode — add a bottom source handle.** In `web/src/graph/CheckNode.tsx`, the component already imports `Handle, Position`. Immediately before the closing `</div>` of the node card (right after the existing right-side `<Handle type="source" position={Position.Right} … />`), add:

```tsx
        <Handle type="source" position={Position.Bottom} id="rw" className={handle} isConnectable={false} />
```

- [ ] **Step 2: StepNode — add a bottom target handle.** In `web/src/graph/StepNode.tsx`, after the existing right-side `<Handle type="source" position={Position.Right} className={handle} />` (the last handle in the card), add:

```tsx
        <Handle type="target" position={Position.Bottom} id="rw" className={handle} />
```

(`handle` is the existing class string in each file. `Position` is already imported in both.)

- [ ] **Step 3: Verify no regressions in graph tests**

Run: `cd web && ./node_modules/.bin/vitest run src/graph`
Expected: PASS (existing graph tests unaffected — adding handles doesn't change assertions).

- [ ] **Step 4: Gate**

Run: `cd web && ./node_modules/.bin/prettier --write src/graph/CheckNode.tsx src/graph/StepNode.tsx && ./node_modules/.bin/eslint src/graph/CheckNode.tsx src/graph/StepNode.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou
git add web/src/graph/CheckNode.tsx web/src/graph/StepNode.tsx
git commit -m "feat(web): add bottom 'rw' handles for the rewind edge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: RewindEdge — orthogonal path, scaled arrowhead, pill label

**Files:**
- Modify: `web/src/graph/RewindEdge.tsx`
- Create: `web/src/graph/RewindEdge.test.tsx`

- [ ] **Step 1: Write the failing test** (`web/src/graph/RewindEdge.test.tsx`):

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlow, type Edge, type Node } from "@xyflow/react";
import { RewindEdge } from "./RewindEdge";

// RewindEdge reads edge geometry from React Flow context; render it inside a
// minimal flow with two nodes and one rewind edge.
const nodes: Node[] = [
  { id: "a", position: { x: 0, y: 0 }, data: {} },
  { id: "b", position: { x: 0, y: 160 }, data: {} },
];
const edges: Edge[] = [
  { id: "b->a", source: "b", target: "a", type: "rewind", data: { attempts: 2 } },
];

describe("RewindEdge", () => {
  it("renders the retry label with the attempt count", () => {
    render(
      <div style={{ width: 400, height: 300 }}>
        <ReactFlow nodes={nodes} edges={edges} edgeTypes={{ rewind: RewindEdge }} fitView />
      </div>,
    );
    expect(screen.getByText(/↻ retry ×2/)).toBeInTheDocument();
  });
});
```

(If the existing `GraphCanvas.checks.test.tsx` needed a `ResizeObserver` mock for React Flow under jsdom, add the same `beforeAll` ResizeObserver shim here — copy it from that file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/RewindEdge.test.tsx`
Expected: FAIL — current `RewindEdge` uses a Bezier path; the label text `↻ retry ×2` should actually still render with the current component, so if this passes immediately, proceed (the behavioral change is the path shape). To make the test meaningfully drive the change, ALSO assert the path is orthogonal in Step 1 by checking the rendered `<path>`'s `d` contains an `L`/`H`/`V` command rather than only `C`: add
`const path = document.querySelector("path.react-flow__edge-path, path[stroke]"); expect(path?.getAttribute("d") ?? "").toMatch(/[HVL]/);`
Expected now: FAIL (Bezier `d` has only `C`/`M`).

- [ ] **Step 3: Rewrite `web/src/graph/RewindEdge.tsx`** to use the orthogonal smoothstep path and a stroke-scaled marker:

```tsx
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

export function RewindEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
    offset: 28, // push the orthogonal path well clear of the node band
  });
  const dimmed = (data as { dimmed?: boolean } | undefined)?.dimmed;
  const attempts = (data as { attempts?: number } | undefined)?.attempts ?? 1;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: "#d29922",
          strokeWidth: 2,
          strokeDasharray: "7 4",
          opacity: dimmed ? 0.25 : 1,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
            opacity: dimmed ? 0.25 : 1,
          }}
          className="rounded-full border border-amber-700 bg-amber-100 px-1.5 text-[9px] font-semibold text-amber-800"
        >
          ↻ retry ×{attempts}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/RewindEdge.test.tsx src/graph/GraphCanvas.checks.test.tsx`
Expected: PASS.

- [ ] **Step 5: Gate**

Run: `cd web && ./node_modules/.bin/prettier --write src/graph/RewindEdge.tsx src/graph/RewindEdge.test.tsx && ./node_modules/.bin/eslint src/graph/RewindEdge.tsx src/graph/RewindEdge.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou
git add web/src/graph/RewindEdge.tsx web/src/graph/RewindEdge.test.tsx
git commit -m "feat(web): orthogonal rewind edge with scaled marker + pill label

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Forward edges — orthogonal smoothstep + ArrowClosed markers

**Files:**
- Modify: `web/src/graph/StepEdge.tsx`, `web/src/graph/GraphCanvas.tsx`

- [ ] **Step 1: StepEdge → smoothstep.** In `web/src/graph/StepEdge.tsx`, change the import `getBezierPath` → `getSmoothStepPath` and the call. Replace the `getBezierPath({...})` call with:

```tsx
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
```

and update the import line to `import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";`. Leave the rest of the component (the editable insert button) unchanged.

- [ ] **Step 2: GraphCanvas — default ArrowClosed marker on forward edges.** In `web/src/graph/GraphCanvas.tsx`:
  (a) add `MarkerType` to the `@xyflow/react` import.
  (b) change the canvas container class `h-[420px]` → `h-full` (full-bleed; see Task 6 for the parent). The line currently reads `<div className="relative h-[420px] w-full rounded-md border border-border">`; change to `<div className="relative h-full w-full rounded-md border border-border">`.
  (c) add this prop to `<ReactFlow …>`:

```tsx
          defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }}
```

(The `rewind` edge sets its own style and no marker, so this default only decorates `step` edges.)

- [ ] **Step 3: Run graph tests for no regression**

Run: `cd web && ./node_modules/.bin/vitest run src/graph`
Expected: PASS.

- [ ] **Step 4: Gate**

Run: `cd web && ./node_modules/.bin/prettier --write src/graph/StepEdge.tsx src/graph/GraphCanvas.tsx && ./node_modules/.bin/eslint src/graph/StepEdge.tsx src/graph/GraphCanvas.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou
git add web/src/graph/StepEdge.tsx web/src/graph/GraphCanvas.tsx
git commit -m "feat(web): orthogonal forward edges + ArrowClosed markers; canvas h-full

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: GraphEditor — async ELK layout for the compiled view + full-bleed flex layout

**Files:**
- Modify: `web/src/graph/GraphEditor.tsx`

> Context: today the compiled view derives `irFlow` synchronously via `useMemo(irToFlow…)`, then `projectChecks` → `compiled`, then `applyChecksSelection`. After Task 2, `projectChecks` no longer assigns coordinates, so the compiled view must run ELK to position nodes. This is async.

- [ ] **Step 1: Add imports** near the other graph imports:

```tsx
import { elkLayout } from "./elkLayout";
```

- [ ] **Step 2: Replace the synchronous `compiled`/`compiledEdges` memo with async ELK state.** Find (added in the prior feature) the block:

```tsx
  const compiled = useMemo(
    () => (wfChecks ? projectChecks(irNodes, irEdges, wfChecks, runResults) : { nodes: irNodes, edges: irEdges }),
    [irNodes, irEdges, wfChecks, runResults],
  );
  const compiledEdges = useMemo(() => applyChecksSelection(compiled.edges, selId), [compiled.edges, selId]);
```

Replace it with:

```tsx
  // Compiled view: declare the graph (IR + checks), then let ELK position it (async).
  const declared = useMemo(
    () =>
      wfChecks
        ? projectChecks(irNodes, irEdges, wfChecks, runResults)
        : { nodes: irNodes, edges: irEdges },
    [irNodes, irEdges, wfChecks, runResults],
  );
  const [laidOutNodes, setLaidOutNodes] = useState<Node<StepNodeData>[]>([]);
  const [layingOut, setLayingOut] = useState(false);
  useEffect(() => {
    if (view !== "compiled" || declared.nodes.length === 0) return;
    let alive = true;
    setLayingOut(true);
    elkLayout(declared.nodes, declared.edges)
      .then((ns) => {
        if (alive) setLaidOutNodes(ns as Node<StepNodeData>[]);
      })
      .catch(() => {
        if (alive) setLaidOutNodes(declared.nodes); // fall back to declared positions
      })
      .finally(() => {
        if (alive) setLayingOut(false);
      });
    return () => {
      alive = false;
    };
  }, [view, declared]);
  const compiledEdges = useMemo(
    () => applyChecksSelection(declared.edges, selId),
    [declared.edges, selId],
  );
```

- [ ] **Step 3: Point `activeNodes` and the canvas at the laid-out nodes.** Change:

```tsx
  const activeNodes = view === "compiled" ? compiled.nodes : nodes;
```
to:
```tsx
  const activeNodes = view === "compiled" ? laidOutNodes : nodes;
```
and in the `<GraphCanvas …>` props change the compiled branches:
```tsx
            nodes={view === "compiled" ? laidOutNodes : nodes}
            edges={view === "compiled" ? compiledEdges : edges}
```

- [ ] **Step 4: Full-bleed flex layout.** Change the outer wrapper. The root is currently `<div className="space-y-3 p-4">`. Change it to `<div className="flex h-full flex-col">`. Wrap the existing top toolbar row (`<div className="flex items-center gap-2">…</div>`) so it keeps a little padding: give that toolbar div the extra classes `px-4 pt-3 pb-2`. Then change the body container that holds the canvas + inspector — currently `<div className="grid grid-cols-[1fr_190px] gap-3">` — to `<div ref={wrapRef} className="relative min-h-0 flex-1">` (full-height canvas area; the inspector becomes an overlay in Task 7, so it leaves the grid). Move the `ref={wrapRef}` from the inner canvas `<div>` to this body container, and make the inner canvas wrapper just `<div className="h-full w-full">` (remove its own `relative` if duplicated). The `GraphCanvas` itself is already `h-full` (Task 5).

> After this step the right-hand inspector column JSX still exists but now sits below/!inside the flex-1 area — Task 7 converts it into the overlay drawer. It is acceptable for this single task to temporarily render the inspector full-width below the canvas; the very next task fixes placement. (If you prefer, do Tasks 6 and 7 back-to-back before manual review.)

- [ ] **Step 5: Manual check + no-regression tests**

Run: `cd web && ./node_modules/.bin/vitest run src/graph`
Expected: PASS. Also confirm `npx tsc --noEmit` is clean (the `Node`/`StepNodeData`/`useState`/`useEffect` imports already exist in the file).

- [ ] **Step 6: Gate + Commit**

```bash
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou/web && ./node_modules/.bin/prettier --write src/graph/GraphEditor.tsx && ./node_modules/.bin/eslint src/graph/GraphEditor.tsx && npx tsc --noEmit
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou
git add web/src/graph/GraphEditor.tsx
git commit -m "feat(web): ELK async layout for compiled view; full-bleed canvas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: GraphEditor — overlay inspector drawer

**Files:**
- Modify: `web/src/graph/GraphEditor.tsx`

- [ ] **Step 1: Wrap the inspector JSX in an overlay drawer.** The inspector is the `<div className="space-y-2 text-xs">…</div>` block (node details / edit fields / build-error summary). Wrap it so it renders only when a node is selected (`selId`), absolutely positioned over the right edge of the canvas area:

```tsx
      {selId && (
        <div className="absolute right-0 top-0 z-20 h-full w-[220px] overflow-auto border-l border-border bg-surface/95 p-3 shadow-[-8px_0_24px_#0007] backdrop-blur-sm">
          {/* existing inspector content moves here unchanged */}
        </div>
      )}
```

Place this block as a sibling of `<GraphCanvas>` inside the `flex-1` body container from Task 6 (the container is `relative`, so the drawer anchors to it). Move the **entire** existing inspector `<div className="space-y-2 text-xs">…</div>` content inside this wrapper (replace the comment). The `StepPalette` popover block stays where it is.

- [ ] **Step 2: Close on Escape.** Add an effect (near the other effects):

```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
```

(Deselect-to-close already works: clicking the pane calls `onSelect(null)` → `setSelId(null)`, which unmounts the drawer.)

- [ ] **Step 3: Run + typecheck**

Run: `cd web && ./node_modules/.bin/vitest run src/graph && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 4: Gate + Commit**

```bash
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou/web && ./node_modules/.bin/prettier --write src/graph/GraphEditor.tsx && ./node_modules/.bin/eslint src/graph/GraphEditor.tsx && npx tsc --noEmit
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou
git add web/src/graph/GraphEditor.tsx
git commit -m "feat(web): overlay inspector drawer (open on select, close on Esc/deselect)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Verification gate + manual smoke

**Files:** none.

- [ ] **Step 1: Full suite**

Run: `cd web && ./node_modules/.bin/vitest run`
Expected: all pass.

- [ ] **Step 2: Lint + types + format**

Run: `cd web && ./node_modules/.bin/eslint src && npx tsc --noEmit && ./node_modules/.bin/prettier --check src`
Expected: clean.

- [ ] **Step 3: Bundle check** (elkjs is sizeable — confirm the build still succeeds)

Run: `cd web && pnpm build`
Expected: `vite build` completes without error.

- [ ] **Step 4: Manual smoke** (gateway + dev server already documented). Open the Workflows view → **Compiled IR**: the canvas fills the pane; nodes are ELK-laid-out with no overlap; forward edges are orthogonal with closed arrowheads; the `↻ retry` edge routes around the band (bottom handles); selecting a node opens the right overlay drawer; Esc/click-away closes it.

- [ ] **Step 5: Final commit (if formatting changed)**

```bash
cd /Users/titouanlebocq/conductor/workspaces/tau-ui/hangzhou
git add -A && git commit -m "chore(web): format + verify canvas layout upgrade" || echo "nothing to commit"
```

---

## Self-review notes (author)

- **Spec coverage:** D1 full-bleed (Tasks 5b, 6); D2 overlay drawer + Esc (Task 7); D3 ELK layered for compiled view, checks as first-class nodes, projectChecks no coords, async (Tasks 1, 2, 6); D4 forward smoothstep + ArrowClosed (Task 5), rewind orthogonal bottom-handle + dash + label (Tasks 2, 3, 4), hover/dim via `applyChecksSelection` (already shipped; preserved in Task 6). `elkjs` dependency (Task 1). Source view untouched (no task changes `workflowToFlow`/`irToFlow`/the source branch). All spec sections map to a task.
- **Type consistency:** `elkLayout(nodes, edges, elk?)` signature identical across Task 1 (def) and Task 6 (call). Handle id `"rw"` identical across Task 2 (edge `sourceHandle`/`targetHandle`), Task 3 (handles). `laidOutNodes`/`declared`/`compiledEdges`/`layingOut` names consistent within Task 6/7. Edge types `"step"`/`"rewind"` unchanged from the shipped registry.
- **Flagged for execution:** the ResizeObserver shim (Task 4) — copy from `GraphCanvas.checks.test.tsx` if React Flow needs it under jsdom; and confirm ELK's default-import typing (Task 1 Step 5). Both have inline fallbacks, not placeholders.
- **Known acceptable seam:** Tasks 6→7 briefly leave the inspector mispositioned between commits; noted in Task 6 Step 4. Execute back-to-back.
```
