import { createContext, useContext, type ReactNode } from "react";

const ProjectContext = createContext<string | null>(null);

/**
 * Provides the active project id (derived from the `:pid` route param by
 * `ProjectScope`) to scoped descendants. This is the single place routing is
 * translated into the active project — consumers read it via `useProjectId`
 * and pass it explicitly to the API client, so no request can read a stale or
 * wrong project from a shared mutable global.
 */
export function ProjectProvider({ pid, children }: { pid: string; children: ReactNode }) {
  return <ProjectContext.Provider value={pid}>{children}</ProjectContext.Provider>;
}

/** Read the active project id. Throws if used outside a `ProjectProvider`. */
// eslint-disable-next-line react-refresh/only-export-components -- the provider + its accessor hook belong together
export function useProjectId(): string {
  const pid = useContext(ProjectContext);
  if (pid === null) throw new Error("useProjectId must be used within a ProjectProvider");
  return pid;
}
