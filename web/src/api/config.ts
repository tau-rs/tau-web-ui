import type { ProjectConfig } from "../types/ProjectConfig";
import type { Package } from "../types/Package";
import type { VerifyResult } from "../types/VerifyResult";
import { request, scopedPath } from "./client";

export const getConfig = (pid: string) =>
  request<ProjectConfig>(scopedPath(pid, "/project/config"));

export const putConfig = (pid: string, name: string, description: string) =>
  request<{ ok: boolean }>(scopedPath(pid, "/project/config"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description: description || null }),
  });

export const getPackages = (pid: string) =>
  request<{ packages: Package[] }>(scopedPath(pid, "/packages")).then((r) => r.packages);

export const installPackage = (pid: string, git_url: string) =>
  request<{ package: Package }>(scopedPath(pid, "/packages/install"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  }).then((r) => r.package);

export const uninstallPackage = (pid: string, name: string) =>
  request<{ ok: boolean }>(scopedPath(pid, `/packages/${name}`), { method: "DELETE" });

export const updatePackage = (pid: string, name: string, to?: string) =>
  request<{ package: Package }>(scopedPath(pid, `/packages/${name}/update`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: to ?? null }),
  }).then((r) => r.package);

export const resolvePackages = (pid: string) =>
  request<{ packages: Package[] }>(scopedPath(pid, "/packages/resolve"), { method: "POST" }).then(
    (r) => r.packages,
  );

export const verifyPackages = (pid: string) =>
  request<{ results: VerifyResult[] }>(scopedPath(pid, "/packages/verify"), {
    method: "POST",
  }).then((r) => r.results);

export const importAgent = (pid: string, git_url: string, llm_backend: string) =>
  request<{ agent_id: string }>(scopedPath(pid, "/agents/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url, llm_backend }),
  }).then((r) => r.agent_id);
