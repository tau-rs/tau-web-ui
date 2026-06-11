import { useEffect } from "react";
import { useStore } from "../store/store";
import { useProjectId } from "../app/project-context";

/** Refresh the runs list now and every `ms` while mounted (keeps dashboards live). */
export function usePollRuns(ms = 5000) {
  const refreshRuns = useStore((s) => s.refreshRuns);
  const pid = useProjectId();
  useEffect(() => {
    refreshRuns(pid).catch(() => {});
    const t = setInterval(() => refreshRuns(pid).catch(() => {}), ms);
    return () => clearInterval(t);
  }, [refreshRuns, ms, pid]);
}
