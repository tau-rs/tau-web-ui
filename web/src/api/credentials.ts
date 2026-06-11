import type { BackendCredentialStatus } from "../types/BackendCredentialStatus";
import type { SourceConfig } from "../types/SourceConfig";
import { request, API_ROOT } from "./client";

// Credentials are per-machine (global), so these hit the API root's
// /credentials directly, not the project-scoped path.
export const getCredentials = () => request<BackendCredentialStatus[]>(`${API_ROOT}/credentials`);

export const putCredential = (
  backend: string,
  body: { sources: SourceConfig[]; local_value?: string },
) =>
  request<BackendCredentialStatus>(`${API_ROOT}/credentials/${encodeURIComponent(backend)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export const deleteCredential = (backend: string) =>
  request<{ ok: boolean }>(`${API_ROOT}/credentials/${encodeURIComponent(backend)}`, {
    method: "DELETE",
  });
