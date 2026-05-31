import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useStore } from "../store/store";
import { TraceView } from "./TraceView";

export function TracePage() {
  const { id } = useParams<{ id: string }>();
  const openTrace = useStore((s) => s.openTrace);
  const closeTrace = useStore((s) => s.closeTrace);
  useEffect(() => {
    if (id) openTrace(id).catch(() => {});
    return () => closeTrace();
  }, [id, openTrace, closeTrace]);
  return <TraceView />;
}
