import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import type { SourceConfig } from "../types/SourceConfig";
import { request } from "./client";

// Credentials are per-machine (global), so these hit /api/credentials directly,
// not the project-scoped path.
export const getCredentials = () => request<BackendCredentialStatus[]>("/api/credentials");

export const putCredential = (
  backend: string,
  body: { sources: SourceConfig[]; local_value?: string },
) =>
  request<BackendCredentialStatus>(`/api/credentials/${encodeURIComponent(backend)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const deleteCredential = (backend: string) =>
  request<{ ok: boolean }>(`/api/credentials/${encodeURIComponent(backend)}`, {
    method: "DELETE",
  });
