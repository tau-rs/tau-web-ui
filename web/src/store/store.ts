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
  launch: (pid: string, agent: string, prompt: string) => Promise<string>;
  loadWorkflows: (pid: string) => Promise<void>;
  launchWorkflow: (pid: string, workflow: string, input: string) => Promise<string>;
  openTrace: (pid: string, id: string) => Promise<void>;
  closeTrace: () => void;
  cancelCurrent: (pid: string) => Promise<void>;
  selectSpan: (id: string | null) => void;
  applyWs: (m: WsMessage) => void;
}

function assistantTextFromEvents(events?: Event[]): string {
  return (events ?? [])
    .filter((e) => e.kind === "text_delta")
    .map((e) => (e.payload as { text?: string }).text ?? "")
    .join("");
}

export const useStore = create<AppStore>((set, get) => ({
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

  refreshRuns: async (pid, filters) => {
    try {
      set({ runs: await listRuns(pid, filters), runsLoaded: true, runsError: null });
    } catch (e) {
      // Record status for first-load UI, but preserve the throw-and-caller-catch contract.
      set({ runsLoaded: true, runsError: errorMessage(e) });
      throw e;
    }
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
      currentTrace: { run: trace.run, spans: trace.spans },
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
          currentTrace: { run: m.run, spans: m.spans },
          assistantText: assistantTextFromEvents(m.events),
        });
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
