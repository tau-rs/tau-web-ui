// web/src/logs/types.ts
// FROZEN CONTRACT — consumed by S3/S4/S5. Additive changes only; do not rename.
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /** Stable React key. */
  id: string;
  /** ISO timestamp. */
  ts: string;
  level: LogLevel;
  /** Origin of the entry: a run id, "build", "gateway", etc. */
  source: string;
  /** Original event kind / category (used by the kind filter). */
  kind: string;
  /** One-line human summary shown in the row. */
  label: string;
  /** Expandable structured payload. */
  detail?: unknown;
  /** For "jump to trace"/span selection. */
  runId?: string;
  spanId?: string | null;
}

export interface LogFilterState {
  levels: LogLevel[];
  kinds: string[];
  query: string;
}

export const ALL_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/** Default filter: hide debug (assistant text deltas) until toggled on. */
export const DEFAULT_FILTERS: LogFilterState = {
  levels: ["info", "warn", "error"],
  kinds: [],
  query: "",
};

export interface LogStreamProps {
  entries: LogEntry[];
  /** Controlled filter state; if omitted, LogStream manages its own. */
  filters?: LogFilterState;
  onFiltersChange?: (f: LogFilterState) => void;
  /** Host decides navigation when a row is clicked. */
  onEntryClick?: (e: LogEntry) => void;
  /** Show a "tailing" affordance + autoscroll to newest. */
  live?: boolean;
}
