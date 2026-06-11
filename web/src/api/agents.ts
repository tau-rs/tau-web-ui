import type { AgentDetail } from "../types/AgentDetail";
import { request, requestVoid, scopedPath } from "./client";

export const listAgents = (pid: string) => request<AgentDetail[]>(scopedPath(pid, "/agents"));

export const getAgent = (pid: string, id: string) =>
  request<AgentDetail>(scopedPath(pid, `/agents/${encodeURIComponent(id)}`));

export const putAgent = (pid: string, agent: AgentDetail, opts?: { create?: boolean }) =>
  request<AgentDetail>(
    scopedPath(pid, `/agents/${encodeURIComponent(agent.id)}${opts?.create ? "?create=1" : ""}`),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(agent),
    },
  );

export const deleteAgent = (pid: string, id: string) =>
  requestVoid(scopedPath(pid, `/agents/${encodeURIComponent(id)}`), { method: "DELETE" });
