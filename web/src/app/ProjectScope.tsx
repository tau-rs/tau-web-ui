import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { useStore } from "../store/store";
import { setActiveProject as setClientProject } from "../api/client";
import { NotFound } from "../projects/NotFound";

export function ProjectScope() {
  const { pid } = useParams();
  const setActiveProject = useStore((s) => s.setActiveProject);
  const loadProject = useStore((s) => s.loadProject);
  const loadHealth = useStore((s) => s.loadHealth);
  const loadProjects = useStore((s) => s.loadProjects);
  const projects = useStore((s) => s.projects);

  // Set the scoped API prefix synchronously during render, before child route
  // effects (which run child-first) fire their data loads.
  if (pid) setClientProject(pid);

  useEffect(() => {
    if (!pid) return;
    setActiveProject(pid);
    loadProjects().catch(() => {});
    loadProject().catch(() => {});
    loadHealth().catch(() => {});
  }, [pid, setActiveProject, loadProjects, loadProject, loadHealth]);

  const known = projects.length === 0 || projects.some((p) => p.meta.id === pid);
  return known ? <Outlet /> : <NotFound />;
}
