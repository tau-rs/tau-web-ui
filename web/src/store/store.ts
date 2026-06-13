import { create } from "zustand";
import type { Event } from "../types/Event";
import type { Run } from "../types/Run";
import type { Span } from "../types/Span";
import type { WsMessage } from "../types/WsMessage";
import {
  getProject,
  listRuns,
  launchRun,
  getWorkflows,
  launchWorkflow,
  getTrace,
  cancelRun,
  openRunSocket,
  getHealth,
  type Project,
  type Health,
} from "../api/client";
import { listProjects } from "../api/projects";
import type { ProjectListItem } from "../types/ProjectListItem";
import { errorMessage } from "../notify/notify";

interface TraceState {
  run: Run;
  spans: Span[];
  events: Event[];
}

interface AppStore {
  health: Health | null;
  healthError: string | null;
  healthCheckedAt: number | null;
  project: Project | null;
  runs: Run[];
  runsLoaded: boolean;
  runsError: string | null;
  workflows: string[];
  currentTrace: TraceState | null;
  assistantText: string;
  selectedSpanId: string | null;
  socket: WebSocket | null;
  activeProjectId: string;
  projects: ProjectListItem[];
  setActiveProject: (pid: string) => void;
  loadProjects: () => Promise<void>;

  loadHealth: (pid: string) => Promise<void>;
  loadProject: (pid: string) => Promise<void>;
  refreshRuns: (pid: string, filters?: { status?: string; agent?: string }) => Promise<void>;
  /** Subscribe to live runs polling. The first subscriber starts one shared,
   *  visibility-paused, error-backoff interval; returns an unsubscribe fn. */
  subscribeRuns: (pid: string, ms?: number) => () => void;
  launch: (pid: string, agent: string, prompt: string) => Promise<string>;
  loadWorkflows: (pid: string) => Promise<void>;
  launchWorkflow: (pid: string, workflow: string, input: string) => Promise<string>;
  openTrace: (pid: string, id: string) => Promise<void>;
  closeTrace: () => void;
  cancelCurrent: (pid: string) => Promise<void>;
  selectSpan: (id: string | null) => void;
  applyWs: (m: WsMessage) => void;
}

/** Safely pull the delta text out of an Event's free-form (`unknown`) payload,
 *  without trusting the shape — a non-`{ text: string }` payload yields "". */
function deltaText(payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const text = (payload as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return "";
}

function assistantTextFromEvents(events?: Event[]): string {
  return (events ?? [])
    .filter((e) => e.kind === "text_delta")
    .map((e) => deltaText(e.payload))
    .join("");
}

export const useStore = create<AppStore>((set, get) => {
  // --- runs polling bookkeeping (non-reactive: must not trigger re-renders) ---
  let runsInFlight: Promise<void> | null = null;
  let pollers = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let pollPid = "";
  let pollMs = 5000;
  const MAX_BACKOFF_MS = 60_000;

  const nextDelay = () =>
    failures === 0 ? pollMs : Math.min(pollMs * 2 ** failures, MAX_BACKOFF_MS);

  const scheduleNext = (delay: number) => {
    timer = setTimeout(runTick, delay);
  };

  async function runTick() {
    timer = null;
    if (typeof document !== "undefined" && document.hidden) {
      // Paused while hidden — re-check at base interval (not nextDelay): any
      // accumulated `failures` are preserved, so on refocus we still respect
      // the current backoff rather than hammering a known-failing gateway.
      scheduleNext(pollMs);
      return;
    }
    try {
      await get().refreshRuns(pollPid);
      failures = 0;
    } catch {
      failures += 1;
    }
    if (pollers > 0) scheduleNext(nextDelay());
  }

  const onVisible = () => {
    // Refresh promptly when the tab is refocused. Only acts when a timer is
    // pending (never mid-tick, since runTick nulls `timer` on entry); if a
    // refresh is already in flight, the in-flight guard coalesces this tick.
    if (pollers > 0 && !document.hidden && timer !== null) {
      clearTimeout(timer);
      void runTick();
    }
  };

  return {
    health: null,
    healthError: null,
    healthCheckedAt: null,
    project: null,
    runs: [],
    runsLoaded: false,
    runsError: null,
    workflows: [],
    currentTrace: null,
    assistantText: "",
    selectedSpanId: null,
    socket: null,
    activeProjectId: "",
    projects: [],

    loadHealth: async (pid) => {
      try {
        set({ health: await getHealth(pid), healthError: null, healthCheckedAt: Date.now() });
      } catch (e) {
        // Keep the last snapshot + contact time; record why the latest contact failed.
        set({ healthError: errorMessage(e) });
      }
    },
    loadProject: async (pid) => set({ project: await getProject(pid) }),

    setActiveProject: (pid) => set({ activeProjectId: pid }),
    loadProjects: async () => {
      try {
        set({ projects: await listProjects() });
      } catch {
        /* gateway unreachable — leave projects as-is */
      }
    },

    // Coalesces overlapping calls onto one fetch so a slow response can't be
    // clobbered by the next poll tick. Callers in flight at the same time are
    // assumed to share (pid, filters) — true today: the poller is the only
    // repeat caller, and `launch`/`launchWorkflow` await this only to best-effort
    // refresh the list (they navigate to the trace view, which loads its own
    // data), so a coalesced-stale list self-heals on the next tick.
    refreshRuns: (pid, filters) => {
      if (runsInFlight) return runsInFlight; // dedup overlapping calls
      runsInFlight = listRuns(pid, filters)
        .then((runs) => void set({ runs, runsLoaded: true, runsError: null }))
        .catch((e) => {
          // Record status for first-load UI, then rethrow so the poll tick backs off.
          set({ runsLoaded: true, runsError: errorMessage(e) });
          throw e;
        })
        .finally(() => {
          runsInFlight = null;
        });
      return runsInFlight;
    },

    subscribeRuns: (pid, ms = 5000) => {
      pollPid = pid;
      pollMs = ms;
      pollers += 1;
      if (pollers === 1) {
        failures = 0;
        if (typeof document !== "undefined") {
          document.addEventListener("visibilitychange", onVisible);
        }
        scheduleNext(0); // immediate first tick (honours the hidden check)
      }
      return () => {
        pollers -= 1;
        if (pollers === 0) {
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          failures = 0;
          if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", onVisible);
          }
        }
      };
    },

    launch: async (pid, agent, prompt) => {
      const id = await launchRun(pid, agent, prompt);
      await get().refreshRuns(pid);
      return id;
    },

    loadWorkflows: async (pid) => {
      try {
        set({ workflows: await getWorkflows(pid) });
      } catch {
        /* ignore */
      }
    },
    launchWorkflow: async (pid, workflow, input) => {
      const id = await launchWorkflow(pid, workflow, input);
      await get().refreshRuns(pid);
      return id;
    },

    openTrace: async (pid, id) => {
      get().socket?.close();
      // Replay snapshot first (works even with no live engine — AC#5).
      const trace = await getTrace(pid, id);
      set({
        currentTrace: { run: trace.run, spans: trace.spans, events: trace.events ?? [] },
        assistantText: assistantTextFromEvents(trace.events),
        selectedSpanId: null,
      });
      // If still running, attach live WS (snapshot from WS is idempotent with the REST one).
      if (trace.run.status === "running") {
        const ws = openRunSocket(pid, id, (m) => get().applyWs(m));
        set({ socket: ws });
      } else {
        set({ socket: null });
      }
    },

    closeTrace: () => {
      get().socket?.close();
      set({ socket: null, currentTrace: null, assistantText: "" });
    },

    cancelCurrent: async (pid) => {
      const id = get().currentTrace?.run.id;
      if (id) await cancelRun(pid, id);
    },

    selectSpan: (id) => set({ selectedSpanId: id }),

    applyWs: (m) => {
      const state = get();
      switch (m.type) {
        case "snapshot":
          set({
            currentTrace: { run: m.run, spans: m.spans, events: m.events },
            assistantText: assistantTextFromEvents(m.events),
          });
          break;
        case "span_update": {
          if (!state.currentTrace) return;
          const spans = upsert(state.currentTrace.spans, m.span);
          set({ currentTrace: { ...state.currentTrace, spans } });
          break;
        }
        case "event": {
          if (state.currentTrace) {
            const events = [...state.currentTrace.events, m.event];
            set({
              currentTrace: { ...state.currentTrace, events },
              ...(m.event.kind === "text_delta"
                ? { assistantText: state.assistantText + deltaText(m.event.payload) }
                : {}),
            });
          } else if (m.event.kind === "text_delta") {
            // No active trace yet — preserve the original behavior of still
            // accumulating assistant text.
            set({ assistantText: state.assistantText + deltaText(m.event.payload) });
          }
          break;
        }
        case "run_update":
          if (state.currentTrace) {
            set({ currentTrace: { ...state.currentTrace, run: m.run } });
          }
          set({ runs: state.runs.map((r) => (r.id === m.run.id ? m.run : r)) });
          // Terminal status: close the live socket AND drop the reference, so a
          // later closeTrace() can't double-close a stale socket (mirrors openTrace).
          if (m.run.status !== "running") {
            get().socket?.close();
            set({ socket: null });
          }
          break;
      }
    },
  };
});

function upsert(spans: Span[], span: Span): Span[] {
  const i = spans.findIndex((s) => s.id === span.id);
  if (i === -1) return [...spans, span];
  const next = spans.slice();
  next[i] = span;
  return next;
}
