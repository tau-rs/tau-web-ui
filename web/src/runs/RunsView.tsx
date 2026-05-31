import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { Launcher } from "./Launcher";
import { RunsTable } from "./RunsTable";

export function RunsView() {
  const runs = useStore((s) => s.runs);
  const refreshRuns = useStore((s) => s.refreshRuns);
  const navigate = useNavigate();

  useEffect(() => {
    refreshRuns().catch(() => {});
  }, [refreshRuns]);

  return (
    <section className="p-4">
      <h2 className="mb-3 text-base font-semibold">Runs</h2>
      <Launcher />
      <RunsTable runs={runs} onOpen={(id) => navigate(`/runs/${id}`)} />
    </section>
  );
}
