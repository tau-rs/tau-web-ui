import type { ProjectListItem } from "../types/ProjectListItem";
import type { ProjectMeta } from "../types/ProjectMeta";
import type { CrossProjectRun } from "../types/CrossProjectRun";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listProjects = () => fetch("/api/projects").then(json<ProjectListItem[]>);

export function getCrossRuns(status?: string, limit = 50): Promise<CrossProjectRun[]> {
  const q = new URLSearchParams();
  if (status) q.set("status", status);
  q.set("limit", String(limit));
  return fetch(`/api/projects/runs?${q.toString()}`).then(json<CrossProjectRun[]>);
}

export const addProjectByPath = (path: string) =>
  fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).then(json<ProjectMeta>);

export const addProjectByGit = (git_url: string) =>
  fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  }).then(json<ProjectMeta>);

export const removeProject = (pid: string) =>
  fetch(`/api/projects/${encodeURIComponent(pid)}`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`);
  });

export const saveWorkspaceAs = (name: string): Promise<ProjectMeta> =>
  fetch("/api/workspace/save-as", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }).then(json<ProjectMeta>);
