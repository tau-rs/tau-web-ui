import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./app/AppLayout";
import { DashboardPage } from "./dashboard/DashboardPage";
import { HealthPage } from "./health/HealthPage";
import { RunsPage } from "./runs/RunsPage";
import { TracePage } from "./trace/TracePage";

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:id" element={<TracePage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="*" element={<Navigate to="/runs" replace />} />
      </Route>
    </Routes>
  );
}
