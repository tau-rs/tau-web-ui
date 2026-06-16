import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckVerdictPanel } from "./CheckVerdictPanel";
import type { RunCheckResult } from "../types/Postcondition";

const retry: RunCheckResult = {
  id: "report",
  kind: "deliverable",
  final: "met",
  rewound_to: "writer",
  attempts: [
    { attempt: 1, verdict: { met: false, rationale: "only 1 source cited; need >=2." } },
    { attempt: 2, verdict: { met: true, rationale: "cites 3 sources." } },
  ],
};
const goal: RunCheckResult = {
  id: "has_sources",
  kind: "goal",
  final: "met",
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
