import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { ProjectScope } from "./app/ProjectScope";
import { ConfigPage } from "./config/ConfigPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { PackagesPage } from "./packages/PackagesPage";
import { RunsPage } from "./runs/RunsPage";
import { TracePage } from "./trace/TracePage";
import { ProjectsHome } from "./projects/ProjectsHome";
import { AgentsIndexPage } from "./agents/AgentsIndexPage";
import { AgentEditorPage } from "./agents/AgentEditorPage";
import { ToolsPage } from "./tools/ToolsPage";
import { SkillEditorPage } from "./tools/SkillEditorPage";
import { ShipPage } from "./ship/ShipPage";
import { HealthPage } from "./health/HealthPage";
import { GraphEditor } from "./graph/GraphEditor";

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ProjectsHome />} />
        <Route path="projects/:pid" element={<ProjectScope />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="agents" element={<AgentsIndexPage />} />
          <Route path="agents/new" element={<AgentEditorPage />} />
          <Route path="agents/:agentId" element={<AgentEditorPage />} />
          <Route path="workflows" element={<GraphEditor />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="tools/skills/new" element={<SkillEditorPage />} />
          <Route path="tools/skills/:name" element={<SkillEditorPage />} />
          <Route path="packages" element={<PackagesPage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:id" element={<TracePage />} />
          <Route path="ship" element={<ShipPage />} />
          <Route path="health" element={<HealthPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
