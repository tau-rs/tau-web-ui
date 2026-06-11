import { describe, it, expect } from "vitest";
import { parseWsMessage } from "./wsMessage";
import type { WsMessage } from "../types/WsMessage";

const run = { id: "R1", status: "running" };
const span = { id: "s1", run_id: "R1" };

describe("parseWsMessage (runtime validation of untrusted frames)", () => {
  it("accepts a well-formed snapshot frame", () => {
    const m = parseWsMessage(JSON.stringify({ type: "snapshot", run, spans: [span], events: [] }));
    expect(m.type).toBe("snapshot");
  });

  it("accepts a well-formed span_update frame", () => {
    const m = parseWsMessage(JSON.stringify({ type: "span_update", span }));
    expect(m.type).toBe("span_update");
  });

  it("accepts a well-formed event frame", () => {
    const event = { run_id: "R1", span_id: null, ts: "t", kind: "text_delta", payload: {} };
    const m = parseWsMessage(JSON.stringify({ type: "event", event }));
    expect(m.type).toBe("event");
  });

  it("accepts a well-formed run_update frame", () => {
    const m = parseWsMessage(JSON.stringify({ type: "run_update", run }));
    expect(m.type).toBe("run_update");
  });

  it("throws on non-JSON input rather than silently dropping it", () => {
    expect(() => parseWsMessage("not json{")).toThrow();
  });

  it("throws on a JSON value that is not a tagged object", () => {
    expect(() => parseWsMessage(JSON.stringify(["snapshot"]))).toThrow();
    expect(() => parseWsMessage(JSON.stringify("snapshot"))).toThrow();
    expect(() => parseWsMessage(JSON.stringify(null))).toThrow();
  });

  it("throws on an unknown discriminant (protocol drift is surfaced)", () => {
    expect(() => parseWsMessage(JSON.stringify({ type: "bogus", run }))).toThrow(/bogus/);
  });

  it("throws when a known frame is missing its required field", () => {
    expect(() => parseWsMessage(JSON.stringify({ type: "snapshot", run }))).toThrow();
    expect(() => parseWsMessage(JSON.stringify({ type: "span_update" }))).toThrow();
    expect(() =>
      parseWsMessage(JSON.stringify({ type: "run_update", run: { id: "R1" } })),
    ).toThrow();
  });

  it("returns a value assignable to WsMessage", () => {
    const m: WsMessage = parseWsMessage(JSON.stringify({ type: "run_update", run }));
    expect(m).toBeTruthy();
  });
});
