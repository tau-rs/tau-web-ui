import { useStore } from "./store/store";
import { ProjectBar } from "./app/ProjectBar";
import { RunsView } from "./runs/RunsView";
import { TraceView } from "./trace/TraceView";

export function App() {
  const hasTrace = useStore((s) => s.currentTrace !== null);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <ProjectBar />
      <main style={{ flex: 1, minHeight: 0 }}>{hasTrace ? <TraceView /> : <RunsView />}</main>
    </div>
  );
}
