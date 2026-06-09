import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import type { SourceConfig } from "../types/SourceConfig";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Credentials are per-machine (global), so these hit /api/credentials directly,
// not the project-scoped path.
export const getCredentials = () => fetch("/api/credentials").then(json<BackendCredentialStatus[]>);

export const putCredential = (
  backend: string,
  body: { sources: SourceConfig[]; local_value?: string },
) =>
  fetch(`/api/credentials/${backend}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<BackendCredentialStatus>);

export const deleteCredential = (backend: string) =>
  fetch(`/api/credentials/${backend}`, { method: "DELETE" }).then(json<{ ok: boolean }>);
