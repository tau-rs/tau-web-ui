# Graph editor (surface ①) — DEFERRED SEAM

Not built in v1. Home for the Workflow-IR authoring canvas (handoff spec §1.3 / §4).

When tau β.2 Workflow IR (framing D) lands:

- Add `GraphEditor.tsx` reusing the same `@xyflow/react` canvas as `trace/TraceGraph.tsx`
  but editable (add/remove nodes = IR declarations).
- Add a `declarations` module + IR (de)serializer.
- Gateway gains `POST /api/build-from-ir`.

The trace canvas and the editor canvas share React Flow; only edit affordances differ.
This file marks the seam so adding ① is additive, not a restructure.
