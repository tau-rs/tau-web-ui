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
  return `/api/projects/${encodeURIComponent(pid)}${path}`;
}

const BASE = ""; // single future home for an absolute base URL

/** The one place every request flows through: base URL lives here, and this is
 *  the single home for adding default headers (Origin — audit S1), a timeout,
 *  or an abort signal later, applied to every call without touching call sites.
 *  Argument-less requests stay argument-less, so behavior is identical to a
 *  direct `fetch`. */
function send(path: string, init?: RequestInit): Promise<Response> {
  const url = `${BASE}${path}`;
  return init ? fetch(url, init) : fetch(url);
}

async function check(res: Response): Promise<Response> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res;
}

/** The single API request entrypoint: base URL + error normalization, then
 *  JSON-decode the body. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await check(await send(path, init));
  return res.json() as Promise<T>;
}

/** Like `request`, for endpoints that return no JSON body (e.g. DELETE). */
export async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  await check(await send(path, init));
}

export const getHealth = (pid: string) => request<Health>(scoped(pid, "/health"));
export const getProject = (pid: string) => request<Project>(scoped(pid, "/project"));

export function launchRun(pid: string, agent_id: string, prompt: string): Promise<string> {
  return request<{ run_id: string }>(scoped(pid, "/runs"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id, prompt }),
  }).then((r) => r.run_id);
}

export function listRuns(
  pid: string,
  filters: { status?: string; agent?: string } = {},
): Promise<Run[]> {
  const q = new URLSearchParams();
  if (filters.status) q.set("status", filters.status);
  if (filters.agent) q.set("agent", filters.agent);
  const qs = q.toString();
  return request<Run[]>(scoped(pid, `/runs${qs ? `?${qs}` : ""}`));
}

export const getWorkflows = (pid: string) =>
  request<{ workflows: string[] }>(scoped(pid, "/workflows")).then((r) => r.workflows);

export function launchWorkflow(pid: string, workflow: string, input: string): Promise<string> {
  return request<{ run_id: string }>(scoped(pid, "/workflows/run"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflow, input }),
  }).then((r) => r.run_id);
}

export const getTrace = (pid: string, id: string) =>
  request<Trace>(scoped(pid, `/runs/${encodeURIComponent(id)}`));
export const cancelRun = (pid: string, id: string) =>
  request<{ cancelled: boolean }>(scoped(pid, `/runs/${encodeURIComponent(id)}/cancel`), {
    method: "POST",
  }).then((r) => r.cancelled);

/** Open the live WS for a run under project `pid`. */
export function openRunSocket(
  pid: string,
  id: string,
  onMessage: (m: WsMessage) => void,
): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(
    `${proto}://${location.host}${scoped(pid, `/runs/${encodeURIComponent(id)}/events`)}`,
  );
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
