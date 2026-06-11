import type { Target } from "../types/Target";
import type { Bundle } from "../types/Bundle";
import type { VerifyOutcome } from "../types/VerifyOutcome";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listTargets = (pid: string) => fetch(scopedPath(pid, "/targets")).then(json<Target[]>);
export const listBundles = (pid: string) => fetch(scopedPath(pid, "/bundles")).then(json<Bundle[]>);
export const build = (pid: string, target: string) =>
  fetch(scopedPath(pid, "/build"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target }),
  }).then(json<Bundle>);

export const verifyBundle = (pid: string, path: string) =>
  fetch(scopedPath(pid, "/verify"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).then(json<VerifyOutcome>);
