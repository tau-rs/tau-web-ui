import type { Event } from "../types/Event";
import type { Run } from "../types/Run";
import type { Span } from "../types/Span";
import type { WsMessage } from "../types/WsMessage";

export interface Project {
  project_path: string;
  agents: string[];
  tau_version: string;
}
export interface Health {
  gateway_ok: boolean;
  tau_bin: string;
  tau_version: string;
  engine_ok: boolean;
}
export interface Trace {
  run: Run;
  spans: Span[];
  events: Event[];
}

let activeProject = "";
/** Set the project id every scoped request is prefixed with. */
export function setActiveProject(pid: string): void {
  activeProject = pid;
}
function scoped(path: string): string {
  return `/api/projects/${activeProject}${path}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getHealth = () => fetch(scoped("/health")).then(json<Health>);
export const getProject = () => fetch(scoped("/project")).then(json<Project>);

export function launchRun(agent_id: string, prompt: string): Promise<string> {
  return fetch(scoped("/runs"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id, prompt }),
  })
    .then(json<{ run_id: string }>)
    .then((r) => r.run_id);
}

export function listRuns(filters: { status?: string; agent?: string } = {}): Promise<Run[]> {
  const q = new URLSearchParams();
  if (filters.status) q.set("status", filters.status);
  if (filters.agent) q.set("agent", filters.agent);
  const qs = q.toString();
  return fetch(scoped(`/runs${qs ? `?${qs}` : ""}`)).then(json<Run[]>);
}

export const getWorkflows = () =>
  fetch(scoped("/workflows"))
    .then(json<{ workflows: string[] }>)
    .then((r) => r.workflows);

export function launchWorkflow(workflow: string, input: string): Promise<string> {
  return fetch(scoped("/workflows/run"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow, input }),
  })
    .then(json<{ run_id: string }>)
    .then((r) => r.run_id);
}

export const getTrace = (id: string) => fetch(scoped(`/runs/${id}`)).then(json<Trace>);
export const cancelRun = (id: string) =>
  fetch(scoped(`/runs/${id}/cancel`), { method: "POST" })
    .then(json<{ cancelled: boolean }>)
    .then((r) => r.cancelled);

/** Open the live WS for a run under the active project. */
export function openRunSocket(id: string, onMessage: (m: WsMessage) => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}${scoped(`/runs/${id}/events`)}`);
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data) as WsMessage);
    } catch {
      /* ignore malformed */
    }
  };
  return ws;
}

/** Build a scoped path for the active project (used by other api modules). */
export function scopedPath(path: string): string {
  return scoped(path);
}
