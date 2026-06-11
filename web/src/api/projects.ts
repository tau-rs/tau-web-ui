import type { ProjectListItem } from "../types/ProjectListItem";
import type { ProjectMeta } from "../types/ProjectMeta";
import type { CrossProjectRun } from "../types/CrossProjectRun";
import { request, requestVoid } from "./client";

export const listProjects = () => request<ProjectListItem[]>("/api/projects");

export function getCrossRuns(status?: string, limit = 50): Promise<CrossProjectRun[]> {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  q.set("limit", String(limit));
  return request<CrossProjectRun[]>(`/api/projects/runs?${q.toString()}`);
}

export const addProjectByPath = (path: string) =>
  request<ProjectMeta>("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });

export const addProjectByGit = (git_url: string) =>
  request<ProjectMeta>("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  });

export const removeProject = (pid: string) =>
  requestVoid(`/api/projects/${pid}`, { method: "DELETE" });

export const saveWorkspaceAs = (name: string): Promise<ProjectMeta> =>
  request<ProjectMeta>("/api/workspace/save-as", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
