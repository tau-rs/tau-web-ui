import { useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import { useStore } from "../store/store";
import { setActiveProject as setClientProject } from "../api/client";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { NotFound } from "../projects/NotFound";

export function AppLayout() {
  const { pid } = useParams();
  const setActiveProject = useStore((s) => s.setActiveProject);
  const loadProject = useStore((s) => s.loadProject);
  const loadHealth = useStore((s) => s.loadHealth);
  const loadProjects = useStore((s) => s.loadProjects);
  const projects = useStore((s) => s.projects);

  // Set the scoped API prefix synchronously during render, BEFORE child
  // routes render and fire their data effects (which run child-first, ahead of
  // this component's effect). Without this, a cold load / hard refresh of a
  // scoped page would issue the first request with an empty project id.
  if (pid) setClientProject(pid);

  useEffect(() => {
    if (!pid) return;
    setActiveProject(pid);
    loadProjects().catch(() => {});
    loadProject().catch(() => {});
    loadHealth().catch(() => {});
  }, [pid, setActiveProject, loadProjects, loadProject, loadHealth]);

  // Once projects are known, guard against an unknown :pid.
  const known = projects.length === 0 || projects.some((p) => p.meta.id === pid);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar />
          <main className="min-h-0 flex-1 overflow-auto">{known ? <Outlet /> : <NotFound />}</main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
