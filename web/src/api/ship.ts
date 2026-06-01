import type { Target } from "../types/Target";
import type { Bundle } from "../types/Bundle";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listTargets = () => fetch(scopedPath("/targets")).then(json<Target[]>);
export const listBundles = () => fetch(scopedPath("/bundles")).then(json<Bundle[]>);
export const build = (target: string) =>
  fetch(scopedPath("/build"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  }).then(json<Bundle>);
