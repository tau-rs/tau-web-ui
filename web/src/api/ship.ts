import type { Target } from "../types/Target";
import type { Bundle } from "../types/Bundle";
import type { VerifyOutcome } from "../types/VerifyOutcome";
import { request, scopedPath } from "./client";

export const listTargets = (pid: string) => request<Target[]>(scopedPath(pid, "/targets"));
export const listBundles = (pid: string) => request<Bundle[]>(scopedPath(pid, "/bundles"));
export const build = (pid: string, target: string) =>
  request<Bundle>(scopedPath(pid, "/build"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target }),
  });

export const verifyBundle = (pid: string, path: string) =>
  request<VerifyOutcome>(scopedPath(pid, "/verify"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
