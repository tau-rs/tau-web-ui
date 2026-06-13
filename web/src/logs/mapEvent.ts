import type { Event } from "../types/Event";
import type { LogEntry, LogLevel } from "./types";

/** Safe string pull from a free-form payload (mirrors store.ts deltaText). */
function str(payload: unknown, key: string): string | undefined {
  if (typeof payload === "object" && payload !== null) {
    const v = (payload as Record<string, unknown>)[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

function toolErrored(payload: unknown): boolean {
  if (typeof payload === "object" && payload !== null) {
    const result = (payload as { result?: unknown }).result;
    if (typeof result === "object" && result !== null) {
      const r = result as { ok?: unknown; is_error?: unknown };
      return r.ok === false || r.is_error === true;
    }
  }
  return false;
}

/** Map a gateway Event to a presentation LogEntry. `index` disambiguates same-ts events. */
export function eventToLogEntry(e: Event, index: number): LogEntry {
  let level: LogLevel = "info";
  let label = e.kind;

  switch (e.kind) {
    case "text_delta":
      level = "debug";
      label = "assistant output";
      break;
    case "tool_started":
      level = "info";
      label = `▶ ${str(e.payload, "tool") ?? "tool"}`;
      break;
    case "tool_completed": {
      const errored = toolErrored(e.payload);
      level = errored ? "error" : "info";
      label = `${errored ? "✖" : "✔"} ${str(e.payload, "tool") ?? "tool"}`;
      break;
    }
    case "run_completed":
      level = "info";
      label = "run completed";
      break;
    case "fatal_error":
      level = "error";
      label = `fatal: ${str(e.payload, "variant") ?? str(e.payload, "tool_error_variant") ?? "error"}`;
      break;
    default:
      // unknown:* and any future kind
      level = e.kind.startsWith("unknown:") ? "warn" : "info";
      label = e.kind;
  }

  return {
    id: `${e.run_id}-${e.ts}-${e.span_id ?? "_"}-${index}`,
    ts: e.ts,
    level,
    source: e.run_id,
    kind: e.kind,
    label,
    detail: e.payload,
    runId: e.run_id,
    spanId: e.span_id,
  };
}
