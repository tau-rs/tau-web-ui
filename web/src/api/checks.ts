import type { CheckReport } from "../types/CheckReport";
import { request, scopedPath } from "./client";

export const getChecks = (pid: string) => request<CheckReport>(scopedPath(pid, "/checks"));
