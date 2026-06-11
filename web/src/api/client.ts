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

/** Build a path scoped to project `pid`. The project is always passed
 *  explicitly by the caller — there is no module-level "active project". */
function scoped(pid: string, path: string): string {
  return `/api/projects/${pid}${path}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getHealth = (pid: string) => fetch(scoped(pid, "/health")).then(json<Health>);
export const getProject = (pid: string) => fetch(scoped(pid, "/project")).then(json<Project>);

export function launchRun(pid: string, agent_id: string, prompt: string): Promise<string> {
  return fetch(scoped(pid, "/runs"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id, prompt }),
  })
    .then(json<{ run_id: string }>)
    .then((r) => r.run_id);
}

export function listRuns(
  pid: string,
  filters: { status?: string; agent?: string } = {},
): Promise<Run[]> {
  const q = new URLSearchParams();
  if (filters.status) q.set("status", filters.status);
  if (filters.agent) q.set("agent", filters.agent);
  const qs = q.toString();
  return fetch(scoped(pid, `/runs${qs ? `?${qs}` : ""}`)).then(json<Run[]>);
}

export const getWorkflows = (pid: string) =>
  fetch(scoped(pid, "/workflows"))
    .then(json<{ workflows: string[] }>)
    .then((r) => r.workflows);

export function launchWorkflow(pid: string, workflow: string, input: string): Promise<string> {
  return fetch(scoped(pid, "/workflows/run"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow, input }),
  })
    .then(json<{ run_id: string }>)
    .then((r) => r.run_id);
}

export const getTrace = (pid: string, id: string) =>
  fetch(scoped(pid, `/runs/${id}`)).then(json<Trace>);
export const cancelRun = (pid: string, id: string) =>
  fetch(scoped(pid, `/runs/${id}/cancel`), { method: "POST" })
    .then(json<{ cancelled: boolean }>)
    .then((r) => r.cancelled);

/** Open the live WS for a run under project `pid`. */
export function openRunSocket(
  pid: string,
  id: string,
  onMessage: (m: WsMessage) => void,
): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}${scoped(pid, `/runs/${id}/events`)}`);
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data) as WsMessage);
    } catch {
      /* ignore malformed */
    }
  };
  return ws;
}

/** Build a scoped path for project `pid` (used by the per-domain api modules). */
export function scopedPath(pid: string, path: string): string {
  return scoped(pid, path);
}
