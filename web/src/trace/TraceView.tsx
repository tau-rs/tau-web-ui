import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { AgentMap } from "./AgentMapView";
import { TraceTimeline } from "./TraceTimeline";
import { AssistantStream } from "./AssistantStream";
import { SpanInspector } from "./SpanInspector";
import { RunControls } from "./RunControls";
import { Tabs } from "./Tabs";

type TraceTab = "graph" | "timeline";

export function TraceView() {
  const trace = useStore((s) => s.currentTrace);
  const selectedId = useStore((s) => s.selectedSpanId);
  const pid = useStore((s) => s.activeProjectId);
  const navigate = useNavigate();
  const isWorkflow = trace?.run.source === "log";
  // Default the tab from the trace kind (workflow → timeline, agent → graph), but
  // let the user override by clicking. Re-derive only when isWorkflow flips, using
  // the documented "adjust state during render" pattern instead of an effect —
  // a synchronous setState in an effect would trigger a cascading render.
  const [tab, setTab] = useState<TraceTab>(isWorkflow ? "timeline" : "graph");
  const [prevIsWorkflow, setPrevIsWorkflow] = useState(isWorkflow);
  if (isWorkflow !== prevIsWorkflow) {
    setPrevIsWorkflow(isWorkflow);
    setTab(isWorkflow ? "timeline" : "graph");
  }

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
              { id: "graph", label: "Agents" },
              { id: "timeline", label: "Timeline" },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        <button onClick={() => navigate(`/projects/${pid}/runs`)} className="text-xs text-accent">
          ← Back to runs
        </button>
      </div>
      <RunControls />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-[2] border-r border-border">
          {tab === "graph" ? (
            <AgentMap spans={trace.spans} run={trace.run} />
          ) : (
            <TraceTimeline spans={trace.spans} />
          )}
        </div>
        <div className="min-w-[280px] flex-1 overflow-auto">
          <SpanInspector span={selected} spans={trace.spans} workflow={isWorkflow} />
        </div>
      </div>
      <AssistantStream />
    </section>
  );
}
