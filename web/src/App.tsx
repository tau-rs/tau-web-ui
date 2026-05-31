import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { StubPage } from "./app/StubPage";
import { ConfigPage } from "./config/ConfigPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { PackagesPage } from "./packages/PackagesPage";
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
        <Route path="*" element={<Navigate to="/runs" replace />} />
      </Route>
    </Routes>
  );
}
