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
