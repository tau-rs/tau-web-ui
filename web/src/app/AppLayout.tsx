import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useStore } from "../store/store";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

export function AppLayout() {
  const loadProject = useStore((s) => s.loadProject);
  const loadHealth = useStore((s) => s.loadHealth);
  useEffect(() => {
    loadProject().catch(() => {});
    loadHealth().catch(() => {});
  }, [loadProject, loadHealth]);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar />
          <main className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <Footer />
    </div>
  );
}
