import type { AgentCapabilities } from "../types/AgentCapabilities";
import { request, scopedPath } from "./client";

export const getCapabilities = (pid: string) =>
  request<AgentCapabilities[]>(scopedPath(pid, "/capabilities"));
