# Deliverables & Goals UI (mock-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface tau's `goal`/`deliverable` postcondition checks in tau-ui across the Workflows canvas, Runs trace, and Dashboard — driven by fixtures, ready to swap to a real protocol later.

**Architecture:** A frontend-only mock. TS types mirror tau PR #340's Rust shapes; a single api module (`postconditions.ts`) returns fixtures behind a `VITE_MOCK_POSTCONDITIONS` flag (default on). Three embedded surfaces consume that data: React Flow gets a `CheckNode` + `RewindEdge`; the trace `SpanInspector` gets a `CheckVerdictPanel` branch; the Dashboard gets a glance card. No Rust/gateway changes.

**Tech Stack:** React 19, TypeScript, `@xyflow/react` v12 (React Flow), Zustand store, Vitest + Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-16-deliverables-goals-ui-design.md`. Read it first.

---

## Conventions for every task

- **Run tests** (fresh conductor worktree): once, `cd web && pnpm install`. Then per test:
  `cd web && ./node_modules/.bin/vitest run src/<path>` (do NOT use `pnpm exec vitest` in a worktree).
- **Per-task gate** (the per-task gate omits format:check, so format every task):
  `cd web && ./node_modules/.bin/prettier --write src/<files> && ./node_modules/.bin/eslint src/<files> && npx tsc --noEmit`
- **bigint:** `min_count` is `u64` → ts-rs `bigint`. Fixtures use `n` literals (`2n`); display via `Number(x)`.
- **Commits:** conventional, scoped `feat(web): …`. Commit at the end of each task only.
- **Do not edit generated files** (`types/Span.ts`, `types/SpanKind.ts` — header says "Do not edit"). `SpanKind` is a closed union; check spans deserialize to `Other`, so the frontend branches on span **attributes** (`check_kind`), never on `span.kind`.

## File structure

| File | Responsibility |
|---|---|
| `web/src/types/Postcondition.ts` (new) | All check TS types (mirror PR #340) — `Check`, `CheckVerify`, `Locus`, `GoalPredicate`, `JudgeRef`, `RetryPolicy`, `OnFail`, `BuildVerdict`, `CheckVerdict`, `CheckAttempt`, `RunCheckResult`. (`CheckReport` name is taken by Health — do not reuse.) |
| `web/src/api/fixtures/postconditions.ts` (new) | Fabricated data: the `research` scenario + variants + synthetic check spans. |
| `web/src/api/postconditions.ts` (new) | `getWorkflowChecks`, `getRunChecks`, `mockCheckSpans`; fixture-or-`request` behind the flag. |
| `web/src/graph/layout.ts` (modify) | `StepNodeData` gains check fields; `irToFlow` projects checks → `CheckNode`s + `RewindEdge`s + goal badges; `applyChecksSelection` pure helper. |
| `web/src/graph/CheckNode.tsx` (new) | Deliverable node — dual-channel encoding (border = build, corner badge = run). |
| `web/src/graph/RewindEdge.tsx` (new) | Amber dashed rewind edge with `↻ retry ×N` label. |
| `web/src/graph/GraphCanvas.tsx` (modify) | Register `check`/`rewind` types; `isValidConnection` rejects check handles. |
| `web/src/graph/StepNode.tsx` (modify) | Render goal badges on producer nodes. |
| `web/src/graph/GraphEditor.tsx` (modify) | Build-error summary + "reveal on canvas". |
| `web/src/trace/CheckVerdictPanel.tsx` (new) | Attempt stepper / single-line goal verdict. |
| `web/src/trace/SpanInspector.tsx` (modify) | Branch to `CheckVerdictPanel` when `attrs.check_kind` present. |
| `web/src/store/store.ts` (modify) | Merge `mockCheckSpans` into a loaded trace behind the flag. |
| `web/src/dashboard/ChecksGlanceCard.tsx` (new) | Last-run check summary card. |
| `web/src/dashboard/DashboardPage.tsx` (modify) | Mount the glance card. |

---

# Phase 0 — Foundation

### Task 1: Postcondition TS types

**Files:**
- Create: `web/src/types/Postcondition.ts`

- [ ] **Step 1: Write the types** (mirror PR #340; tagged unions follow ts-rs `kind` style)

```ts
// web/src/types/Postcondition.ts
// Provisional mirror of tau PR #340 (crates/tau-ir/src/check.rs,
// crates/tau-runtime-core). Swap to ts-rs-generated types when tau exposes a
// serve-protocol surface. NOTE: `CheckReport` is taken by Health — do not reuse.

export type Locus =
  | { kind: "path"; path: string }
  | { kind: "output"; step: string }; // steps.<id>.output

export type GoalPredicate =
  | { kind: "exists" }
  | { kind: "non_empty" }
  | { kind: "equals"; value: string }
  | { kind: "matches"; pattern: string }
  | { kind: "min_count"; min: bigint } // u64 → bigint (ts-rs)
  | { kind: "schema_valid"; schema: unknown }
  | { kind: "native_fn"; fn: string };

export type JudgeRef =
  | { kind: "builtin"; model: string | null }
  | { kind: "agent"; agent: string };

export type OnFail = "abort" | "retry";

export interface RetryPolicy {
  on_fail: OnFail;
  max_attempts: number;
  gate: string; // pipeline step id
}

export type CheckVerify =
  | { kind: "goal"; evaluates: Locus; predicate: GoalPredicate }
  | { kind: "deliverable"; locus: Locus; must_satisfy: string; judge: JudgeRef };

export interface Check {
  id: string;
  verify: CheckVerify;
  retry: RetryPolicy;
}

export type BuildVerdict =
  | { status: "ok" }
  | { status: "error"; message: string; producer?: string };

export interface CheckVerdict {
  met: boolean;
  rationale: string;
}

export interface CheckAttempt {
  attempt: number;
  verdict: CheckVerdict;
}

export interface RunCheckResult {
  id: string;
  kind: "goal" | "deliverable";
  attempts: CheckAttempt[];
  final: "met" | "failed" | "aborted";
  rewound_to?: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd web && npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add web/src/types/Postcondition.ts
git commit -m "feat(web): add provisional TS types for goal/deliverable checks"
```

---

### Task 2: Fixtures

**Files:**
- Create: `web/src/api/fixtures/postconditions.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/api/fixtures/postconditions.test.ts
import { describe, it, expect } from "vitest";
import { RESEARCH_CHECKS, RESEARCH_BUILD, RUN_RETRY_MET, BUILD_ERROR_CHECKS } from "./postconditions";

describe("postcondition fixtures", () => {
  it("declares one goal and one deliverable for the research scenario", () => {
    const kinds = RESEARCH_CHECKS.map((c) => c.verify.kind).sort();
    expect(kinds).toEqual(["deliverable", "goal"]);
  });

  it("all research checks build OK", () => {
    expect(Object.values(RESEARCH_BUILD).every((v) => v.status === "ok")).toBe(true);
  });

  it("the retry run shows the deliverable failing then met across 2 attempts", () => {
    const report = RUN_RETRY_MET.find((r) => r.id === "report")!;
    expect(report.attempts).toHaveLength(2);
    expect(report.attempts[0].verdict.met).toBe(false);
    expect(report.final).toBe("met");
    expect(report.rewound_to).toBe("writer");
  });

  it("the build-error fixture flags the deliverable with a producer to reveal", () => {
    expect(BUILD_ERROR_CHECKS.report.status).toBe("error");
    if (BUILD_ERROR_CHECKS.report.status === "error") {
      expect(BUILD_ERROR_CHECKS.report.producer).toBe("writer");
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/api/fixtures/postconditions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the fixtures**

```ts
// web/src/api/fixtures/postconditions.ts
// Fabricated, faithful to PR #340's conformance fixture (the `research` pipeline:
// gather → writer; goal has_sources; deliverable report, on_fail=retry).
import type { Check, BuildVerdict, RunCheckResult } from "../../types/Postcondition";

export const RESEARCH_CHECKS: Check[] = [
  {
    id: "has_sources",
    verify: {
      kind: "goal",
      evaluates: { kind: "path", path: "/workspace/report.md" },
      predicate: { kind: "matches", pattern: "(?m)^## Sources" },
    },
    retry: { on_fail: "abort", max_attempts: 1, gate: "writer" },
  },
  {
    id: "report",
    verify: {
      kind: "deliverable",
      locus: { kind: "path", path: "/workspace/report.md" },
      must_satisfy: "A coherent summary that accurately reflects the sources.",
      judge: { kind: "builtin", model: null },
    },
    retry: { on_fail: "retry", max_attempts: 3, gate: "writer" },
  },
];

// which agent node produces each deliverable (drives the goal-badge anchor + reveal)
export const PRODUCER_OF: Record<string, string> = { report: "writer", has_sources: "writer" };

export const RESEARCH_BUILD: Record<string, BuildVerdict> = {
  has_sources: { status: "ok" },
  report: { status: "ok" },
};

export const BUILD_ERROR_CHECKS: Record<string, BuildVerdict> = {
  has_sources: { status: "ok" },
  report: {
    status: "error",
    producer: "writer",
    message:
      'deliverable "report" has retry_from = "polish" but "polish" runs after producer "writer" — the gate must be at or before the producer.',
  },
};

export const RUN_RETRY_MET: RunCheckResult[] = [
  {
    id: "report",
    kind: "deliverable",
    rewound_to: "writer",
    final: "met",
    attempts: [
      { attempt: 1, verdict: { met: false, rationale: "only 1 source cited; need >=2." } },
      { attempt: 2, verdict: { met: true, rationale: "summary cites 3 sources, accurate." } },
    ],
  },
  {
    id: "has_sources",
    kind: "goal",
    final: "met",
    attempts: [{ attempt: 1, verdict: { met: true, rationale: "matched ^## Sources" } }],
  },
];

export const RUN_ALL_PASS: RunCheckResult[] = [
  {
    id: "report",
    kind: "deliverable",
    final: "met",
    attempts: [{ attempt: 1, verdict: { met: true, rationale: "coherent and accurate." } }],
  },
  {
    id: "has_sources",
    kind: "goal",
    final: "met",
    attempts: [{ attempt: 1, verdict: { met: true, rationale: "matched ^## Sources" } }],
  },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/api/fixtures/postconditions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/api/fixtures/postconditions.ts src/api/fixtures/postconditions.test.ts && ./node_modules/.bin/eslint src/api/fixtures/postconditions.ts src/api/fixtures/postconditions.test.ts && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/api/fixtures/postconditions.ts web/src/api/fixtures/postconditions.test.ts
git commit -m "feat(web): add goal/deliverable mock fixtures (research scenario)"
```

---

### Task 3: API module

**Files:**
- Create: `web/src/api/postconditions.ts`, `web/src/api/postconditions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/api/postconditions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getWorkflowChecks, getRunChecks } from "./postconditions";

beforeEach(() => vi.restoreAllMocks());

describe("postconditions api (mock mode default)", () => {
  it("getWorkflowChecks returns fixture checks + build verdicts without fetching", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await getWorkflowChecks("demo", "research");
    expect(f).not.toHaveBeenCalled();
    expect(r.checks.map((c) => c.id).sort()).toEqual(["has_sources", "report"]);
    expect(r.build.report.status).toBe("ok");
  });

  it("getRunChecks returns folded per-check results for a retry run", async () => {
    const r = await getRunChecks("demo", "run-retry");
    const report = r.results.find((x) => x.id === "report")!;
    expect(report.final).toBe("met");
    expect(report.attempts).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/api/postconditions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the api module**

```ts
// web/src/api/postconditions.ts
import type { Check, BuildVerdict, RunCheckResult } from "../types/Postcondition";
import type { Span } from "../types/Span";
import { request, scopedPath } from "./client";
import {
  RESEARCH_CHECKS,
  RESEARCH_BUILD,
  BUILD_ERROR_CHECKS,
  RUN_RETRY_MET,
  RUN_ALL_PASS,
  PRODUCER_OF,
} from "./fixtures/postconditions";

/** Mock until tau exposes a serve-protocol surface for checks. Flip off with
 *  VITE_MOCK_POSTCONDITIONS="false" once the real endpoints exist. */
const MOCK = import.meta.env.VITE_MOCK_POSTCONDITIONS !== "false";

export interface WorkflowChecks {
  checks: Check[];
  build: Record<string, BuildVerdict>;
  producerOf: Record<string, string>;
}
export interface RunChecks {
  results: RunCheckResult[];
}

export async function getWorkflowChecks(pid: string, workflowId: string): Promise<WorkflowChecks> {
  if (MOCK) {
    const build = workflowId === "build-error" ? BUILD_ERROR_CHECKS : RESEARCH_BUILD;
    return { checks: RESEARCH_CHECKS, build, producerOf: PRODUCER_OF };
  }
  return request<WorkflowChecks>(scopedPath(pid, `/workflows/${encodeURIComponent(workflowId)}/checks`));
}

export async function getRunChecks(pid: string, runId: string): Promise<RunChecks> {
  if (MOCK) {
    return { results: runId === "run-allpass" ? RUN_ALL_PASS : RUN_RETRY_MET };
  }
  return request<RunChecks>(scopedPath(pid, `/runs/${encodeURIComponent(runId)}/checks`));
}

/** Synthetic check spans merged into a loaded trace so check evaluations appear
 *  in the timeline. Each span carries the folded attempt data in `attributes`,
 *  so the inspector reads everything from the span (no extra fetch). */
export function mockCheckSpans(runId: string): Span[] {
  if (!MOCK) return [];
  const results = runId === "run-allpass" ? RUN_ALL_PASS : RUN_RETRY_MET;
  return results.map((r) => ({
    id: `check-${r.id}`,
    parent_id: null,
    run_id: runId,
    kind: "tool_call", // closed SpanKind union; real check spans deserialize to Other
    name: `check · ${r.id}`,
    status: r.final === "met" ? "ok" : "error",
    started_at: "1970-01-01T00:00:00Z",
    ended_at: "1970-01-01T00:00:01Z",
    attributes: { check_kind: r.kind, check: r },
  }));
}
```

> Note: `scopedPath` is the public name exported by `client.ts` (the existing api modules import `{ request, scopedPath }`). The branch values are unused in mock mode but keep the swap type-stable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/api/postconditions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/api/postconditions.ts src/api/postconditions.test.ts && ./node_modules/.bin/eslint src/api/postconditions.ts src/api/postconditions.test.ts && npx tsc --noEmit`
Expected: clean. (If `scopedPath` is not exported under that name, open `src/api/client.ts`, confirm the exported helper name, and use it.)

- [ ] **Step 6: Commit**

```bash
git add web/src/api/postconditions.ts web/src/api/postconditions.test.ts
git commit -m "feat(web): add postconditions api module (fixture-backed, flag-gated)"
```

---

# Phase 1 — Workflows canvas

### Task 4: CheckNode component + StepNodeData fields

**Files:**
- Modify: `web/src/graph/layout.ts:5-15` (StepNodeData)
- Create: `web/src/graph/CheckNode.tsx`, `web/src/graph/CheckNode.test.tsx`

- [ ] **Step 1: Extend `StepNodeData`** (add check fields after `disabled?`)

```ts
// in web/src/graph/layout.ts, inside StepNodeData
  // --- postcondition checks (mock) ---
  checkKind?: "goal" | "deliverable"; // set on CheckNode (type "check")
  buildError?: string; // design-time: dashed-red border + message
  runStatus?: "met" | "failed" | "aborted" | null; // runtime corner badge
  attemptCount?: number; // runtime: ×N when > 1
  goalBadges?: { id: string; status: "met" | "failed" | "validated" }[]; // on producer StepNodes
```

- [ ] **Step 2: Write the failing test**

```tsx
// web/src/graph/CheckNode.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { CheckNode } from "./CheckNode";
import { GraphActionsContext } from "./GraphActions";
import type { StepNodeData } from "./layout";

const actions = {
  editable: false,
  onInspect: () => {},
  onDisable: () => {},
  onDuplicate: () => {},
  onDelete: () => {},
  onRequestAdd: () => {},
  onRequestInsert: () => {},
};
function renderNode(data: Partial<StepNodeData>) {
  const full: StepNodeData = {
    label: "report",
    kind: "check.deliverable",
    agent: null,
    tool: null,
    input: null,
    provider: null,
    tools: [],
    checkKind: "deliverable",
    ...data,
  };
  return render(
    <ReactFlowProvider>
      <GraphActionsContext.Provider value={actions}>
        <CheckNode id="check-report" data={full} selected={false} type="check" dragging={false}
          zIndex={0} isConnectable={false} positionAbsoluteX={0} positionAbsoluteY={0} />
      </GraphActionsContext.Provider>
    </ReactFlowProvider>,
  );
}

describe("CheckNode", () => {
  it("shows ◇ validated when no run + no build error", () => {
    renderNode({});
    expect(screen.getByText(/validated/i)).toBeInTheDocument();
  });
  it("shows the build error state", () => {
    renderNode({ buildError: "gate after producer" });
    expect(screen.getByText(/build error/i)).toBeInTheDocument();
  });
  it("shows runtime met + ×N when retried", () => {
    renderNode({ runStatus: "met", attemptCount: 2 });
    expect(screen.getByText("met")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/CheckNode.test.tsx`
Expected: FAIL (CheckNode not found).

- [ ] **Step 4: Write `CheckNode.tsx`** (mirrors StepNode structure; dual-channel encoding per spec R3/R4)

```tsx
// web/src/graph/CheckNode.tsx
import { Handle, Position, NodeToolbar, type Node, type NodeProps } from "@xyflow/react";
import type { StepNodeData } from "./layout";
import { useGraphActions } from "./GraphActions";

export function CheckNode({ id, data, selected }: NodeProps<Node<StepNodeData>>) {
  const actions = useGraphActions();
  const handle = "!h-2 !w-2 !border !border-border !bg-muted !opacity-40"; // inspect-only: dimmed
  // design-time channel = border; runtime channel = corner badge (green only ever runtime)
  const border = data.buildError ? "border-st-error border-dashed" : "border-accent/50";
  return (
    <>
      <NodeToolbar isVisible={selected} position={Position.Top}
        className="flex gap-0.5 rounded-md bg-fg px-1 py-0.5 text-bg">
        <button type="button" title="inspect" aria-label="inspect"
          className="rounded px-1.5 py-0.5 text-[10px] hover:bg-white/10"
          onClick={() => actions.onInspect(id)}>⊙</button>
      </NodeToolbar>
      <div className={`relative flex min-w-[150px] items-center gap-2 rounded-lg border bg-surface px-2.5 py-2 text-xs shadow-sm ${
          selected ? "ring-2 ring-accent" : ""} ${border}`}>
        <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
        <div aria-hidden className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-accent text-sm text-white">⬇</div>
        <div className="min-w-0">
          <div className="truncate font-semibold">{data.label}</div>
          <div className="flex items-center gap-1 text-muted">
            <span className="text-[9px] uppercase tracking-wide">deliverable</span>
          </div>
        </div>
        {/* corner badges */}
        <div className="absolute -right-2 -top-2 flex gap-1">
          {data.buildError ? (
            <span className="rounded-full border border-st-error bg-st-error-soft px-1.5 text-[9px] font-semibold text-st-error">✕ build error</span>
          ) : data.runStatus ? (
            <>
              {data.attemptCount && data.attemptCount > 1 && (
                <span className="rounded-full border border-amber-600 bg-amber-100 px-1.5 text-[9px] font-semibold text-amber-800">×{data.attemptCount}</span>
              )}
              <span className={`rounded-full px-1.5 text-[9px] font-semibold ${
                data.runStatus === "met" ? "border border-st-ok bg-st-ok-soft text-st-ok" : "border border-st-error bg-st-error-soft text-st-error"}`}>
                {data.runStatus}
              </span>
            </>
          ) : (
            <span className="rounded-full border border-accent/50 bg-accent/10 px-1.5 text-[9px] font-semibold text-accent">◇ validated</span>
          )}
        </div>
        <Handle type="source" position={Position.Right} className={handle} isConnectable={false} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/CheckNode.test.tsx`
Expected: PASS (3 tests). (If `@testing-library/jest-dom` matchers like `toBeInTheDocument` are not globally set up, use `expect(screen.queryByText(...)).not.toBeNull()` instead — check an existing `*.test.tsx` for the project's matcher setup.)

- [ ] **Step 6: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/graph/CheckNode.tsx src/graph/CheckNode.test.tsx src/graph/layout.ts && ./node_modules/.bin/eslint src/graph/CheckNode.tsx src/graph/CheckNode.test.tsx src/graph/layout.ts && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/graph/CheckNode.tsx web/src/graph/CheckNode.test.tsx web/src/graph/layout.ts
git commit -m "feat(web): add CheckNode with dual-channel build/run encoding"
```

---

### Task 5: RewindEdge + register node/edge types

**Files:**
- Create: `web/src/graph/RewindEdge.tsx`
- Modify: `web/src/graph/GraphCanvas.tsx:16-17` (registries) and `:41-53` (add `isValidConnection`)
- Create: `web/src/graph/GraphCanvas.checks.test.tsx`

- [ ] **Step 1: Write `RewindEdge.tsx`** (distinct visual class per spec R1; no "+" insert handle per R7)

```tsx
// web/src/graph/RewindEdge.tsx
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";

export function RewindEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.6,
  });
  const dimmed = (data as { dimmed?: boolean } | undefined)?.dimmed;
  const attempts = (data as { attempts?: number } | undefined)?.attempts ?? 1;
  return (
    <>
      <BaseEdge id={id} path={path}
        style={{ stroke: "#d29922", strokeWidth: 1.6, strokeDasharray: "6 4", opacity: dimmed ? 0.25 : 1 }} />
      <EdgeLabelRenderer>
        <div style={{ position: "absolute", transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, opacity: dimmed ? 0.25 : 1 }}
          className="rounded-full border border-amber-700 bg-amber-100 px-1.5 text-[9px] font-semibold text-amber-800">
          ↻ retry ×{attempts}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
```

- [ ] **Step 2: Register types + guard connections in `GraphCanvas.tsx`**

Change line 12-17:
```tsx
import { StepNode } from "./StepNode";
import { StepEdge } from "./StepEdge";
import { CheckNode } from "./CheckNode";
import { RewindEdge } from "./RewindEdge";
import { GraphActionsContext, type GraphActions } from "./GraphActions";

const nodeTypes = { step: StepNode, check: CheckNode };
const edgeTypes = { step: StepEdge, rewind: RewindEdge };
```
Add to the `<ReactFlow …>` props (after `onConnect={onConnect}`), so check nodes can never be hand-wired (spec R6):
```tsx
          isValidConnection={(c) => {
            const isCheck = (nid: string | null) =>
              nid != null && nodes.find((n) => n.id === nid)?.type === "check";
            return !isCheck(c.source) && !isCheck(c.target);
          }}
```

- [ ] **Step 3: Write the failing test**

```tsx
// web/src/graph/GraphCanvas.checks.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { GraphCanvas } from "./GraphCanvas";
import type { Node, Edge } from "@xyflow/react";

const noop = () => {};
const actions = { editable: false, onInspect: noop, onDisable: noop, onDuplicate: noop,
  onDelete: noop, onRequestAdd: noop, onRequestInsert: noop };

describe("GraphCanvas with checks", () => {
  it("renders a check node and a rewind edge without throwing", () => {
    const nodes: Node[] = [
      { id: "writer", type: "step", position: { x: 0, y: 0 }, data: { label: "writer", kind: "agent.run", agent: "writer", tool: null, input: null, provider: "anthropic", tools: [] } },
      { id: "check-report", type: "check", position: { x: 220, y: 0 }, data: { label: "report", kind: "check.deliverable", agent: null, tool: null, input: null, provider: null, tools: [], checkKind: "deliverable", runStatus: "met", attemptCount: 2 } },
    ];
    const edges: Edge[] = [{ id: "check-report->writer", source: "check-report", target: "writer", type: "rewind", data: { attempts: 2 } }];
    const { container } = render(
      <GraphCanvas nodes={nodes} edges={edges} editable={false} actions={actions}
        onNodesChange={noop} onEdgesChange={noop} onConnect={noop} onSelect={noop} />,
    );
    expect(container.querySelector(".react-flow")).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run it (expect pass after edits)**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/GraphCanvas.checks.test.tsx`
Expected: PASS.

- [ ] **Step 5: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/graph/RewindEdge.tsx src/graph/GraphCanvas.tsx src/graph/GraphCanvas.checks.test.tsx && ./node_modules/.bin/eslint src/graph/RewindEdge.tsx src/graph/GraphCanvas.tsx src/graph/GraphCanvas.checks.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/graph/RewindEdge.tsx web/src/graph/GraphCanvas.tsx web/src/graph/GraphCanvas.checks.test.tsx
git commit -m "feat(web): register CheckNode/RewindEdge and block check wiring"
```

---

### Task 6: Project checks into the IR layout

**Files:**
- Modify: `web/src/graph/layout.ts` (add `projectChecks` + `applyChecksSelection`)
- Create: `web/src/graph/layout.checks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/graph/layout.checks.test.ts
import { describe, it, expect } from "vitest";
import { projectChecks, applyChecksSelection } from "./layout";
import type { Node, Edge } from "@xyflow/react";
import type { StepNodeData } from "./layout";
import { RESEARCH_CHECKS, RESEARCH_BUILD, PRODUCER_OF, RUN_RETRY_MET } from "../api/fixtures/postconditions";

const baseNodes = (): Node<StepNodeData>[] => [
  { id: "gather", type: "step", position: { x: 0, y: 0 }, data: { label: "gather", kind: "agent.run", agent: "gather", tool: null, input: null, provider: "anthropic", tools: [] } },
  { id: "writer", type: "step", position: { x: 220, y: 0 }, data: { label: "writer", kind: "agent.run", agent: "writer", tool: null, input: null, provider: "anthropic", tools: [] } },
];

describe("projectChecks", () => {
  it("adds a check node for the deliverable, a goal badge on its producer, and a rewind edge", () => {
    const { nodes, edges } = projectChecks(baseNodes(), [], {
      checks: RESEARCH_CHECKS, build: RESEARCH_BUILD, producerOf: PRODUCER_OF,
    }, RUN_RETRY_MET);
    const checkNode = nodes.find((n) => n.id === "check-report");
    expect(checkNode?.type).toBe("check");
    expect(checkNode?.data.runStatus).toBe("met");
    expect(checkNode?.data.attemptCount).toBe(2);
    const writer = nodes.find((n) => n.id === "writer")!;
    expect(writer.data.goalBadges?.[0].id).toBe("has_sources");
    const rewind = edges.find((e) => e.type === "rewind");
    expect(rewind?.source).toBe("check-report");
    expect(rewind?.target).toBe("writer");
  });

  it("applyChecksSelection dims rewind edges not belonging to the selected check", () => {
    const edges: Edge[] = [
      { id: "check-report->writer", source: "check-report", target: "writer", type: "rewind", data: { attempts: 2 } },
      { id: "check-other->x", source: "check-other", target: "x", type: "rewind", data: { attempts: 1 } },
    ];
    const out = applyChecksSelection(edges, "check-report");
    expect((out[0].data as { dimmed?: boolean }).dimmed).toBe(false);
    expect((out[1].data as { dimmed?: boolean }).dimmed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/layout.checks.test.ts`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Add the functions to `layout.ts`** (append at end of file)

```ts
// web/src/graph/layout.ts (append)
import type { WorkflowChecks } from "../api/postconditions";
import type { RunCheckResult } from "../types/Postcondition";

/**
 * Overlay checks onto an existing flow: deliverables become `check` nodes wired
 * after their producer with a `rewind` edge back to the gate; goals become
 * badges on the node that produces what they evaluate (spec: grammar C).
 * `runResults` is empty when no run is selected (design-time view).
 */
export function projectChecks(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
  wf: WorkflowChecks,
  runResults: RunCheckResult[],
): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const runById = new Map(runResults.map((r) => [r.id, r]));
  const outNodes = [...nodes];
  const outEdges = [...edges];
  const goalsByProducer = new Map<string, { id: string; status: "met" | "failed" | "validated" }[]>();

  for (const c of wf.checks) {
    const build = wf.build[c.id];
    const producer = wf.producerOf[c.id];
    const run = runById.get(c.id);
    if (c.verify.kind === "goal") {
      const status = run ? (run.final === "met" ? "met" : "failed") : "validated";
      const list = goalsByProducer.get(producer) ?? [];
      list.push({ id: c.id, status });
      goalsByProducer.set(producer, list);
      continue;
    }
    // deliverable → node + rewind edge
    const producerNode = nodes.find((n) => n.id === producer);
    const x = (producerNode?.position.x ?? 0) + X_GAP;
    const y = producerNode?.position.y ?? 0;
    const checkId = `check-${c.id}`;
    outNodes.push({
      id: checkId,
      type: "check",
      position: { x, y },
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
      data: { attempts: run?.attempts.length ?? c.retry.max_attempts },
    });
  }

  for (const n of outNodes) {
    const badges = goalsByProducer.get(n.id);
    if (badges) n.data = { ...n.data, goalBadges: badges };
  }
  return { nodes: outNodes, edges: outEdges };
}

/** Emphasis pass: when a check node is selected, dim every rewind edge that is
 *  not its own (spec R2 pair-highlight, as a pure transform). */
export function applyChecksSelection(edges: Edge[], selectedId: string | null): Edge[] {
  return edges.map((e) => {
    if (e.type !== "rewind") return e;
    const dimmed = selectedId != null && e.source !== selectedId;
    return { ...e, data: { ...(e.data ?? {}), dimmed } };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/graph/layout.checks.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/graph/layout.ts src/graph/layout.checks.test.ts && ./node_modules/.bin/eslint src/graph/layout.ts src/graph/layout.checks.test.ts && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/graph/layout.ts src/graph/layout.checks.test.ts 2>/dev/null; git add web/src/graph/layout.checks.test.ts
git commit -m "feat(web): project checks into IR layout (nodes, badges, rewind edges)"
```

---

### Task 7: Wire checks + build-error reveal into GraphEditor

**Files:**
- Modify: `web/src/graph/GraphEditor.tsx` (fetch checks for the compiled-IR view, apply `projectChecks`/`applyChecksSelection`, render a build-error summary that reveals the producer), and `web/src/graph/StepNode.tsx` (render `goalBadges`).

> This task wires the pure functions from Task 6 into the live editor. Because `GraphEditor.tsx` is large, follow these precise edits.

- [ ] **Step 1: Render goal badges in `StepNode.tsx`** — inside the `<div className="min-w-0">` block, after the provider line (around line 84), add:

```tsx
          {data.goalBadges && data.goalBadges.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {data.goalBadges.map((g) => (
                <span key={g.id}
                  className={`rounded-full px-1.5 text-[9px] font-semibold ${
                    g.status === "met" ? "border border-st-ok bg-st-ok-soft text-st-ok"
                    : g.status === "failed" ? "border border-st-error bg-st-error-soft text-st-error"
                    : "border border-accent/50 bg-accent/10 text-accent"}`}>
                  ✓ goal {g.id}
                </span>
              ))}
            </div>
          )}
```

- [ ] **Step 2: In `GraphEditor.tsx`, load checks for the compiled-IR view.** Add near the other imports:

```tsx
import { getWorkflowChecks, getRunChecks, type WorkflowChecks } from "../api/postconditions";
import { projectChecks, applyChecksSelection } from "./layout";
import type { RunCheckResult } from "../types/Postcondition";
```

Add state + load (place beside the existing IR/graph state; use the compiled-IR view's workflow id — reuse whatever id the editor already has for the selected workflow, falling back to `"research"` in mock mode):

```tsx
  const [wfChecks, setWfChecks] = useState<WorkflowChecks | null>(null);
  const [runResults, setRunResults] = useState<RunCheckResult[]>([]);
  useEffect(() => {
    if (!pid) return;
    getWorkflowChecks(pid, "research").then(setWfChecks).catch(() => setWfChecks(null));
    getRunChecks(pid, "run-retry").then((r) => setRunResults(r.results)).catch(() => setRunResults([]));
  }, [pid]);
```

- [ ] **Step 3: Apply the overlay where nodes/edges are computed for the compiled view.** Find where the editor derives `nodes`/`edges` from `irToFlow(...)` (compiled view). Wrap them:

```tsx
  const withChecks = wfChecks
    ? projectChecks(baseNodes, baseEdges, wfChecks, runResults)
    : { nodes: baseNodes, edges: baseEdges };
  const displayNodes = withChecks.nodes;
  const displayEdges = applyChecksSelection(withChecks.edges, selectedId);
```

Pass `displayNodes`/`displayEdges` to `<GraphCanvas nodes=… edges=…>` (replacing the previous `nodes`/`edges`). `baseNodes`/`baseEdges` are the current `irToFlow` outputs; `selectedId` is the editor's existing selected-node state.

- [ ] **Step 4: Render a build-error summary with reveal-on-canvas** (spec R8). In the inspector/side area JSX, add:

```tsx
  {wfChecks &&
    Object.entries(wfChecks.build)
      .filter(([, v]) => v.status === "error")
      .map(([id, v]) => (
        <div key={id} role="alert"
          className="mb-2 rounded-md border border-st-error/40 bg-st-error-soft px-2.5 py-2 text-[11px] text-st-error">
          <strong>{id}</strong>: {v.status === "error" ? v.message : ""}
          {v.status === "error" && v.producer && (
            <button type="button" className="mt-1 block text-accent underline"
              onClick={() => onSelect(v.producer!)}>
              → reveal on canvas
            </button>
          )}
        </div>
      ))}
```

(`onSelect` is the editor's existing select handler; selecting a node highlights/centers it via the existing `onNodeClick` wiring.)

- [ ] **Step 5: Run the full graph test suite**

Run: `cd web && ./node_modules/.bin/vitest run src/graph`
Expected: PASS (existing graph tests + new ones).

- [ ] **Step 6: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/graph/GraphEditor.tsx src/graph/StepNode.tsx && ./node_modules/.bin/eslint src/graph/GraphEditor.tsx src/graph/StepNode.tsx && npx tsc --noEmit`
Expected: clean. If `tsc` flags an unused var or a naming mismatch (e.g. the editor's selected-id state is named differently than `selectedId`), adjust to the real names in the file — do not invent.

- [ ] **Step 7: Commit**

```bash
git add web/src/graph/GraphEditor.tsx web/src/graph/StepNode.tsx
git commit -m "feat(web): overlay checks + build-error reveal in workflow canvas"
```

---

# Phase 2 — Runs trace

### Task 8: CheckVerdictPanel (attempt stepper)

**Files:**
- Create: `web/src/trace/CheckVerdictPanel.tsx`, `web/src/trace/CheckVerdictPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/trace/CheckVerdictPanel.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckVerdictPanel } from "./CheckVerdictPanel";
import type { RunCheckResult } from "../types/Postcondition";

const retry: RunCheckResult = {
  id: "report", kind: "deliverable", final: "met", rewound_to: "writer",
  attempts: [
    { attempt: 1, verdict: { met: false, rationale: "only 1 source cited; need >=2." } },
    { attempt: 2, verdict: { met: true, rationale: "cites 3 sources." } },
  ],
};
const goal: RunCheckResult = {
  id: "has_sources", kind: "goal", final: "met",
  attempts: [{ attempt: 1, verdict: { met: true, rationale: "matched" } }],
};

describe("CheckVerdictPanel", () => {
  it("renders an attempt stepper with the rewind feedback for a multi-attempt deliverable", () => {
    render(<CheckVerdictPanel result={retry} />);
    expect(screen.getByText(/Attempt 1/)).toBeInTheDocument();
    expect(screen.getByText(/only 1 source cited/)).toBeInTheDocument();
    expect(screen.getByText(/rewind to writer/i)).toBeInTheDocument();
    expect(screen.getByText(/Attempt 2/)).toBeInTheDocument();
  });
  it("collapses a single-attempt goal to a one-line verdict (no stepper)", () => {
    render(<CheckVerdictPanel result={goal} />);
    expect(screen.queryByText(/Attempt 1/)).toBeNull();
    expect(screen.getByText(/met/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/trace/CheckVerdictPanel.test.tsx`
Expected: FAIL (not found).

- [ ] **Step 3: Write `CheckVerdictPanel.tsx`**

```tsx
// web/src/trace/CheckVerdictPanel.tsx
import type { RunCheckResult } from "../types/Postcondition";

export function CheckVerdictPanel({ result }: { result: RunCheckResult }) {
  const single = result.attempts.length <= 1;
  if (single) {
    const v = result.attempts[0]?.verdict;
    return (
      <div className="rounded-md border border-border bg-bg p-2 text-xs">
        <span className={`rounded-full px-1.5 text-[10px] font-semibold ${
          result.final === "met" ? "bg-st-ok-soft text-st-ok" : "bg-st-error-soft text-st-error"}`}>
          {result.final}
        </span>
        {v && <p className="mt-1 text-muted">{v.rationale}</p>}
      </div>
    );
  }
  return (
    <ol className="m-0 list-none p-0 text-xs">
      {result.attempts.map((a, i) => (
        <li key={a.attempt} className="mb-2">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${a.verdict.met ? "bg-st-ok" : "bg-st-error"}`} />
            <strong>Attempt {a.attempt}</strong>
            <span className={`rounded-full px-1.5 text-[10px] font-semibold ${
              a.verdict.met ? "bg-st-ok-soft text-st-ok" : "bg-st-error-soft text-st-error"}`}>
              {a.verdict.met ? "met" : "fail"}
            </span>
          </div>
          <p className="ml-4 mt-1 border-l-2 border-amber-700 bg-amber-50/5 px-2 italic text-amber-700">
            {a.verdict.rationale}
          </p>
          {!a.verdict.met && i < result.attempts.length - 1 && result.rewound_to && (
            <div className="ml-4 mt-1 text-[10px] text-amber-700">
              ↻ rewind to {result.rewound_to} · rationale injected
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/trace/CheckVerdictPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/trace/CheckVerdictPanel.tsx src/trace/CheckVerdictPanel.test.tsx && ./node_modules/.bin/eslint src/trace/CheckVerdictPanel.tsx src/trace/CheckVerdictPanel.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/trace/CheckVerdictPanel.tsx web/src/trace/CheckVerdictPanel.test.tsx
git commit -m "feat(web): add CheckVerdictPanel attempt stepper"
```

---

### Task 9: Branch SpanInspector to the verdict panel

**Files:**
- Modify: `web/src/trace/SpanInspector.tsx`
- Create: `web/src/trace/SpanInspector.checks.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/trace/SpanInspector.checks.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpanInspector } from "./SpanInspector";
import type { Span } from "../types/Span";

const checkSpan: Span = {
  id: "check-report", parent_id: null, run_id: "r1", kind: "tool_call",
  name: "check · report", status: "ok", started_at: "x", ended_at: "y",
  attributes: {
    check_kind: "deliverable",
    check: {
      id: "report", kind: "deliverable", final: "met", rewound_to: "writer",
      attempts: [
        { attempt: 1, verdict: { met: false, rationale: "only 1 source cited" } },
        { attempt: 2, verdict: { met: true, rationale: "good" } },
      ],
    },
  },
};

describe("SpanInspector with a check span", () => {
  it("renders the verdict stepper instead of the generic key/value list", () => {
    render(<SpanInspector span={checkSpan} />);
    expect(screen.getByText(/Attempt 1/)).toBeInTheDocument();
    expect(screen.getByText(/rewind to writer/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/trace/SpanInspector.checks.test.tsx`
Expected: FAIL (no stepper rendered).

- [ ] **Step 3: Add the branch to `SpanInspector.tsx`** — add the import and a branch right after `const attrs = …` (line 26):

```tsx
import { CheckVerdictPanel } from "./CheckVerdictPanel";
import type { RunCheckResult } from "../types/Postcondition";
```
```tsx
  if (attrs.check_kind && attrs.check) {
    return (
      <div className="overflow-auto p-3">
        <h3 className="mb-1 mt-0 text-sm font-semibold">{span.name}</h3>
        <div className="mb-2 text-xs text-muted">{String(attrs.check_kind)} · {span.status}</div>
        <CheckVerdictPanel result={attrs.check as RunCheckResult} />
      </div>
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/trace/SpanInspector.checks.test.tsx`
Expected: PASS.

- [ ] **Step 5: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/trace/SpanInspector.tsx src/trace/SpanInspector.checks.test.tsx && ./node_modules/.bin/eslint src/trace/SpanInspector.tsx src/trace/SpanInspector.checks.test.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/trace/SpanInspector.tsx web/src/trace/SpanInspector.checks.test.tsx
git commit -m "feat(web): render check verdict stepper in SpanInspector"
```

---

### Task 10: Merge mock check spans into a loaded trace

**Files:**
- Modify: `web/src/store/store.ts:229-231` (the `getTrace` load path)
- Create: `web/src/store/store.checks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/store/store.checks.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStore } from "./store";

beforeEach(() => vi.restoreAllMocks());

describe("trace load merges mock check spans", () => {
  it("appends check spans for a retry run", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ run: { id: "run-retry", agent_id: "research", source: "log", status: "completed" }, spans: [], events: [] }),
    }));
    await useStore.getState().openRun("demo", "run-retry");
    const spans = useStore.getState().currentTrace!.spans;
    expect(spans.some((s) => (s.attributes as { check_kind?: string }).check_kind === "deliverable")).toBe(true);
  });
});
```

> The trace-load action may be named `openRun` / `loadTrace` — open `store.ts` and use the real action name that wraps `getTrace` (around line 229). Adjust the test call accordingly.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/store/store.checks.test.ts`
Expected: FAIL (no check spans).

- [ ] **Step 3: Edit the load path in `store.ts`** — add the import and merge:

```ts
import { mockCheckSpans } from "../api/postconditions";
```
Change lines 229-231 from:
```ts
      const trace = await getTrace(pid, id);
      …
        currentTrace: { run: trace.run, spans: trace.spans, events: trace.events ?? [] },
```
to:
```ts
      const trace = await getTrace(pid, id);
      …
        currentTrace: {
          run: trace.run,
          spans: [...trace.spans, ...mockCheckSpans(id)],
          events: trace.events ?? [],
        },
```

(Keep the rest of the `set({...})` object unchanged; only the `spans` value changes.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/store/store.checks.test.ts src/store/store.test.ts`
Expected: PASS (new test + existing store tests still green).

- [ ] **Step 5: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/store/store.ts src/store/store.checks.test.ts && ./node_modules/.bin/eslint src/store/store.ts src/store/store.checks.test.ts && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/store/store.ts web/src/store/store.checks.test.ts
git commit -m "feat(web): merge mock check spans into loaded trace"
```

---

# Phase 3 — Dashboard glance

### Task 11: ChecksGlanceCard + mount on the dashboard

**Files:**
- Create: `web/src/dashboard/ChecksGlanceCard.tsx`, `web/src/dashboard/ChecksGlanceCard.test.tsx`
- Modify: `web/src/dashboard/DashboardPage.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/dashboard/ChecksGlanceCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChecksGlanceCard } from "./ChecksGlanceCard";

describe("ChecksGlanceCard", () => {
  it("summarizes the last run's checks (met counts + retries)", async () => {
    render(
      <MemoryRouter>
        <ChecksGlanceCard pid="demo" runId="run-retry" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/1 deliverable met/i)).toBeInTheDocument());
    expect(screen.getByText(/1 goal met/i)).toBeInTheDocument();
    expect(screen.getByText(/1 retry/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && ./node_modules/.bin/vitest run src/dashboard/ChecksGlanceCard.test.tsx`
Expected: FAIL (not found).

- [ ] **Step 3: Write `ChecksGlanceCard.tsx`** (uses the shared `useAsync` 4-state hook)

```tsx
// web/src/dashboard/ChecksGlanceCard.tsx
import { useCallback as _unused } from "react"; // placeholder removed below
```

> Replace the stray import above with the real component:

```tsx
// web/src/dashboard/ChecksGlanceCard.tsx
import { useAsync } from "../app/useAsync";
import { getRunChecks } from "../api/postconditions";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function ChecksGlanceCard({ pid, runId }: { pid: string; runId: string }) {
  const state = useAsync(() => getRunChecks(pid, runId), [pid, runId]);
  if (state.status === "loading") return <div className="h-16 animate-pulse rounded-lg bg-surface" />;
  if (state.status !== "data") return null;
  const results = state.data.results;
  const count = (kind: "goal" | "deliverable", met: boolean) =>
    results.filter((r) => r.kind === kind && (r.final === "met") === met).length;
  const retries = results.reduce((n, r) => n + Math.max(0, r.attempts.length - 1), 0);
  const goalsMet = count("goal", true);
  const delivMet = count("deliverable", true);
  const anyFailed = results.some((r) => r.final !== "met");
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 text-xs font-semibold text-muted">Checks · last run</div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-st-ok-soft px-2 py-0.5 font-semibold text-st-ok">{plural(goalsMet, "goal")} met</span>
        <span className="rounded-full bg-st-ok-soft px-2 py-0.5 font-semibold text-st-ok">{plural(delivMet, "deliverable")} met</span>
        {retries > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">{plural(retries, "retry").replace("retrys", "retries")}</span>
        )}
        {anyFailed && <span className="rounded-full bg-st-error-soft px-2 py-0.5 font-semibold text-st-error">attention</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount it on the dashboard.** In `DashboardPage.tsx`, add the import and render the card. Add after line 11:

```tsx
import { ChecksGlanceCard } from "./ChecksGlanceCard";
```
Inside the returned JSX, after the `<StatCard>` grid `</div>` (line 101), add — using the most recent run's id and the active project:

```tsx
      {pid && runs[0] && <ChecksGlanceCard pid={pid} runId={runs[0].id} />}
```
And read `pid` near the other `useStore` reads (line 44):
```tsx
  const pid = useStore((s) => s.activeProjectId);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && ./node_modules/.bin/vitest run src/dashboard`
Expected: PASS (new test + existing dashboard tests).

- [ ] **Step 6: Format/lint/typecheck**

Run: `cd web && ./node_modules/.bin/prettier --write src/dashboard/ChecksGlanceCard.tsx src/dashboard/ChecksGlanceCard.test.tsx src/dashboard/DashboardPage.tsx && ./node_modules/.bin/eslint src/dashboard/ChecksGlanceCard.tsx src/dashboard/ChecksGlanceCard.test.tsx src/dashboard/DashboardPage.tsx && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/src/dashboard/ChecksGlanceCard.tsx web/src/dashboard/ChecksGlanceCard.test.tsx web/src/dashboard/DashboardPage.tsx
git commit -m "feat(web): add checks glance card to dashboard"
```

---

### Task 12: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Run the entire web test suite**

Run: `cd web && ./node_modules/.bin/vitest run`
Expected: all tests PASS.

- [ ] **Step 2: Full lint + typecheck + format check**

Run: `cd web && ./node_modules/.bin/eslint src && npx tsc --noEmit && ./node_modules/.bin/prettier --check src`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional, requires gateway).** With `VITE_MOCK_POSTCONDITIONS` unset (default on), run `cd web && pnpm dev`, open Workflows (compiled IR view) → expect a `report` check node + amber rewind edge + `✓ goal has_sources` badge on `writer`; open a run → Timeline shows `check · report`, the inspector shows the attempt stepper; Dashboard shows the glance card.

- [ ] **Step 4: Final commit (if any formatting changed)**

```bash
git add -A && git commit -m "chore(web): format + verify deliverables/goals UI" || echo "nothing to commit"
```

---

## Self-review notes (author)

- **Spec coverage:** placement-C (canvas Tasks 4-7, runs Tasks 8-10, dashboard Task 11); grammar-C deliverable-node + goal-badge (Task 6); rewind edge R1 (Task 5); pair-highlight R2 as pure `applyChecksSelection` (Task 6/7); dual-channel R3 + redundant encoding R4 (Task 4); retries summary-on-node / detail-off-canvas R5 (Tasks 4, 8); inspect-only R6 + suppressed affordances R7 (Tasks 4, 5); build-error navigable R8 (Task 7); affirmative validated state R9 (`◇ validated`, Task 4); types mirror PR #340 with `bigint` min_count (Task 1); mock wiring + flag (Task 3). All spec sections map to a task.
- **Type consistency:** `WorkflowChecks`/`RunChecks`/`RunCheckResult`/`Check`/`BuildVerdict` names are identical across Tasks 1, 3, 6, 7, 8, 9, 11. Node type string `"check"`, edge type `"rewind"`, and `attrs.check_kind`/`attrs.check` are identical across Tasks 3, 4, 5, 6, 9, 10.
- **Known soft spots to confirm during execution (flagged, not placeholders):** the editor's selected-id state name (Task 7 Step 3), the store trace-load action name (Task 10), and the project's jest-dom matcher setup (Task 4 Step 5) must be matched to the real code — each step says so and gives the fallback.
```
