import type { Span } from "../types/Span";
import type { SpanStatus } from "../types/SpanStatus";

export const ROOT_AGENT_ID = "__root__";

export interface AgentNode {
  id: string; // root: ROOT_AGENT_ID; spawned: the Agent span's id
  name: string;
  status: SpanStatus;
  parentAgentId: string | null;
  depth: number;
  toolCount: number;
  tokens: number | null;
}

export interface AgentMapData {
  agents: AgentNode[];
  edges: { source: string; target: string }[];
}

function spawnName(spanName: string): string {
  const m = /^agent\.(.+)\.spawn$/.exec(spanName);
  return m ? m[1] : spanName;
}

/** total_tokens from a few known attribute shapes (span / tool result). */
function totalTokens(attributes: unknown): number {
  const a = (attributes ?? {}) as Record<string, unknown>;
  const usage = (a.usage ?? a.token_usage ?? (a.result as Record<string, unknown>)?.usage) as
    | { total_tokens?: unknown }
    | undefined;
  return usage && typeof usage.total_tokens === "number" ? usage.total_tokens : 0;
}

/** The nearest ancestor that is an Agent span, else ROOT. */
function ownerAgent(s: Span, byId: Map<string, Span>): string {
  let p = s.parent_id;
  while (p) {
    const ps = byId.get(p);
    if (!ps) break;
    if (ps.kind === "agent") return ps.id;
    p = ps.parent_id;
  }
  return ROOT_AGENT_ID;
}

export function buildAgentMap(
  spans: Span[],
  rootAgentId: string,
  rootStatus: SpanStatus,
): AgentMapData {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const agentSpans = spans.filter((s) => s.kind === "agent");

  const depthOf = (id: string): number => {
    let d = 0;
    let cur = byId.get(id);
    while (cur) {
      const owner = ownerAgent(cur, byId);
      if (owner === ROOT_AGENT_ID) return d + 1;
      d += 1;
      cur = byId.get(owner);
    }
    return d;
  };

  const toolCount = new Map<string, number>();
  const tokens = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const s of spans) {
    const owner = s.kind === "agent" ? s.id : ownerAgent(s, byId);
    if (s.kind === "tool_call" || s.kind === "mcp_call") bump(toolCount, owner, 1);
    bump(tokens, owner, totalTokens(s.attributes));
  }

  const agents: AgentNode[] = [
    {
      id: ROOT_AGENT_ID,
      name: rootAgentId,
      status: rootStatus,
      parentAgentId: null,
      depth: 0,
      toolCount: toolCount.get(ROOT_AGENT_ID) ?? 0,
      tokens: tokens.get(ROOT_AGENT_ID) || null,
    },
    ...agentSpans.map((s) => ({
      id: s.id,
      name: spawnName(s.name),
      status: s.status,
      parentAgentId: ownerAgent(s, byId),
      depth: depthOf(s.id),
      toolCount: toolCount.get(s.id) ?? 0,
      tokens: tokens.get(s.id) || null,
    })),
  ];

  const edges = agents
    .filter((a) => a.parentAgentId !== null)
    .map((a) => ({ source: a.parentAgentId as string, target: a.id }));

  return { agents, edges };
}

/** Spawn depth + direct sub-agent count for one Agent span (for the inspector). */
export function agentSummary(
  spans: Span[],
  agentSpanId: string,
): { depth: number; children: number } {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const target = byId.get(agentSpanId);
  const children = spans.filter(
    (s) => s.kind === "agent" && ownerAgent(s, byId) === agentSpanId,
  ).length;
  if (!target) return { depth: 0, children };
  let depth = 1;
  let owner = ownerAgent(target, byId);
  while (owner !== ROOT_AGENT_ID) {
    depth += 1;
    const os = byId.get(owner);
    if (!os) break;
    owner = ownerAgent(os, byId);
  }
  return { depth, children };
}
