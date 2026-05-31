import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { StubPage } from "./app/StubPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { RunsPage } from "./runs/RunsPage";
import { TracePage } from "./trace/TracePage";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route
          path="agents"
          element={<StubPage title="Agents" subtitle="Author agents — coming soon." />}
        />
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
        <Route
          path="packages"
          element={
            <StubPage title="Packages" subtitle="Install & manage packages — coming soon." />
          }
        />
        <Route
          path="config"
          element={
            <StubPage
              title="Config & Capabilities"
              subtitle="Project config & capability profiles — coming soon."
              gated="β.5 (credentials)"
            />
          }
        />
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
        <Route path="*" element={<Navigate to="/runs" replace />} />
      </Route>
    </Routes>
  );
}
