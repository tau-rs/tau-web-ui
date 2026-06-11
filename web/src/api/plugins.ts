import type { PluginDetail } from "../types/PluginDetail";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listPlugins = (pid: string) =>
  fetch(scopedPath(pid, "/plugins")).then(json<PluginDetail[]>);
