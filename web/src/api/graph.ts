import type { WorkflowGraph } from "../types/WorkflowGraph";
import { request, scopedPath } from "./client";

export const getWorkflowGraph = (pid: string, name: string) =>
  request<WorkflowGraph>(scopedPath(pid, `/workflows/${name}/graph`));
