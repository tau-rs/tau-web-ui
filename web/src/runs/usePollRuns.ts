import { useEffect } from "react";
import { useStore } from "../store/store";
import { useProjectId } from "../app/project-context";

/** Subscribe to the shared runs poller while mounted. Many consumers share one
 *  interval (ref-counted in the store); polling pauses while the tab is hidden
 *  and backs off on error. */
export function usePollRuns(ms = 5000) {
  const subscribeRuns = useStore((s) => s.subscribeRuns);
  const pid = useProjectId();
  useEffect(() => subscribeRuns(pid, ms), [subscribeRuns, ms, pid]);
}
