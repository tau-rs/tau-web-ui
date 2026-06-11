import type { Provider } from "../types/Provider";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const getProviders = (pid: string) =>
  fetch(scopedPath(pid, "/providers")).then(json<Provider[]>);
