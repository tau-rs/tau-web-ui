import type { PluginCatalog } from "../types/PluginCatalog";
import { request, scopedPath } from "./client";

export const listPlugins = (pid: string) => request<PluginCatalog>(scopedPath(pid, "/plugins"));
