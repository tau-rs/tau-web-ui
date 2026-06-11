import type { ProjectListItem } from "../types/ProjectListItem";
import type { ProjectMeta } from "../types/ProjectMeta";
import type { CrossProjectRun } from "../types/CrossProjectRun";
import { request, requestVoid, API_ROOT } from "./client";

export const listProjects = () => request<ProjectListItem[]>(`${API_ROOT}/projects`);

export function getCrossRuns(status?: string, limit = 50): Promise<CrossProjectRun[]> {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  q.set("limit", String(limit));
  return request<CrossProjectRun[]>(`${API_ROOT}/projects/runs?${q.toString()}`);
}

export const addProjectByPath = (path: string) =>
  request<ProjectMeta>(`${API_ROOT}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });

export const addProjectByGit = (git_url: string) =>
  request<ProjectMeta>(`${API_ROOT}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  });

export const removeProject = (pid: string) =>
  requestVoid(`${API_ROOT}/projects/${encodeURIComponent(pid)}`, { method: "DELETE" });

export const saveWorkspaceAs = (name: string): Promise<ProjectMeta> =>
  request<ProjectMeta>(`${API_ROOT}/workspace/save-as`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
