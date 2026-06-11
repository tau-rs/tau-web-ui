import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { useStore } from "../store/store";
import { ProjectProvider } from "./project-context";
import { NotFound } from "../projects/NotFound";

export function ProjectScope() {
  const { pid } = useParams();
  const setActiveProject = useStore((s) => s.setActiveProject);
  const loadProject = useStore((s) => s.loadProject);
  const loadHealth = useStore((s) => s.loadHealth);
  const loadProjects = useStore((s) => s.loadProjects);
  const projects = useStore((s) => s.projects);

  useEffect(() => {
    if (!pid) return;
    setActiveProject(pid);
    loadProjects().catch(() => {});
    loadProject(pid).catch(() => {});
    loadHealth(pid).catch(() => {});
  }, [pid, setActiveProject, loadProjects, loadProject, loadHealth]);

  const known = projects.length === 0 || projects.some((p) => p.meta.id === pid);
  if (!known) return <NotFound />;
  return (
    <ProjectProvider pid={pid ?? ""}>
      <Outlet />
    </ProjectProvider>
  );
}
