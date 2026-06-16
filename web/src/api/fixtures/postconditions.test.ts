import { describe, it, expect } from "vitest";
import {
  RESEARCH_CHECKS,
  RESEARCH_BUILD,
  RUN_RETRY_MET,
  BUILD_ERROR_CHECKS,
} from "./postconditions";

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
