import type { SessionSummary } from "../types/SessionSummary";
import type { SessionDetail } from "../types/SessionDetail";
import { request, scopedPath } from "./client";

export const listSessions = (pid: string) =>
  request<SessionSummary[]>(scopedPath(pid, "/sessions"));

export const getSession = (pid: string, id: string) =>
  request<SessionDetail>(scopedPath(pid, `/sessions/${encodeURIComponent(id)}`));

export type ExportFmt = "jsonl" | "md" | "json";

/** Direct download URL (used as an `<a href>`), not a fetch — the gateway streams
 *  the file with a Content-Disposition attachment header. */
export const exportUrl = (pid: string, id: string, format: ExportFmt) =>
  scopedPath(pid, `/sessions/${encodeURIComponent(id)}/export?format=${format}`);
