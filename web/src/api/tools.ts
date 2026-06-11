import type { ToolDetail } from "../types/ToolDetail";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listTools = (pid: string) => fetch(scopedPath(pid, "/tools")).then(json<ToolDetail[]>);
