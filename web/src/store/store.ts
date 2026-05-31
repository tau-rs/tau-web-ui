import { create } from "zustand";
import type { Run } from "../types/Run";
import type { Span } from "../types/Span";
import type { WsMessage } from "../types/WsMessage";
import {
  getProject,
  listRuns,
  launchRun,
  getTrace,
  cancelRun,
  openRunSocket,
  getHealth,
  type Project,
  type Health,
} from "../api/client";

interface TraceState {
  run: Run;
  spans: Span[];
}

interface AppStore {
  health: Health | null;
  project: Project | null;
  runs: Run[];
  currentTrace: TraceState | null;
  assistantText: string;
  selectedSpanId: string | null;
  socket: WebSocket | null;

  loadHealth: () => Promise<void>;
  loadProject: () => Promise<void>;
  refreshRuns: (filters?: { status?: string; agent?: string }) => Promise<void>;
  launch: (agent: string, prompt: string) => Promise<string>;
  openTrace: (id: string) => Promise<void>;
  closeTrace: () => void;
  cancelCurrent: () => Promise<void>;
  selectSpan: (id: string | null) => void;
  applyWs: (m: WsMessage) => void;
}

export const useStore = create<AppStore>((set, get) => ({
  health: null,
  project: null,
  runs: [],
  currentTrace: null,
  assistantText: "",
  selectedSpanId: null,
  socket: null,

  loadHealth: async () => {
    try {
      set({ health: await getHealth() });
    } catch {
      /* gateway unreachable — leave health null */
    }
  },
  loadProject: async () => set({ project: await getProject() }),
  refreshRuns: async (filters) => set({ runs: await listRuns(filters) }),

  launch: async (agent, prompt) => {
    const id = await launchRun(agent, prompt);
    await get().refreshRuns();
    return id;
  },

  openTrace: async (id) => {
    get().socket?.close();
    // Replay snapshot first (works even with no live engine — AC#5).
    const trace = await getTrace(id);
    set({ currentTrace: trace, assistantText: "", selectedSpanId: null });
    // If still running, attach live WS (snapshot from WS is idempotent with the REST one).
    if (trace.run.status === "running") {
      const ws = openRunSocket(id, (m) => get().applyWs(m));
      set({ socket: ws });
    } else {
      set({ socket: null });
    }
  },

  closeTrace: () => {
    get().socket?.close();
    set({ socket: null, currentTrace: null, assistantText: "" });
  },

  cancelCurrent: async () => {
    const id = get().currentTrace?.run.id;
    if (id) await cancelRun(id);
  },

  selectSpan: (id) => set({ selectedSpanId: id }),

  applyWs: (m) => {
    const state = get();
    switch (m.type) {
      case "snapshot":
        set({ currentTrace: { run: m.run, spans: m.spans }, assistantText: "" });
        break;
      case "span_update": {
        if (!state.currentTrace) return;
        const spans = upsert(state.currentTrace.spans, m.span);
        set({ currentTrace: { ...state.currentTrace, spans } });
        break;
      }
      case "event":
        if (m.event.kind === "text_delta") {
          const t = (m.event.payload as { text?: string }).text ?? "";
          set({ assistantText: state.assistantText + t });
        }
        break;
      case "run_update":
        if (state.currentTrace) {
          set({ currentTrace: { ...state.currentTrace, run: m.run } });
        }
        set({ runs: state.runs.map((r) => (r.id === m.run.id ? m.run : r)) });
        if (m.run.status !== "running") get().socket?.close();
        break;
    }
  },
}));

function upsert(spans: Span[], span: Span): Span[] {
  const i = spans.findIndex((s) => s.id === span.id);
  if (i === -1) return [...spans, span];
  const next = spans.slice();
  next[i] = span;
  return next;
}
