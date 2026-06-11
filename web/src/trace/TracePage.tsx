import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../store/store";
import { useProjectId } from "../app/project-context";
import { TraceView } from "./TraceView";

export function TracePage() {
  const { id } = useParams<{ id: string }>();
  const pid = useProjectId();
  const openTrace = useStore((s) => s.openTrace);
  const closeTrace = useStore((s) => s.closeTrace);
  useEffect(() => {
    if (id) openTrace(pid, id).catch(() => {});
    return () => closeTrace();
  }, [id, pid, openTrace, closeTrace]);
  return <TraceView />;
}
