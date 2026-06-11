import type { ToolDetail } from "../types/ToolDetail";
import { request, scopedPath } from "./client";

export const listTools = (pid: string) => request<ToolDetail[]>(scopedPath(pid, "/tools"));
