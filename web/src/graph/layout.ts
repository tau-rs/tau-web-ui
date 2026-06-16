import type { Node, Edge } from "@xyflow/react";
import type { WorkflowGraph } from "../types/WorkflowGraph";
import type { CompiledIr } from "../types/CompiledIr";
import type { WorkflowChecks } from "../api/postconditions";
import type { RunCheckResult } from "../types/Postcondition";

export interface StepNodeData extends Record<string, unknown> {
  label: string;
  kind: string; // "agent.run" | "tool.call"
  agent: string | null;
  tool: string | null;
  input: string | null;
  provider: string | null;
  tools: string[];
  caps?: string[]; // tool.call nodes (compiled IR view): capability requirements
  disabled?: boolean;
  // --- postcondition checks (mock) ---
  checkKind?: "goal" | "deliverable"; // set on CheckNode (type "check")
  buildError?: string; // design-time: dashed-red border + message
  runStatus?: "met" | "failed" | "aborted" | null; // runtime corner badge
  attemptCount?: number; // runtime: ×N when > 1
  goalBadges?: { id: string; status: "met" | "failed" | "validated" }[]; // on producer StepNodes
}

export const X_GAP = 220;
const Y_GAP = 70;

/**
 * Deterministic DAG layout: x = dependency depth (longest path from a root),
 * y = order within a depth. Assumes an acyclic graph (workflow DAG).
 */
export function workflowToFlow(graph: WorkflowGraph): {
  nodes: Node<StepNodeData>[];
  edges: Edge[];
} {
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
  }

  const depthCache = new Map<string, number>();
  const depth = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const srcs = incoming.get(id) ?? [];
    const d = srcs.length === 0 ? 0 : Math.max(...srcs.map(depth)) + 1;
    depthCache.set(id, d);
    return d;
  };

  const seenAtDepth = new Map<number, number>();
  const nodes: Node<StepNodeData>[] = graph.nodes.map((n) => {
    const d = depth(n.id);
    const order = seenAtDepth.get(d) ?? 0;
    seenAtDepth.set(d, order + 1);
    return {
      id: n.id,
      type: "step",
      position: { x: d * X_GAP, y: order * Y_GAP },
      data: {
        label: n.label,
        kind: n.kind,
        agent: n.agent,
        tool: n.tool,
        input: n.input,
        provider: n.provider,
        tools: n.tools,
      },
    };
  });

  const edges: Edge[] = graph.edges.map((e) => ({
    id: `${e.source}->${e.target}`,
    source: e.source,
    target: e.target,
    type: "step",
  }));

  return { nodes, edges };
}

/**
 * Lay out the compiled project IR: agents as `agent.run` nodes, tools as
 * `tool.call` nodes, subflow edges between them. Agents NOT in `workflowAgents`
 * are dimmed (they belong to the project but not the selected workflow).
 */
export function irToFlow(
  ir: CompiledIr,
  workflowAgents: Set<string>,
): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const graph: WorkflowGraph = {
    workflow: "",
    nodes: [
      ...ir.agents.map((a) => ({
        id: a.id,
        kind: "agent.run",
        label: a.id,
        agent: a.id,
        tool: null,
        input: null,
        provider: a.llm_backend,
        tools: a.tools,
      })),
      ...ir.tools.map((t) => ({
        id: t.id,
        kind: "tool.call",
        label: t.id,
        agent: null,
        tool: t.id,
        input: null,
        provider: null,
        tools: [],
      })),
    ],
    edges: ir.edges.map((e) => ({ source: e.from, target: e.to })),
  };
  const flow = workflowToFlow(graph);
  const caps = new Map(ir.tools.map((t) => [t.id, t.capabilities]));
  flow.nodes = flow.nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      caps: n.data.kind === "tool.call" ? (caps.get(n.id) ?? []) : undefined,
    },
    style: n.data.kind === "agent.run" && !workflowAgents.has(n.id) ? { opacity: 0.4 } : undefined,
  }));
  return flow;
}

/**
 * Overlay checks onto an existing flow: deliverables become `check` nodes wired
 * after their producer with a `rewind` edge back to the gate; goals become
 * badges on the node that produces what they evaluate (spec: grammar C).
 * `runResults` is empty when no run is selected (design-time view).
 */
export function projectChecks(
  nodes: Node<StepNodeData>[],
  edges: Edge[],
  wf: WorkflowChecks,
  runResults: RunCheckResult[],
): { nodes: Node<StepNodeData>[]; edges: Edge[] } {
  const runById = new Map(runResults.map((r) => [r.id, r]));
  const outNodes = [...nodes];
  const outEdges = [...edges];
  const goalsByProducer = new Map<
    string,
    { id: string; status: "met" | "failed" | "validated" }[]
  >();

  for (const c of wf.checks) {
    const build = wf.build[c.id];
    const producer = wf.producerOf[c.id];
    const run = runById.get(c.id);
    if (c.verify.kind === "goal") {
      if (!producer) continue;
      const status = run ? (run.final === "met" ? "met" : "failed") : "validated";
      const list = goalsByProducer.get(producer) ?? [];
      list.push({ id: c.id, status });
      goalsByProducer.set(producer, list);
      continue;
    }
    // deliverable → node + forward edge + rewind (feedback) edge.
    // Positions are assigned later by ELK; we only declare the graph here.
    const checkId = `check-${c.id}`;
    outNodes.push({
      id: checkId,
      type: "check",
      position: { x: 0, y: 0 },
      connectable: false,
      data: {
        label: c.id,
        kind: "check.deliverable",
        agent: null,
        tool: null,
        input: null,
        provider: null,
        tools: [],
        checkKind: "deliverable",
        buildError: build?.status === "error" ? build.message : undefined,
        runStatus: run ? run.final : null,
        attemptCount: run?.attempts.length,
      },
    });
    outEdges.push({
      id: `${producer}->${checkId}`,
      source: producer,
      target: checkId,
      type: "step",
    });
    outEdges.push({
      id: `${checkId}->${c.retry.gate}`,
      source: checkId,
      target: c.retry.gate,
      type: "rewind",
      sourceHandle: "rw",
      targetHandle: "rw",
      data: { attempts: run?.attempts.length ?? c.retry.max_attempts },
    });
  }

  const patchedNodes = outNodes.map((n) => {
    const badges = goalsByProducer.get(n.id);
    return badges ? { ...n, data: { ...n.data, goalBadges: badges } } : n;
  });
  return { nodes: patchedNodes, edges: outEdges };
}

/** Emphasis pass: when a check node is selected, dim every rewind edge that is
 *  not its own (spec R2 pair-highlight, as a pure transform). */
export function applyChecksSelection(edges: Edge[], selectedId: string | null): Edge[] {
  return edges.map((e) => {
    if (e.type !== "rewind") return e;
    const dimmed = selectedId != null && e.source !== selectedId;
    return { ...e, data: { ...(e.data ?? {}), dimmed } };
  });
}
