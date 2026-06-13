import { describe, it, expect } from "vitest";
import { eventToLogEntry } from "./mapEvent";
import type { Event } from "../types/Event";

const base = { run_id: "R1", span_id: "sp1", ts: "2026-06-13T00:00:00Z" };
const ev = (kind: string, payload: unknown): Event => ({ ...base, kind, payload });

describe("eventToLogEntry", () => {
  it("maps text_delta to a debug entry", () => {
    const e = eventToLogEntry(ev("text_delta", { text: "hi" }), 0);
    expect(e.level).toBe("debug");
    expect(e.runId).toBe("R1");
    expect(e.id).toContain("R1");
  });

  it("maps tool_started to info with the tool name", () => {
    const e = eventToLogEntry(ev("tool_started", { tool: "fs-read", call_id: "c1", args: {} }), 1);
    expect(e.level).toBe("info");
    expect(e.label).toContain("fs-read");
  });

  it("maps a successful tool_completed to info", () => {
    const e = eventToLogEntry(ev("tool_completed", { tool: "fs-read", result: { ok: true } }), 2);
    expect(e.level).toBe("info");
  });

  it("maps a failed tool_completed to error", () => {
    const e = eventToLogEntry(ev("tool_completed", { tool: "fs-read", result: { ok: false } }), 3);
    expect(e.level).toBe("error");
    const e2 = eventToLogEntry(ev("tool_completed", { tool: "x", result: { is_error: true } }), 4);
    expect(e2.level).toBe("error");
  });

  it("maps fatal_error to error and surfaces a message", () => {
    const e = eventToLogEntry(ev("fatal_error", { variant: "Timeout", message: "boom" }), 5);
    expect(e.level).toBe("error");
    expect(e.label.toLowerCase()).toContain("fatal");
  });

  it("maps unknown:* kinds to warn without throwing", () => {
    const e = eventToLogEntry(ev("unknown:SomeFutureKind", { a: 1 }), 6);
    expect(e.level).toBe("warn");
    expect(e.kind).toBe("unknown:SomeFutureKind");
  });

  it("produces unique ids for same-ts events via index", () => {
    const a = eventToLogEntry(ev("run_completed", {}), 0);
    const b = eventToLogEntry(ev("run_completed", {}), 1);
    expect(a.id).not.toBe(b.id);
  });
});
