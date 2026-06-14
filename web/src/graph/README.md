# Graph editor (surface ①)

Built in this directory: the Workflow graph editor (gated β.2). See
`docs/superpowers/specs/2026-06-02-workflow-graph-editor-design.md`.

- `GraphEditor.tsx` — view-by-default editor (workflow picker, View↔Edit toggle,
  node inspector, add-step palette, Source↔Compiled IR toggle, interim Build button).
- `GraphCanvas.tsx` + `StepNode.tsx` — the `@xyflow/react` canvas, shared in spirit
  with `trace/AgentMapView.tsx`; edit mode only differs by enabling drag/connect/add.
- `layout.ts` — pure `workflowToFlow` + `irToFlow` (deterministic DAG layout).

Graph data is mock-first via the gateway `WorkflowGraphSource` seam
(`gateway/src/graph/mod.rs`); `GET /api/projects/:pid/workflows/:name/graph`.

## Still deferred

- **Edits don't persist.** Edit mode mutates local React state only; saving the
  edited graph back to `workflows/*.toml` (graph→TOML round-trip) is a separate
  authoring track.
- **Compiled-IR render is gated on tau.** The Source↔Compiled IR toggle renders the
  project IR via the gateway `IrSource` seam (`GET /api/projects/:pid/ir`, shelling
  `tau ir inspect --json`); it runs against `MockIr` until that tau verb ships, after
  which the `gated` badge is removed (Phase 2). The interim Build button already
  compiles and reports a reproducibility hash via the existing ship endpoint.
