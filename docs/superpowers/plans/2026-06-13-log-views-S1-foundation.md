# S1 — Log views foundation (contract + per-run Logs tab + failure detail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the per-run event stream the UI currently drops, via a reusable, source-agnostic `LogStream` component, and surface run failures prominently.

**Architecture:** A new `web/src/logs/` module holds the **frozen contract** (`types.ts`), a pure `eventToLogEntry` mapper, and the presentation-only `LogStream` component (client-side filtering, no fetching). The trace view mounts it via a small `RunLogs` container that maps `currentTrace.events`. `RunControls` gains a prominent failure block. **This session freezes `web/src/logs/types.ts` + `web/src/logs/mapEvent.ts`; sessions S3/S4/S5 import them unchanged.**

**Tech Stack:** React 18, TypeScript, zustand, vitest + @testing-library/react, Tailwind v4. Run all commands from `web/`.

**Read first:**
- Spec: `docs/superpowers/specs/2026-06-13-log-views-program-design.md` (§2 contract, §3 #1/#2)
- `web/src/store/store.ts:62-77,270-273` (how `text_delta` is mapped today; the pattern to generalize)
- `web/src/types/Event.ts`, `web/src/types/Run.ts`, `web/src/types/RunError.ts`
- `web/src/trace/TraceView.tsx`, `web/src/trace/Tabs.tsx`, `web/src/trace/RunControls.tsx`
- Test style: `web/src/trace/SpanInspector.test.tsx`

**Gateway payload shapes (verified `gateway/src/adapters/serve.rs:83-199`):**
- `text_delta` → `{ text: string }`
- `tool_started` → `{ tool, call_id, args }`
- `tool_completed` → `{ tool, call_id, result }` where error iff `result.ok === false || result.is_error === true`
- `run_completed` → serve payload (free-form)
- `fatal_error` → `{ ...variant/message }` (free-form; extract defensively)
- `unknown:*` → free-form payload

---

## Task 1: Freeze the contract (`web/src/logs/types.ts`)

**Files:**
- Create: `web/src/logs/types.ts`

- [ ] **Step 1: Write the contract file**

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Format + commit**

```bash
npx prettier --write src/logs/types.ts
git add src/logs/types.ts
git commit -m "feat(logs): freeze LogStream contract types"
```

---

## Task 2: Event → LogEntry mapper (`web/src/logs/mapEvent.ts`)

**Files:**
- Create: `web/src/logs/mapEvent.ts`
- Test: `web/src/logs/mapEvent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/logs/mapEvent.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/logs/mapEvent.test.ts`
Expected: FAIL — "Cannot find module './mapEvent'".

- [ ] **Step 3: Write the mapper**

```ts
// web/src/logs/mapEvent.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/logs/mapEvent.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Format + commit**

```bash
npx prettier --write src/logs/mapEvent.ts src/logs/mapEvent.test.ts
git add src/logs/mapEvent.ts src/logs/mapEvent.test.ts
git commit -m "feat(logs): add event-to-LogEntry mapper"
```

---

## Task 3: `LogStream` component (`web/src/logs/LogStream.tsx`)

**Files:**
- Create: `web/src/logs/LogStream.tsx`
- Test: `web/src/logs/LogStream.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/logs/LogStream.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LogStream } from "./LogStream";
import type { LogEntry } from "./types";

const entries: LogEntry[] = [
  { id: "1", ts: "t1", level: "info", source: "R1", kind: "tool_started", label: "▶ fs-read" },
  { id: "2", ts: "t2", level: "error", source: "R1", kind: "fatal_error", label: "fatal: Timeout" },
  { id: "3", ts: "t3", level: "debug", source: "R1", kind: "text_delta", label: "assistant output" },
];

describe("LogStream", () => {
  it("renders info and error entries but hides debug by default", () => {
    render(<LogStream entries={entries} />);
    expect(screen.getByText("▶ fs-read")).toBeInTheDocument();
    expect(screen.getByText("fatal: Timeout")).toBeInTheDocument();
    expect(screen.queryByText("assistant output")).not.toBeInTheDocument();
  });

  it("filters by full-text query", () => {
    render(<LogStream entries={entries} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "fatal" } });
    expect(screen.queryByText("▶ fs-read")).not.toBeInTheDocument();
    expect(screen.getByText("fatal: Timeout")).toBeInTheDocument();
  });

  it("toggles a level filter off", () => {
    render(<LogStream entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: /error/i }));
    expect(screen.queryByText("fatal: Timeout")).not.toBeInTheDocument();
  });

  it("calls onEntryClick when a row is clicked", () => {
    const onEntryClick = vi.fn();
    render(<LogStream entries={entries} onEntryClick={onEntryClick} />);
    fireEvent.click(screen.getByText("▶ fs-read"));
    expect(onEntryClick).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
  });

  it("shows an empty state when nothing matches", () => {
    render(<LogStream entries={[]} />);
    expect(screen.getByText(/no log entries/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/logs/LogStream.test.tsx`
Expected: FAIL — "Cannot find module './LogStream'".

- [ ] **Step 3: Write the component**

```tsx
// web/src/logs/LogStream.tsx
import { useMemo, useState } from "react";
import { ALL_LEVELS, DEFAULT_FILTERS } from "./types";
import type { LogEntry, LogFilterState, LogLevel, LogStreamProps } from "./types";

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: "text-muted",
  info: "text-fg",
  warn: "text-st-cancelled",
  error: "text-st-error",
};

function matches(e: LogEntry, f: LogFilterState): boolean {
  if (!f.levels.includes(e.level)) return false;
  if (f.kinds.length > 0 && !f.kinds.includes(e.kind)) return false;
  if (f.query) {
    const hay = `${e.label} ${JSON.stringify(e.detail ?? "")}`.toLowerCase();
    if (!hay.includes(f.query.toLowerCase())) return false;
  }
  return true;
}

export function LogStream({ entries, filters, onFiltersChange, onEntryClick }: LogStreamProps) {
  // Uncontrolled fallback when the host doesn't own filter state.
  const [internal, setInternal] = useState<LogFilterState>(DEFAULT_FILTERS);
  const f = filters ?? internal;
  const setF = (next: LogFilterState) => (onFiltersChange ? onFiltersChange(next) : setInternal(next));

  const toggleLevel = (lvl: LogLevel) =>
    setF({ ...f, levels: f.levels.includes(lvl) ? f.levels.filter((l) => l !== lvl) : [...f.levels, lvl] });

  const shown = useMemo(() => entries.filter((e) => matches(e, f)), [entries, f]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {ALL_LEVELS.map((lvl) => (
          <button
            key={lvl}
            onClick={() => toggleLevel(lvl)}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              f.levels.includes(lvl) ? "bg-accent text-accent-fg" : "border border-border text-muted"
            }`}
          >
            {lvl}
          </button>
        ))}
        <input
          className="ml-auto rounded-md border border-border bg-surface px-2 py-1 text-xs"
          placeholder="Search logs…"
          value={f.query}
          onChange={(e) => setF({ ...f, query: e.target.value })}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto font-mono text-xs">
        {shown.length === 0 ? (
          <p className="p-4 text-muted">No log entries.</p>
        ) : (
          <ul>
            {shown.map((e) => (
              <li
                key={e.id}
                onClick={() => onEntryClick?.(e)}
                className="flex cursor-pointer gap-3 border-b border-border px-3 py-1.5 hover:bg-bg"
              >
                <span className="shrink-0 text-muted">{e.ts}</span>
                <span className={`shrink-0 uppercase ${LEVEL_CLASS[e.level]}`}>{e.level}</span>
                <span className="truncate">{e.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/logs/LogStream.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Format + commit**

```bash
npx prettier --write src/logs/LogStream.tsx src/logs/LogStream.test.tsx
git add src/logs/LogStream.tsx src/logs/LogStream.test.tsx
git commit -m "feat(logs): add source-agnostic LogStream component"
```

---

## Task 4: `RunLogs` container + Logs tab in `TraceView`

**Files:**
- Create: `web/src/trace/RunLogs.tsx`
- Modify: `web/src/trace/TraceView.tsx` (tab union + tab list + render branch)
- Test: `web/src/trace/RunLogs.test.tsx`

- [ ] **Step 1: Write the failing test for RunLogs**

```tsx
// web/src/trace/RunLogs.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RunLogs } from "./RunLogs";
import type { Event } from "../types/Event";

const events: Event[] = [
  { run_id: "R1", span_id: "s1", ts: "t1", kind: "tool_started", payload: { tool: "fs-read" } },
  { run_id: "R1", span_id: null, ts: "t2", kind: "fatal_error", payload: { variant: "Timeout" } },
];

describe("RunLogs", () => {
  it("renders mapped event entries", () => {
    render(<RunLogs events={events} />);
    expect(screen.getByText("▶ fs-read")).toBeInTheDocument();
    expect(screen.getByText("fatal: Timeout")).toBeInTheDocument();
  });

  it("renders empty state with no events", () => {
    render(<RunLogs events={[]} />);
    expect(screen.getByText(/no log entries/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/trace/RunLogs.test.tsx`
Expected: FAIL — "Cannot find module './RunLogs'".

- [ ] **Step 3: Write RunLogs**

```tsx
// web/src/trace/RunLogs.tsx
import { useMemo } from "react";
import type { Event } from "../types/Event";
import { LogStream } from "../logs/LogStream";
import { eventToLogEntry } from "../logs/mapEvent";
import { useStore } from "../store/store";

export function RunLogs({ events, live }: { events: Event[]; live?: boolean }) {
  const selectSpan = useStore((s) => s.selectSpan);
  const entries = useMemo(() => events.map((e, i) => eventToLogEntry(e, i)), [events]);
  return (
    <LogStream
      entries={entries}
      live={live}
      onEntryClick={(e) => e.spanId && selectSpan(e.spanId)}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/trace/RunLogs.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Store the trace events so the tab can read them**

`store.ts` keeps `assistantText` but discards the raw events. Add an `events: Event[]` field to `TraceState` and populate it in `openTrace` and `applyWs`.

Modify `web/src/store/store.ts`:

In `interface TraceState` (line 23-26):
```ts
interface TraceState {
  run: Run;
  spans: Span[];
  events: Event[];
}
```

In `openTrace` `set(...)` (line 229-233), add `events`:
```ts
      set({
        currentTrace: { run: trace.run, spans: trace.spans, events: trace.events ?? [] },
        assistantText: assistantTextFromEvents(trace.events),
        selectedSpanId: null,
      });
```

In `applyWs` `case "snapshot"` (line 258-263):
```ts
        case "snapshot":
          set({
            currentTrace: { run: m.run, spans: m.spans, events: m.events },
            assistantText: assistantTextFromEvents(m.events),
          });
          break;
```

In `applyWs` `case "event"` (line 270-274) — append every event (not just text_delta):
```ts
        case "event":
          if (state.currentTrace) {
            set({
              currentTrace: {
                ...state.currentTrace,
                events: [...state.currentTrace.events, m.event],
              },
            });
          }
          if (m.event.kind === "text_delta") {
            set({ assistantText: state.assistantText + deltaText(m.event.payload) });
          }
          break;
```

In `case "span_update"` and `case "run_update"`, the `{ ...state.currentTrace, ... }` spreads already carry `events` forward — no change needed.

- [ ] **Step 6: Run the store tests to verify nothing broke**

Run: `npx vitest run src/store`
Expected: PASS. If a store test constructs a `TraceState`/snapshot literal without `events`, add `events: []` to it.

- [ ] **Step 7: Write the failing TraceView tab test**

```tsx
// add to web/src/trace/TraceView.test.tsx (create if absent; see imports below)
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TraceView } from "./TraceView";
import { useStore } from "../store/store";

function seed() {
  useStore.setState({
    currentTrace: {
      run: {
        id: "R1", agent_id: "greeter", prompt: "hi", substrate: "host", mode: "dev",
        status: "completed", started_at: "t", ended_at: "t2", total_turns: 1,
        token_usage: null, stop_reason: null, error: null, source: "serve",
      },
      spans: [],
      events: [{ run_id: "R1", span_id: "s1", ts: "t1", kind: "tool_started", payload: { tool: "fs-read" } }],
    },
    selectedSpanId: null,
  });
}

describe("TraceView Logs tab", () => {
  beforeEach(seed);
  it("shows the event stream when the Logs tab is selected", () => {
    render(<MemoryRouter><TraceView /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Logs" }));
    expect(screen.getByText("▶ fs-read")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run src/trace/TraceView.test.tsx`
Expected: FAIL — no "Logs" tab button exists yet.

- [ ] **Step 9: Add the Logs tab to TraceView**

Modify `web/src/trace/TraceView.tsx`:

Change the tab union (line 11):
```ts
type TraceTab = "graph" | "timeline" | "logs";
```

Import RunLogs (after the other imports near line 8):
```ts
import { RunLogs } from "./RunLogs";
```

Add to the `tabs` array (line 41-44):
```tsx
            tabs={[
              { id: "graph", label: "Agents" },
              { id: "timeline", label: "Timeline" },
              { id: "logs", label: "Logs" },
            ]}
```

Change the render branch (line 56-60) from a ternary to handle three tabs:
```tsx
          {tab === "graph" ? (
            <AgentMap spans={trace.spans} run={trace.run} />
          ) : tab === "timeline" ? (
            <TraceTimeline spans={trace.spans} />
          ) : (
            <RunLogs events={trace.events} live={trace.run.status === "running"} />
          )}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run src/trace/TraceView.test.tsx src/trace/RunLogs.test.tsx`
Expected: PASS.

- [ ] **Step 11: Format + commit**

```bash
npx prettier --write src/trace/RunLogs.tsx src/trace/RunLogs.test.tsx src/trace/TraceView.tsx src/trace/TraceView.test.tsx src/store/store.ts
git add src/trace/RunLogs.tsx src/trace/RunLogs.test.tsx src/trace/TraceView.tsx src/trace/TraceView.test.tsx src/store/store.ts
git commit -m "feat(logs): add per-run Logs tab to trace view"
```

---

## Task 5: Prominent run-failure detail in `RunControls` (#2)

**Files:**
- Modify: `web/src/trace/RunControls.tsx`
- Test: `web/src/trace/RunControls.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/trace/RunControls.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunControls } from "./RunControls";
import { useStore } from "../store/store";

const failedRun = {
  id: "R1", agent_id: "greeter", prompt: "hi", substrate: "host", mode: "dev",
  status: "failed" as const, started_at: "t", ended_at: "t2", total_turns: 1,
  token_usage: null, stop_reason: null,
  error: { kind: "FatalError", detail: "tool timed out after 30s" },
  source: "serve" as const,
};

describe("RunControls failure detail", () => {
  beforeEach(() => {
    useStore.setState({ currentTrace: { run: failedRun, spans: [], events: [] } });
  });
  it("shows the error kind and detail prominently when the run failed", () => {
    render(<MemoryRouter><RunControls /></MemoryRouter>);
    expect(screen.getByText(/FatalError/)).toBeInTheDocument();
    expect(screen.getByText(/tool timed out after 30s/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/trace/RunControls.test.tsx`
Expected: FAIL — `run.error.detail` is not rendered today (only `kind` is, inline).

- [ ] **Step 3: Add the failure block**

Modify `web/src/trace/RunControls.tsx`. Wrap the existing flex row in a fragment and add a failure block below it. Replace the `return (...)` body:

```tsx
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-3 py-2">
        <StatusBadge status={run.status} />
        <span className="text-xs text-muted">turns: {run.total_turns ?? "—"}</span>
        <span className="text-xs text-muted">
          {formatTokens(run)}
          {run.token_usage ? ` (${formatTokenSplit(run)})` : ""}
        </span>
        <span className="text-xs text-muted">{formatDuration(run)}</span>
        {run.stop_reason && run.status === "completed" && (
          <span className="text-xs text-muted">stop: {run.stop_reason}</span>
        )}
        {run.status === "running" && (
          <button
            onClick={() => cancel(pid)}
            className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs hover:bg-bg"
          >
            Cancel
          </button>
        )}
      </div>
      {run.error && (
        <div className="border-b border-st-error/30 bg-st-error-soft px-3 py-2">
          <p className="text-xs font-semibold text-st-error">Run failed · {run.error.kind}</p>
          {run.error.detail && (
            <p className="mt-0.5 break-words text-xs text-st-error">{run.error.detail}</p>
          )}
        </div>
      )}
    </>
  );
```

(Removes the old inline `{run.error && <span … error: {run.error.kind}</span>}`, replaced by the block above.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/trace/RunControls.test.tsx`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
npx prettier --write src/trace/RunControls.tsx src/trace/RunControls.test.tsx
git add src/trace/RunControls.tsx src/trace/RunControls.test.tsx
git commit -m "feat(logs): surface run failure detail in run controls"
```

---

## Task 6: Final gate

- [ ] **Step 1: Full check**

Run (from `web/`):
```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npx prettier --check src/logs src/trace src/store
```
Expected: all PASS.

- [ ] **Step 2: Confirm `st-error-soft` / `st-cancelled` classes exist**

The failure block uses `bg-st-error-soft` and LogStream uses `text-st-cancelled`. Confirm these map to the CSS vars in `web/src/index.css` / tailwind config (`--status-error-soft`, `--status-cancelled` exist). If the Tailwind name differs, adjust the class to the project's convention (grep existing usages: `grep -rn "st-error-soft\|st-cancelled" src`).

---

## Self-review notes (already applied)
- Contract names (`LogEntry`, `LogFilterState`, `LogStreamProps`, `eventToLogEntry`) are consistent across Tasks 1-4.
- `text_delta` open question resolved: mapped to `debug`, hidden by `DEFAULT_FILTERS`, re-enabled via the `debug` level toggle.
- Every code step shows complete code; commands have expected output.

## Next step (print this on completion)

> ✅ **S1 complete.** Contract frozen at `web/src/logs/types.ts` + `web/src/logs/mapEvent.ts`; reusable `LogStream` shipped; per-run Logs tab + failure detail live.
> **Unblocked:** S3 (project feed), S4 (build logs), S5 (gateway log) — all import the frozen contract and can now run **in parallel**, each in its own session.
> **Open three sessions** with: `docs/superpowers/plans/2026-06-13-log-views-S3-project-feed.md`, `…-S4-build-logs.md`, `…-S5-gateway-log.md`.
> S2 (toasts) is independent and may already be merged. S6 (Issues) waits for S3.
