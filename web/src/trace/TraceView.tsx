import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { TraceGraph } from "./TraceGraph";
import { TraceTimeline } from "./TraceTimeline";
import { AssistantStream } from "./AssistantStream";
import { SpanInspector } from "./SpanInspector";
import { RunControls } from "./RunControls";
import { Tabs } from "./Tabs";

type TraceTab = "graph" | "timeline";

export function TraceView() {
  const trace = useStore((s) => s.currentTrace);
  const selectedId = useStore((s) => s.selectedSpanId);
  const navigate = useNavigate();
  const [tab, setTab] = useState<TraceTab>("graph");
  const isWorkflow = trace?.run.source === "log";

  useEffect(() => {
    setTab(isWorkflow ? "timeline" : "graph");
  }, [isWorkflow]);

  if (!trace) {
    return <section className="p-4 text-sm text-muted">Select a run to view its trace.</section>;
  }
  const selected = trace.spans.find((s) => s.id === selectedId) ?? null;

  return (
    <section className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-3">
          <strong className="text-sm">Trace · {trace.run.agent_id}</strong>
          <Tabs
            tabs={[
              { id: "graph", label: "Graph" },
              { id: "timeline", label: "Timeline" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        <button onClick={() => navigate("/runs")} className="text-xs text-accent">
          ← Back to runs
        </button>
      </div>
      <RunControls />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[2] border-r border-border">
          {tab === "graph" ? (
            <TraceGraph spans={trace.spans} />
          ) : (
            <TraceTimeline spans={trace.spans} />
          )}
        </div>
        <div className="min-w-[280px] flex-1 overflow-auto">
          <SpanInspector span={selected} workflow={isWorkflow} />
        </div>
      </div>
      <AssistantStream />
    </section>
  );
}
