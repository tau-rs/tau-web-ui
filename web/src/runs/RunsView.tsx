import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { usePollRuns } from "./usePollRuns";
import { Launcher } from "./Launcher";
import { RunsTable } from "./RunsTable";
import { RunsOverview } from "./RunsOverview";

type Filter = "all" | "workflow" | "agent";

export function RunsView() {
  const runs = useStore((s) => s.runs);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  usePollRuns();

  const shown = runs.filter((r) =>
    filter === "all" ? true : filter === "workflow" ? r.source === "log" : r.source !== "log",
  );

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "workflow", label: "Workflows" },
    { id: "agent", label: "Agents" },
  ];

  return (
    <section className="p-4">
      <h2 className="mb-3 text-base font-semibold">Runs</h2>
      <Launcher />
      <RunsOverview />
      <div className="mb-2 inline-flex rounded-md border border-border bg-surface p-0.5 text-xs">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`rounded px-2.5 py-1 font-medium ${
              filter === t.id ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <RunsTable runs={shown} onOpen={(id) => navigate(`/runs/${id}`)} />
    </section>
  );
}
