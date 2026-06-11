import type { WsMessage } from "../types/WsMessage";

/** Untrusted WS/backend JSON is validated here before it drives store state.
 *  Hand-written guards (no schema lib dependency) check the discriminant and
 *  the fields each variant's consumer actually reads, so a drifted or hostile
 *  frame is rejected instead of cast and applied blindly. */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// A Run/Span carries an `id`; a Run also carries a `status` the lifecycle reads.
const isRun = (v: unknown): boolean =>
  isRecord(v) && typeof v.id === "string" && typeof v.status === "string";
const isSpan = (v: unknown): boolean => isRecord(v) && typeof v.id === "string";
const isEvent = (v: unknown): boolean => isRecord(v) && typeof v.kind === "string";

/** Decode and validate one untrusted WS frame. Throws on malformed JSON, a
 *  non-tagged value, an unknown discriminant (protocol drift), or a known frame
 *  missing a required field — callers surface the failure rather than swallow it. */
export function parseWsMessage(data: string): WsMessage {
  const raw: unknown = JSON.parse(data);
  if (!isRecord(raw) || typeof raw.type !== "string") {
    throw new Error("WS frame is not a tagged object");
  }
  switch (raw.type) {
    case "snapshot":
      if (isRun(raw.run) && Array.isArray(raw.spans) && Array.isArray(raw.events)) {
        return raw as unknown as WsMessage;
      }
      break;
    case "span_update":
      if (isSpan(raw.span)) return raw as unknown as WsMessage;
      break;
    case "event":
      if (isEvent(raw.event)) return raw as unknown as WsMessage;
      break;
    case "run_update":
      if (isRun(raw.run)) return raw as unknown as WsMessage;
      break;
    default:
      throw new Error(`unknown WS frame type: ${raw.type}`);
  }
  throw new Error(`malformed WS frame: type=${raw.type}`);
}
