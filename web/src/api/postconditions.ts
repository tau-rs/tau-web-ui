import type { Check, BuildVerdict, RunCheckResult } from "../types/Postcondition";
import type { Span } from "../types/Span";
import type { SpanStatus } from "../types/SpanStatus";
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
  return request<WorkflowChecks>(
    scopedPath(pid, `/workflows/${encodeURIComponent(workflowId)}/checks`),
  );
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
    kind: "tool_call" as const, // valid SpanKind member
    name: `check · ${r.id}`,
    status: (r.final === "met" ? "ok" : "error") as SpanStatus,
    started_at: "1970-01-01T00:00:00Z",
    ended_at: "1970-01-01T00:00:01Z",
    attributes: { check_kind: r.kind, check: r },
  }));
}
