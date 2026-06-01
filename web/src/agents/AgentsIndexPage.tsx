import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AgentDetail } from "../types/AgentDetail";
import { listAgents } from "../api/agents";

export function AgentsIndexPage() {
  const { pid } = useParams();
  const [agents, setAgents] = useState<AgentDetail[]>([]);

  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold">Agents</h2>
        <Link
          to={`/projects/${pid}/agents/new`}
          className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          + New agent
        </Link>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 pr-2 font-medium">agent</th>
            <th className="px-2 py-1 font-medium">display name</th>
            <th className="px-2 py-1 font-medium">llm_backend</th>
            <th className="px-2 py-1 font-medium">package</th>
            <th className="px-2 py-1 font-medium">tools</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-2 font-medium">
                <Link to={`/projects/${pid}/agents/${a.id}`} className="text-accent">
                  {a.id}
                </Link>
              </td>
              <td className="px-2 py-1 text-muted">{a.display_name ?? "—"}</td>
              <td className="px-2 py-1 font-mono text-muted">{a.llm_backend ?? "—"}</td>
              <td className="px-2 py-1 font-mono text-muted">{a.package ?? "—"}</td>
              <td className="px-2 py-1 text-muted">{a.requires_tools.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
