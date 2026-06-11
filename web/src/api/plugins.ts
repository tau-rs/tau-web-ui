import type { PluginDetail } from "../types/PluginDetail";
import { request, scopedPath } from "./client";

export const listPlugins = (pid: string) => request<PluginDetail[]>(scopedPath(pid, "/plugins"));
