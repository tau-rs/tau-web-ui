import { useEffect } from "react";
import { useStore } from "../store/store";
import { Launcher } from "./Launcher";
import { RunsTable } from "./RunsTable";

export function RunsView() {
  const runs = useStore((s) => s.runs);
  const refreshRuns = useStore((s) => s.refreshRuns);
  const openTrace = useStore((s) => s.openTrace);

  useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  return (
    <section style={{ padding: 16 }}>
      <h2 style={{ fontSize: 16 }}>Runs</h2>
      <Launcher />
      <RunsTable runs={runs} onOpen={openTrace} />
    </section>
  );
}
