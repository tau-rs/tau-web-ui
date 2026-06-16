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
