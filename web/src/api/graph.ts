import type { WorkflowGraph } from "../types/WorkflowGraph";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getWorkflowGraph = (pid: string, name: string) =>
  fetch(scopedPath(pid, `/workflows/${encodeURIComponent(name)}/graph`)).then(json<WorkflowGraph>);
