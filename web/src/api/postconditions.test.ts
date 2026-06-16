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
