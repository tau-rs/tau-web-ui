import type { Provider } from "../types/Provider";
import { request, scopedPath } from "./client";

export const getProviders = (pid: string) => request<Provider[]>(scopedPath(pid, "/providers"));
