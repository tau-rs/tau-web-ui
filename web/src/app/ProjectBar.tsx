import { useEffect } from "react";
import { useStore } from "../store/store";

export function ProjectBar() {
  const project = useStore((s) => s.project);
  const loadProject = useStore((s) => s.loadProject);
  useEffect(() => { loadProject().catch(() => {}); }, [loadProject]);

  return (
    <header style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 16px",
      borderBottom: "1px solid #ddd", background: "#fafafa" }}>
      <strong>tau-web-ui</strong>
      <span style={{ fontSize: 12, color: "#666" }}>{project?.project_path ?? "connecting…"}</span>
      <span style={{ fontSize: 12, color: "#666", marginLeft: "auto" }}>
        tau {project?.tau_version ?? "—"}
      </span>
      <span title={project ? "engine reachable" : "no engine"}
        style={{ width: 10, height: 10, borderRadius: 5,
          background: project ? "#16a34a" : "#dc2626" }} />
    </header>
  );
}
