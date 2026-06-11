import type { CheckReport } from "../types/CheckReport";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getChecks = (pid: string) => fetch(scopedPath(pid, "/checks")).then(json<CheckReport>);
