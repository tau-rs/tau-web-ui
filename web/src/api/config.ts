import type { ProjectConfig } from "../types/ProjectConfig";
import type { Package } from "../types/Package";
import type { VerifyResult } from "../types/VerifyResult";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getConfig = () => fetch(scopedPath("/project/config")).then(json<ProjectConfig>);

export const putConfig = (name: string, description: string) =>
  fetch(scopedPath("/project/config"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, description: description || null }),
  }).then(json<{ ok: boolean }>);

export const getPackages = () =>
  fetch(scopedPath("/packages"))
    .then(json<{ packages: Package[] }>)
    .then((r) => r.packages);

export const installPackage = (git_url: string) =>
  fetch(scopedPath("/packages/install"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  })
    .then(json<{ package: Package }>)
    .then((r) => r.package);

export const uninstallPackage = (name: string) =>
  fetch(scopedPath(`/packages/${name}`), { method: "DELETE" }).then(json<{ ok: boolean }>);

export const updatePackage = (name: string, to?: string) =>
  fetch(scopedPath(`/packages/${name}/update`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: to ?? null }),
  })
    .then(json<{ package: Package }>)
    .then((r) => r.package);

export const resolvePackages = () =>
  fetch(scopedPath("/packages/resolve"), { method: "POST" })
    .then(json<{ packages: Package[] }>)
    .then((r) => r.packages);

export const verifyPackages = () =>
  fetch(scopedPath("/packages/verify"), { method: "POST" })
    .then(json<{ results: VerifyResult[] }>)
    .then((r) => r.results);

export const importAgent = (git_url: string, llm_backend: string) =>
  fetch(scopedPath("/agents/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url, llm_backend }),
  })
    .then(json<{ agent_id: string }>)
    .then((r) => r.agent_id);
