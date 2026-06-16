# Workflow Canvas Layout Upgrade — full-bleed canvas, overlay inspector, ELK edge routing

**Date:** 2026-06-16
**Status:** Design — pending user review.
**Scope:** Upgrade the Workflows **Compiled IR** canvas (`web/src/graph/`) so it (1) fills the
available height/width, (2) inspects nodes via an overlay drawer, and (3) lays out nodes and
routes edges with a real layout engine (ELK) so edges never cross nodes and the retry/feedback
edge routes cleanly around the node band. Builds on the shipped deliverables/goals canvas (PR #60).

## Why

The shipped check overlay exposed two canvas weaknesses:
- The hand-rolled depth layout (`workflowToFlow`) positions nodes but **does not route edges**, and
  React Flow has **no built-in obstacle avoidance** ([RF layouting](https://reactflow.dev/learn/layouting/layouting)).
  Result: the injected `check` node collided with `write_file`, and the rewind edge passes under nodes.
- The canvas is a fixed `h-[420px]` box with a cramped 190px inspector column.

The community-recommended fix for both is a layered layout engine that assigns positions **and**
routes edges through inter-layer channels, with explicit feedback-edge handling for the back-edge.

## Decisions (with rationale)

### D1 — Canvas fills available space
`AppShell`'s `<main>` already provides a definite height (`flex-1` inside an `h-screen` column).
`GraphEditor` changes from `space-y-3 p-4` (natural height, scrolls) to **`flex h-full flex-col`**:
a fixed top toolbar row, then a **`flex min-h-0 flex-1`** body. `GraphCanvas`'s container changes
`h-[420px]` → **`h-full w-full`** so React Flow fills its cell. The canvas goes edge-to-edge (page
padding removed for this view only).

### D2 — Overlay-drawer inspector
The node inspector is no longer a persistent grid column. The canvas spans the full width; when a
node is selected, an **overlay drawer** (~220px, absolutely positioned over the right edge, full
height, internal scroll, subtle shadow/backdrop) slides in. It closes on **deselect or Esc**. This
maximizes canvas area and matches node-editor conventions. The drawer hosts the existing inspector
content (step details / edit fields) and the check-node verdict where applicable.

### D3 — ELK layered auto-layout for the Compiled IR view
Adopt **`elkjs`** ([RF + ELK example](https://reactflow.dev/examples/layout/elkjs-multiple-handles)).
The compiled flow is laid out with `elk.layered`:
- `elk.direction: "RIGHT"` (left-to-right DAG).
- `org.eclipse.elk.layered.feedbackEdges: true` — **routes the retry/feedback edge around the
  nodes** instead of under them ([ELK feedbackEdges](https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-feedbackEdges.html)).
- `org.eclipse.elk.layered.cycleBreaking.strategy: "GREEDY"` so the rewind edge is identified as the
  back-edge ([ELK layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)).
- Spacing: `elk.layered.spacing.nodeNodeBetweenLayers`, `elk.spacing.nodeNode`,
  `spacing.edgeNodeBetweenLayers` tuned to keep routing channels open.

ELK replaces `workflowToFlow`'s positions **for the compiled view only**. The **source view keeps
`workflowToFlow`** (it has no checks and no overlap problem) — bounding the blast radius. ELK runs
**async**; layout is computed in an effect and the positioned nodes/edges held in state, with a brief
"laying out…" state on first compute.

Checks are fed to ELK as **first-class nodes**: the combined graph = IR nodes + deliverable `check`
nodes + forward edges (`producer → check`) + the `rewind` edge (`check → gate`, marked as the
feedback edge). Goal badges remain node attributes (not nodes). This supersedes the manual
`projectChecks` positioning — `projectChecks` now contributes nodes/edges to the ELK input graph and
applies goal badges, but does **not** assign coordinates.

### D4 — Edge styling (locked; applies regardless of engine)
- **Forward edges:** orthogonal **`smoothstep`**, thin neutral stroke at ≥3:1 contrast on the dark
  canvas, **`MarkerType.ArrowClosed`** sized with `markerUnits="strokeWidth"` so heads scale to the line.
- **Retry/feedback edge (chosen rendering):** ELK owns **node positions** (with `feedbackEdges:true`
  so the back-edge is accounted for during layering/spacing); the edge itself is **rendered by React
  Flow** from a dedicated **bottom** source/target handle pair on the `check` and producer nodes, as an
  orthogonal `smoothstep` path — so it arcs **around/under the node band**, never through a node. (We do
  *not* consume ELK's per-edge bend-point sections — node positions + bottom-handle routing is simpler
  and avoids coupling the renderer to ELK's edge-section output.) Encoded by **color + dash + label**
  (amber, dashed, midpoint **`↻ retry ×N`** pill with an opaque background) — never color alone
  (WCAG 1.4.1, [Carbon dataviz](https://medium.com/carbondesign/color-palettes-and-accessibility-features-for-data-visualization-7869f4874fca)).
- **Hover / selection:** highlight the focused edge pair, **dim** the rest (extends the existing
  `applyChecksSelection` dimming + RF edge hover) ([NN/g visual complexity](https://www.nngroup.com/videos/managing-visual-complexity/)).

## Components & boundaries

| Unit | File | Responsibility |
|---|---|---|
| ELK layout | `web/src/graph/elkLayout.ts` (new) | Async: take a `WorkflowGraph` (+ which edges are feedback) → return React Flow `Node[]`/`Edge[]` with ELK-assigned **positions** (`feedbackEdges:true` enabled so the back-edge is accounted for during layering). Edges are passed through for React Flow to render; ELK per-edge bend points are not consumed. One clear input/output; no React. |
| Check graph assembly | `web/src/graph/layout.ts` (`projectChecks`) | Build the combined node/edge set (IR + check nodes + forward/rewind edges) + goal badges. No coordinates (ELK owns those). `applyChecksSelection` stays (dimming). |
| Compiled-view wiring | `web/src/graph/GraphEditor.tsx` | Run ELK async in an effect for the compiled view; hold positioned flow in state; full-bleed flex layout; overlay-drawer state + Esc handling. |
| Canvas shell | `web/src/graph/GraphCanvas.tsx` | `h-full w-full`; orthogonal default edge type; ArrowClosed marker defaults. |
| Rewind edge | `web/src/graph/RewindEdge.tsx` | Orthogonal path (ELK bend points or bottom-handle routing) + scaled arrowhead + pill label + dim state. |
| Check/Step nodes | `CheckNode.tsx` / `StepNode.tsx` | Add a **bottom** handle for feedback routing; otherwise unchanged. |

## Testing

- `elkLayout`: given a small graph with a feedback edge, returns distinct non-overlapping positions
  for every node and includes the feedback edge in output. ELK runs in-thread in tests
  (`new ELK()` without a worker URL); verify it resolves under jsdom/vitest.
- `projectChecks`: still emits the check node + forward + rewind edges + goal badges, now **without**
  asserting coordinates (ELK assigns them).
- `RewindEdge`: renders an orthogonal path + `↻ retry ×N` label + dim state.
- `GraphEditor`: overlay drawer opens on node select and closes on deselect/Esc; canvas is `h-full`.
- Markers: forward edges use `ArrowClosed`.
- Run `prettier`/`eslint`/`tsc` each task (per memory `per-task-gate-skips-format-check`); tests via
  `./node_modules/.bin/vitest` in the conductor worktree.

## Dependencies
- Add **`elkjs`** to `web/package.json`. (Pure JS; no native build.) Confirm bundle size is acceptable
  in `vite build`.

## Out of scope
- Migrating the **source** view to ELK (future; it has no overlap problem today).
- Persisting manual node drags / re-layout-on-edit.
- Multi-deliverable / multi-gate stress layouts beyond what ELK gives for free.

## Resolved decisions
- Inspector = **overlay drawer** (D2). Layout engine = **ELK** (D3). Overlap fix = checks as
  first-class ELK nodes (supersedes manual `projectChecks` placement). Edge styling = D4 (locked).
