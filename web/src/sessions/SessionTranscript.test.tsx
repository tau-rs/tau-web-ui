import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionTranscript } from "./SessionTranscript";
import type { SessionDetail } from "../types/SessionDetail";

const detail: SessionDetail = {
  header: {
    id: "018f5a2c-0000-0000-0000-000000000001",
    created_at: "2026-06-12T14:33:21Z",
    agent_id: "coder",
    llm_backend: "anthropic",
    package: { name: "my-agent", version: "1.0.0", resolved_commit: "0".repeat(40) },
  },
  messages: [
    { from: "user", payload: { text: "hello there" } },
    { kind: "tool_call", tool: "fs.read", path: "src/lexer.rs" },
  ],
  turn_summaries: [{ turn: 1, stop_reason: "EndTurn", input_tokens: 1840n, output_tokens: 210n }],
};

describe("SessionTranscript", () => {
  it("renders recognizable message text", () => {
    render(<SessionTranscript detail={detail} />);
    expect(screen.getByText("hello there")).toBeInTheDocument();
  });

  it("falls back to JSON for an unrecognized message shape", () => {
    render(<SessionTranscript detail={detail} />);
    expect(screen.getByText(/"tool": "fs.read"/)).toBeInTheDocument();
  });

  it("renders a turn-summary divider with stop reason and tokens", () => {
    render(<SessionTranscript detail={detail} />);
    expect(screen.getByText(/EndTurn/)).toBeInTheDocument();
    expect(screen.getByText(/1840 in/)).toBeInTheDocument();
  });
});
