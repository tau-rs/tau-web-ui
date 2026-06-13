import type { ToolCatalog } from "../types/ToolCatalog";
import { request, scopedPath } from "./client";

export const listTools = (pid: string) => request<ToolCatalog>(scopedPath(pid, "/tools"));
