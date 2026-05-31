import { useEffect } from "react";
import { useStore } from "../store/store";

/** Refresh the runs list now and every `ms` while mounted (keeps dashboards live). */
export function usePollRuns(ms = 5000) {
  const refreshRuns = useStore((s) => s.refreshRuns);
  useEffect(() => {
    refreshRuns().catch(() => {});
    const t = setInterval(() => refreshRuns().catch(() => {}), ms);
    return () => clearInterval(t);
  }, [refreshRuns, ms]);
}
