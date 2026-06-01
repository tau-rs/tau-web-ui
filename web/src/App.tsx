import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { StubPage } from "./app/StubPage";
import { ConfigPage } from "./config/ConfigPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { PackagesPage } from "./packages/PackagesPage";
import { RunsPage } from "./runs/RunsPage";
import { TracePage } from "./trace/TracePage";
import { ProjectsHome } from "./projects/ProjectsHome";
import { AgentsIndexPage } from "./agents/AgentsIndexPage";
import { AgentEditorPage } from "./agents/AgentEditorPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectsHome />} />
      <Route path="/projects/:pid" element={<AppLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="agents" element={<AgentsIndexPage />} />
        <Route path="agents/new" element={<AgentEditorPage />} />
        <Route path="agents/:agentId" element={<AgentEditorPage />} />
        <Route
          path="workflows"
          element={
            <StubPage
              title="Workflows"
              subtitle="Author & run workflows — coming soon."
              gated="β.2 (visual graph)"
            />
          }
        />
        <Route
          path="tools"
          element={<StubPage title="Tools & Skills" subtitle="Skills & plugins — coming soon." />}
        />
        <Route path="packages" element={<PackagesPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<TracePage />} />
        <Route
          path="ship"
          element={
            <StubPage
              title="Ship / Targets"
              subtitle="Targets, build & verify — coming soon."
              gated="β.6 (conformance)"
            />
          }
        />
        <Route
          path="health"
          element={<StubPage title="Health checks" subtitle="tau check & sandbox — coming soon." />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
