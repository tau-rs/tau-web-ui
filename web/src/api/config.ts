import type { ProjectConfig } from "../types/ProjectConfig";
import type { Package } from "../types/Package";
import type { VerifyResult } from "../types/VerifyResult";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getConfig = (pid: string) =>
  fetch(scopedPath(pid, "/project/config")).then(json<ProjectConfig>);

export const putConfig = (pid: string, name: string, description: string) =>
  fetch(scopedPath(pid, "/project/config"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description: description || null }),
  }).then(json<{ ok: boolean }>);

export const getPackages = (pid: string) =>
  fetch(scopedPath(pid, "/packages"))
    .then(json<{ packages: Package[] }>)
    .then((r) => r.packages);

export const installPackage = (pid: string, git_url: string) =>
  fetch(scopedPath(pid, "/packages/install"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  })
    .then(json<{ package: Package }>)
    .then((r) => r.package);

export const uninstallPackage = (pid: string, name: string) =>
  fetch(scopedPath(pid, `/packages/${name}`), { method: "DELETE" }).then(json<{ ok: boolean }>);

export const updatePackage = (pid: string, name: string, to?: string) =>
  fetch(scopedPath(pid, `/packages/${name}/update`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: to ?? null }),
  })
    .then(json<{ package: Package }>)
    .then((r) => r.package);

export const resolvePackages = (pid: string) =>
  fetch(scopedPath(pid, "/packages/resolve"), { method: "POST" })
    .then(json<{ packages: Package[] }>)
    .then((r) => r.packages);

export const verifyPackages = (pid: string) =>
  fetch(scopedPath(pid, "/packages/verify"), { method: "POST" })
    .then(json<{ results: VerifyResult[] }>)
    .then((r) => r.results);

export const importAgent = (pid: string, git_url: string, llm_backend: string) =>
  fetch(scopedPath(pid, "/agents/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url, llm_backend }),
  })
    .then(json<{ agent_id: string }>)
    .then((r) => r.agent_id);
