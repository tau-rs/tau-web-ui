import { useEffect } from "react";
import { useStore } from "../store/store";
import { ProjectCard } from "./ProjectCard";
import { AddProjectForm } from "./AddProjectForm";
import { ActivityFeed } from "./ActivityFeed";
import { UnsavedCard } from "./UnsavedCard";

const fmtTok = (n: bigint | number) => {
  const v = Number(n);
  return v >= 1_000_000
    ? `${(v / 1e6).toFixed(1)}M`
    : v >= 1000
      ? `${(v / 1000).toFixed(1)}k`
      : `${v}`;
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-lg font-bold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

export function ProjectsHome() {
  const projects = useStore((s) => s.projects);
  const loadProjects = useStore((s) => s.loadProjects);
  const setActiveProject = useStore((s) => s.setActiveProject);

  useEffect(() => {
    setActiveProject("");
    loadProjects().catch(() => {});
  }, [setActiveProject, loadProjects]);

  const workspace = projects.find((p) => p.meta.source.kind === "workspace");
  const realProjects = projects.filter((p) => p.meta.source.kind !== "workspace");

  const totalRuns = projects.reduce((a, p) => a + p.summary.runs, 0);
  const running = projects.reduce((a, p) => a + p.summary.running, 0);
  const failed24h = projects.reduce((a, p) => a + p.summary.failed_24h, 0);
  const tokens = projects.reduce((a, p) => a + Number(p.summary.tokens), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-5">
      <h1 className="text-lg font-bold">Projects</h1>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Projects" value={realProjects.length} />
        <Stat label="Runs (all)" value={totalRuns} />
        <Stat label="Running" value={running} tone="text-st-running" />
        <Stat label="Failed (24h)" value={failed24h} tone="text-st-error" />
        <Stat label="Tokens" value={fmtTok(tokens)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {workspace && <UnsavedCard item={workspace} onSaved={() => loadProjects()} />}
          {realProjects.map((p) => (
            <ProjectCard key={p.meta.id} item={p} />
          ))}
          <AddProjectForm onAdded={() => loadProjects()} />
        </div>
        <ActivityFeed />
      </div>
    </div>
  );
}
