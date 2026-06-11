import type { AgentDetail } from "../types/AgentDetail";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listAgents = (pid: string) =>
  fetch(scopedPath(pid, "/agents")).then(json<AgentDetail[]>);

export const getAgent = (pid: string, id: string) =>
  fetch(scopedPath(pid, `/agents/${encodeURIComponent(id)}`)).then(json<AgentDetail>);

export const putAgent = (pid: string, agent: AgentDetail, opts?: { create?: boolean }) =>
  fetch(
    scopedPath(pid, `/agents/${encodeURIComponent(agent.id)}${opts?.create ? "?create=1" : ""}`),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(agent),
    },
  ).then(json<AgentDetail>);

export const deleteAgent = (pid: string, id: string) =>
  fetch(scopedPath(pid, `/agents/${encodeURIComponent(id)}`), { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`);
  });
