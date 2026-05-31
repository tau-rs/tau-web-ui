import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpanInspector } from "./SpanInspector";
import type { Span } from "../types/Span";

const span: Span = {
  id: "s1",
  parent_id: null,
  run_id: "R1",
  kind: "tool_call",
  name: "fs-read",
  status: "ok",
  started_at: "t",
  ended_at: "t2",
  attributes: { args: { path: "/x" }, result: { ok: true } },
};

describe("SpanInspector", () => {
  it("renders the selected span's name, args and result", () => {
    render(<SpanInspector span={span} />);
    expect(screen.getByText("fs-read")).toBeInTheDocument();
    expect(screen.getByText(/"path": "\/x"/)).toBeInTheDocument();
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
  });

  it("prompts when nothing is selected", () => {
    render(<SpanInspector span={null} />);
    expect(screen.getByText(/select a node/i)).toBeInTheDocument();
  });

  it("shows the gated agent-drill for a workflow agent step", () => {
    const span = {
      id: "s",
      parent_id: null,
      run_id: "R",
      kind: "agent",
      name: "gather",
      status: "ok",
      started_at: "t",
      ended_at: "t2",
      attributes: { input: "hi", output: "done" },
    } as unknown as import("../types/Span").Span;
    render(<SpanInspector span={span} workflow />);
    expect(screen.getByText(/view agent trace/i)).toBeInTheDocument();
    expect(screen.getByText(/gated/i)).toBeInTheDocument();
  });

  it("no drill for a normal agent-run trace", () => {
    const span = {
      id: "s",
      parent_id: null,
      run_id: "R",
      kind: "agent",
      name: "x",
      status: "ok",
      started_at: "t",
      ended_at: "t2",
      attributes: {},
    } as unknown as import("../types/Span").Span;
    render(<SpanInspector span={span} />);
    expect(screen.queryByText(/view agent trace/i)).toBeNull();
  });
});
