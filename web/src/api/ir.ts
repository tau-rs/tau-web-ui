import type { CompiledIr } from "../types/CompiledIr";
import { request, scopedPath } from "./client";

export const getCompiledIr = (pid: string) => request<CompiledIr>(scopedPath(pid, "/ir"));
