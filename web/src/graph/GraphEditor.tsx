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
import {
  workflowToFlow,
  irToFlow,
  projectChecks,
  applyChecksSelection,
  type StepNodeData,
} from "./layout";
import { elkLayout } from "./elkLayout";
import { GraphCanvas } from "./GraphCanvas";
import { getCompiledIr } from "../api/ir";
import type { CompiledIr } from "../types/CompiledIr";
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
import { useProjectId } from "../app/project-context";
import { listTargets, build } from "../api/ship";
import { surfaceError } from "../notify/notify";
import { getWorkflowChecks, getRunChecks, type WorkflowChecks } from "../api/postconditions";
import type { RunCheckResult } from "../types/Postcondition";

export function GraphEditor() {
  const pid = useProjectId();
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [nodes, setNodes] = useState<Node<StepNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [edit, setEdit] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [lastHash, setLastHash] = useState<string | null>(null);
  const [view, setView] = useState<"source" | "compiled">("source");
  const [ir, setIr] = useState<CompiledIr | null>(null);
  const [wfChecks, setWfChecks] = useState<WorkflowChecks | null>(null);
  const [runResults, setRunResults] = useState<RunCheckResult[]>([]);

  async function onBuild() {
    setBuilding(true);
    try {
      const ts = await listTargets(pid);
      const target = ts.find((t) => t.status === "available")?.triple;
      if (!target) return;
      const b = await build(pid, target);
      setLastHash(b.sha256);
    } catch (e) {
      surfaceError("Build failed", e);
    } finally {
      setBuilding(false);
    }
  }

  const [recommended, setRecommended] = useState<string>("");
  useEffect(() => {
    getProviders(pid)
      .then((ps) => setRecommended(ps.find((p) => p.recommended)?.name ?? ""))
      .catch((e) => surfaceError("Failed to load providers", e));
  }, [pid]);

  const [agents, setAgents] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<{
    mode: "add" | "insert";
    anchorId: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    listAgents(pid)
      .then((as) => setAgents(as.map((a) => a.id)))
      .catch((e) => surfaceError("Failed to load agents", e));
  }, [pid]);

  useEffect(() => {
    getWorkflows(pid)
      .then((ws) => {
        setWorkflows(ws);
        setSelected((cur) => cur || ws[0] || "");
      })
      .catch((e) => surfaceError("Failed to load workflows", e));
  }, [pid]);

  useEffect(() => {
    if (!selected) return;
    getWorkflowGraph(pid, selected)
      .then((g: WorkflowGraph) => {
        const flow = workflowToFlow(g);
        setNodes(flow.nodes);
        setEdges(flow.edges);
        setSelId(flow.nodes[0]?.id ?? null);
        setEdit(false);
      })
      .catch((e) => surfaceError("Failed to load workflow graph", e));
  }, [selected, pid]);

  // fetch the compiled IR when entering the compiled view (or on project switch)
  useEffect(() => {
    if (view !== "compiled") return;
    getCompiledIr(pid)
      .then(setIr)
      .catch((e) => surfaceError("Failed to load compiled IR", e));
  }, [view, pid]);

  // load checks (mock) for the compiled view; runtime overlay from a sample run
  useEffect(() => {
    if (view !== "compiled" || !selected) return;
    getWorkflowChecks(pid, selected)
      .then(setWfChecks)
      .catch(() => setWfChecks(null));
    getRunChecks(pid, "run-retry")
      .then((r) => setRunResults(r.results))
      .catch(() => setRunResults([]));
  }, [view, selected, pid]);

  // close the inspector drawer on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // recompute the IR layout + workflow-agent highlight from the loaded IR + source nodes
  const irFlow = useMemo(() => {
    if (!ir) return { nodes: [] as Node<StepNodeData>[], edges: [] as Edge[] };
    const wfAgents = new Set(nodes.map((n) => n.data.agent).filter(Boolean) as string[]);
    return irToFlow(ir, wfAgents);
  }, [ir, nodes]);
  const irNodes = irFlow.nodes;
  const irEdges = irFlow.edges;

  // Compiled view: declare the graph (IR + checks), then let ELK position it (async).
  const declared = useMemo(
    () =>
      wfChecks
        ? projectChecks(irNodes, irEdges, wfChecks, runResults)
        : { nodes: irNodes, edges: irEdges },
    [irNodes, irEdges, wfChecks, runResults],
  );
  const [laidOutNodes, setLaidOutNodes] = useState<Node<StepNodeData>[]>([]);
  useEffect(() => {
    if (view !== "compiled" || declared.nodes.length === 0) return;
    let alive = true;
    elkLayout(declared.nodes, declared.edges)
      .then((ns) => {
        if (alive) setLaidOutNodes(ns as Node<StepNodeData>[]);
      })
      .catch(() => {
        if (alive) setLaidOutNodes(declared.nodes);
      });
    return () => {
      alive = false;
    };
  }, [view, declared]);
  const compiledEdges = useMemo(
    () => applyChecksSelection(declared.edges, selId),
    [declared.edges, selId],
  );

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

  const activeNodes = view === "compiled" ? laidOutNodes : nodes;
  const current = activeNodes.find((n) => n.id === selId) ?? null;

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
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
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
        <div
          role="group"
          aria-label="graph view"
          className="ml-2 flex overflow-hidden rounded-md border border-border text-xs"
        >
          <button
            type="button"
            aria-pressed={view === "source"}
            onClick={() => {
              setView("source");
              setSelId(null);
            }}
            className={`px-2 py-1 ${view === "source" ? "bg-accent text-accent-fg" : "text-muted"}`}
          >
            Source
          </button>
          <button
            type="button"
            aria-pressed={view === "compiled"}
            onClick={() => {
              setView("compiled");
              setSelId(null);
            }}
            className={`px-2 py-1 ${view === "compiled" ? "bg-accent text-accent-fg" : "text-muted"}`}
          >
            Compiled IR
          </button>
        </div>
        {view === "compiled" && ir && (
          <span className="font-mono text-[10px] text-muted">
            {ir.target} · {ir.hash_kind} {ir.canonical_ir_hash.slice(0, 8)}
          </span>
        )}
        {view === "source" && (
          <button
            onClick={() => setEdit((v) => !v)}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              edit ? "bg-accent text-accent-fg" : "border border-border text-muted hover:text-fg"
            }`}
          >
            {edit ? "Done" : "Edit"}
          </button>
        )}
        <button
          onClick={onBuild}
          disabled={building}
          className="ml-auto rounded-md border border-border px-3 py-1 text-xs font-semibold text-fg hover:bg-accent/10 disabled:opacity-60"
        >
          {building ? "Building…" : "Build"}
        </button>
        {lastHash && (
          <span className="font-mono text-[10px] text-st-ok" title="reproducibility hash">
            ✓ {lastHash.slice(0, 8)}
          </span>
        )}
      </div>

      {edit && (
        <div className="mx-4 mb-2 rounded-md border border-dashed border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Edit mode — changes are local (graph→TOML save is a separate track).
        </div>
      )}

      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <GraphCanvas
          nodes={view === "compiled" ? laidOutNodes : nodes}
          edges={view === "compiled" ? compiledEdges : edges}
          editable={view === "source" && edit}
          actions={actions}
          onNodesChange={view === "source" ? onNodesChange : () => {}}
          onEdgesChange={view === "source" ? onEdgesChange : () => {}}
          onConnect={view === "source" ? onConnect : () => {}}
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
        {view === "compiled" && wfChecks && (
          <div className="absolute left-3 top-3 z-10 max-w-[260px] space-y-2">
            {Object.entries(wfChecks.build)
              .filter(([, v]) => v.status === "error")
              .map(([id, v]) => (
                <div
                  key={id}
                  role="alert"
                  className="rounded-md border border-st-error/40 bg-st-error-soft px-2.5 py-2 text-[11px] text-st-error"
                >
                  <strong>{id}</strong>: {v.status === "error" ? v.message : ""}
                  {v.status === "error" && v.producer && (
                    <button
                      type="button"
                      className="mt-1 block text-accent underline"
                      onClick={() => setSelId(v.producer!)}
                    >
                      → reveal on canvas
                    </button>
                  )}
                </div>
              ))}
          </div>
        )}
        {selId && (
          <div className="absolute right-0 top-0 z-20 h-full w-[220px] overflow-auto border-l border-border bg-surface/95 p-3 text-xs shadow-[-8px_0_24px_#0007] backdrop-blur-sm">
            <div className="text-[9px] uppercase text-muted">step</div>
            {current ? (
              current.data.checkKind ? (
                <div className="space-y-1">
                  <div className="font-semibold">{current.data.label}</div>
                  <div className="text-muted">{current.data.checkKind}</div>
                  {current.data.buildError ? (
                    <div className="rounded border border-st-error/40 bg-st-error-soft px-1.5 py-1 text-[10px] text-st-error">
                      {current.data.buildError}
                    </div>
                  ) : current.data.runStatus ? (
                    <div className="flex flex-wrap items-center gap-1 text-muted">
                      verdict
                      <span
                        className={`rounded-full px-1.5 text-[10px] font-semibold ${
                          current.data.runStatus === "met"
                            ? "bg-st-ok-soft text-st-ok"
                            : "bg-st-error-soft text-st-error"
                        }`}
                      >
                        {current.data.runStatus}
                      </span>
                      {current.data.attemptCount && current.data.attemptCount > 1 ? (
                        <span className="text-[10px]">· {current.data.attemptCount} attempts</span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-muted">◇ validated</div>
                  )}
                </div>
              ) : edit ? (
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
                  {current.data.caps && current.data.caps.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 text-muted">
                      caps
                      {current.data.caps.map((c) => (
                        <span
                          key={c}
                          className="rounded bg-accent/10 px-1 text-[10px] font-medium text-accent"
                        >
                          {c}
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
        )}
      </div>
    </div>
  );
}
