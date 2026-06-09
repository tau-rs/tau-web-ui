import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from "@xyflow/react";
import type { WorkflowGraph } from "../types/WorkflowGraph";
import { getWorkflows } from "../api/client";
import { getWorkflowGraph } from "../api/graph";
import { getProviders } from "../api/providers";
import { workflowToFlow, type StepNodeData } from "./layout";
import { GraphCanvas } from "./GraphCanvas";
import {
  duplicateNode,
  toggleDisabled,
  addNextStep,
  insertStepOnEdge,
  type StepPick,
} from "./edit";
import type { GraphActions } from "./GraphActions";
import { StepPalette } from "./StepPalette";
import { listAgents } from "../api/agents";

export function GraphEditor() {
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [nodes, setNodes] = useState<Node<StepNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [edit, setEdit] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);

  const [recommended, setRecommended] = useState<string>("");
  useEffect(() => {
    getProviders()
      .then((ps) => setRecommended(ps.find((p) => p.recommended)?.name ?? ""))
      .catch(() => {});
  }, []);

  const [agents, setAgents] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<{
    mode: "add" | "insert";
    anchorId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    listAgents()
      .then((as) => setAgents(as.map((a) => a.id)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getWorkflows()
      .then((ws) => {
        setWorkflows(ws);
        setSelected((cur) => cur || ws[0] || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    getWorkflowGraph(selected)
      .then((g: WorkflowGraph) => {
        const flow = workflowToFlow(g);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setSelId(flow.nodes[0]?.id ?? null);
        setEdit(false);
      })
      .catch(() => {});
  }, [selected]);

  const onNodesChange = useCallback(
    (c: NodeChange[]) => setNodes((ns) => applyNodeChanges(c, ns) as Node<StepNodeData>[]),
    [],
  );
  const onEdgesChange = useCallback(
    (c: EdgeChange[]) => setEdges((es) => applyEdgeChanges(c, es)),
    [],
  );
  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, type: "step" }, es)),
    [],
  );

  const current = nodes.find((n) => n.id === selId) ?? null;

  function updateCurrent(patch: Partial<StepNodeData>) {
    if (!current) return;
    setNodes((ns) =>
      ns.map((n) => (n.id === current.id ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  }

  function onPickStep(pick: StepPick) {
    if (!palette) return;
    const out =
      palette.mode === "add"
        ? addNextStep(nodes, edges, palette.anchorId, pick, recommended)
        : insertStepOnEdge(nodes, edges, palette.anchorId, pick, recommended);
    setNodes(out.nodes);
    setEdges(out.edges);
    setPalette(null);
  }

  const actions: GraphActions = useMemo(
    () => ({
      editable: edit,
      onInspect: (id) => setSelId(id),
      onDisable: (id) => setNodes((ns) => toggleDisabled(ns, id)),
      onDuplicate: (id) =>
        setNodes((ns) => {
          const out = duplicateNode(ns, id);
          if (out.newId) setSelId(out.newId);
          return out.nodes;
        }),
      onDelete: (id) => {
        setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
        setNodes((ns) => ns.filter((n) => n.id !== id));
        setSelId((cur) => (cur === id ? null : cur));
      },
      onRequestAdd: (fromId, at) => {
        const r = wrapRef.current?.getBoundingClientRect();
        setPalette({
          mode: "add",
          anchorId: fromId,
          x: at.x - (r?.left ?? 0),
          y: at.y - (r?.top ?? 0),
        });
      },
      onRequestInsert: (edgeId, at) => {
        const r = wrapRef.current?.getBoundingClientRect();
        setPalette({
          mode: "insert",
          anchorId: edgeId,
          x: at.x - (r?.left ?? 0),
          y: at.y - (r?.top ?? 0),
        });
      },
    }),
    [edit],
  );

  const inputCls = "mt-0.5 w-full rounded border border-border px-1.5 py-0.5 text-xs";

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Workflows / Graph</h2>
        <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">
          gated
        </span>
        <select
          aria-label="workflow"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="ml-2 rounded-md border border-border bg-surface px-2 py-1 text-xs"
        >
          {workflows.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
        <button
          onClick={() => setEdit((v) => !v)}
          className={`rounded-md px-3 py-1 text-xs font-semibold ${
            edit ? "bg-accent text-accent-fg" : "border border-border text-muted hover:text-fg"
          }`}
        >
          {edit ? "Done" : "Edit"}
        </button>
        <button
          disabled
          title="waits on tau β.2"
          className="ml-auto cursor-not-allowed rounded-md border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 opacity-80"
        >
          🔒 Build from IR
        </button>
      </div>

      {edit && (
        <div className="rounded-md border border-dashed border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Edit mode — changes are local; Save → IR waits on tau β.2.
        </div>
      )}

      <div className="grid grid-cols-[1fr_190px] gap-3">
        <div ref={wrapRef} className="relative">
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            editable={edit}
            actions={actions}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelect={(id) => {
              setSelId(id);
              if (id === null) setPalette(null);
            }}
          />
          {palette && (
            <div className="absolute z-20" style={{ left: palette.x, top: palette.y }}>
              <StepPalette agents={agents} onPick={onPickStep} onClose={() => setPalette(null)} />
            </div>
          )}
        </div>
        <div className="space-y-2 text-xs">
          <div className="text-[9px] uppercase text-muted">step</div>
          {current ? (
            edit ? (
              <div className="space-y-1.5">
                <label className="block text-muted">
                  label
                  <input
                    value={current.data.label}
                    onChange={(e) => updateCurrent({ label: e.target.value })}
                    className={inputCls}
                  />
                </label>
                {current.data.kind === "agent.run" ? (
                  <label className="block text-muted">
                    agent
                    <input
                      value={current.data.agent ?? ""}
                      onChange={(e) => updateCurrent({ agent: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                ) : (
                  <label className="block text-muted">
                    tool
                    <input
                      value={current.data.tool ?? ""}
                      onChange={(e) => updateCurrent({ tool: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                <div className="font-semibold">{current.data.label}</div>
                <div className="text-muted">{current.data.kind}</div>
                <div className="text-muted">
                  {current.data.kind === "agent.run"
                    ? `agent ${current.data.agent}`
                    : `tool ${current.data.tool}`}
                </div>
                {current.data.kind === "agent.run" && current.data.provider && (
                  <div className="flex flex-wrap items-center gap-1 text-muted">
                    provider
                    <span className="rounded bg-accent/10 px-1 text-[10px] font-medium text-accent">
                      ⚡ {current.data.provider}
                    </span>
                    {current.data.provider === recommended && (
                      <span className="rounded bg-st-ok-soft px-1 text-[10px] font-medium text-st-ok">
                        ✓ recommended
                      </span>
                    )}
                  </div>
                )}
                {current.data.tools && current.data.tools.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-muted">
                    tools
                    {current.data.tools.map((t) => (
                      <span key={t} className="rounded border border-border px-1 text-[10px]">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {current.data.input && (
                  <div className="font-mono text-[10px] text-muted">{current.data.input}</div>
                )}
              </div>
            )
          ) : (
            <div className="text-muted">Select a node.</div>
          )}
        </div>
      </div>
    </div>
  );
}
