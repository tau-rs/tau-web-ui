import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpanInspector } from "./SpanInspector";
import type { Span } from "../types/Span";

const checkSpan: Span = {
  id: "check-report",
  parent_id: null,
  run_id: "r1",
  kind: "tool_call",
  name: "check · report",
  status: "ok",
  started_at: "x",
  ended_at: "y",
  attributes: {
    check_kind: "deliverable",
    check: {
      id: "report",
      kind: "deliverable",
      final: "met",
      rewound_to: "writer",
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
