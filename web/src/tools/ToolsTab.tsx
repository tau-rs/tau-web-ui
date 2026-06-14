import { useEffect, useState } from "react";
import type { ToolCatalog } from "../types/ToolCatalog";
import type { ToolDetail } from "../types/ToolDetail";
import { listTools } from "../api/tools";
import { useProjectId } from "../app/project-context";
import { surfaceError } from "../notify/notify";

const MAX_CHIPS = 6;

export function ToolsTab() {
  const pid = useProjectId();
  const [cat, setCat] = useState<ToolCatalog>({ tools: [], error_count: 0 });
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    listTools(pid)
      .then(setCat)
      .catch((e) => surfaceError("Failed to load tools", e));
  }, [pid]);

  function toggle(name: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {cat.error_count > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          {cat.error_count} plugin{cat.error_count === 1 ? "" : "s"} failed to introspect — see the
          Plugins tab.
        </div>
      )}
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 pr-2 font-medium">tool</th>
            <th className="px-2 py-1 font-medium">version</th>
            <th className="px-2 py-1 font-medium">provides</th>
            <th className="px-2 py-1 font-medium">capabilities</th>
            <th className="px-2 py-1 font-medium">used by</th>
          </tr>
        </thead>
        <tbody>
          {cat.tools.map((t) => (
            <ToolRow
              key={t.name}
              tool={t}
              expanded={open.has(t.name)}
              onToggle={() => toggle(t.name)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ToolRow({
  tool,
  expanded,
  onToggle,
}: {
  tool: ToolDetail;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-border/60">
        <td className="py-1 pr-2 font-medium">
          <button onClick={onToggle} className="text-accent">
            <span>{tool.name}</span> {expanded ? "▾" : "▸"}
          </button>
        </td>
        <td className="px-2 py-1 text-muted">{tool.version ?? "—"}</td>
        <td className="px-2 py-1 font-mono text-muted">{tool.provides}</td>
        <td className="px-2 py-1 font-mono text-muted">
          {tool.capabilities.map((c) => c.kind).join(", ") || "—"}
        </td>
        <td className="px-2 py-1 text-muted">{tool.used_by.length}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/60 bg-accent/5">
          <td colSpan={5} className="px-4 py-3 text-xs">
            <div className="mb-1.5">
              <span className="text-[9px] uppercase text-muted">provides </span>
              port <b>{tool.provides}</b>
              {tool.plugin_kind && ` · ${tool.plugin_kind}`}
              {tool.binary && (
                <>
                  {" · binary "}
                  <span className="font-mono">{tool.binary}</span>
                </>
              )}
            </div>
            <div className="mb-1.5">
              <span className="text-[9px] uppercase text-muted">capabilities </span>
              {tool.capabilities.map((c) => (
                <span key={c.kind} className="mr-2 font-mono">
                  {c.kind}{" "}
                  {Object.entries(c.fields)
                    .filter((entry): entry is [string, string[]] => entry[1] !== undefined)
                    .map(([k, v]) => `${k}=[${v.join(", ")}]`)
                    .join(" ")}
                </span>
              ))}
            </div>
            <div className="mb-1.5">
              <span className="text-[9px] uppercase text-muted">used by </span>
              {tool.used_by.length === 0 ? (
                <span className="text-muted">unused</span>
              ) : (
                <>
                  {tool.used_by.slice(0, MAX_CHIPS).map((u) => (
                    <span
                      key={`${u.kind}:${u.name}`}
                      className={`mr-1 inline-block rounded-full px-2 text-[9px] ${
                        u.kind === "skill" ? "bg-st-ok/15 text-st-ok" : "bg-accent/10 text-accent"
                      }`}
                    >
                      {u.name}
                    </span>
                  ))}
                  {tool.used_by.length > MAX_CHIPS && (
                    <span className="text-[9px] font-semibold text-accent">
                      +{tool.used_by.length - MAX_CHIPS} more
                    </span>
                  )}
                </>
              )}
            </div>
            <div>
              <span className="text-[9px] uppercase text-muted">source </span>
              <span className="font-mono text-muted">{tool.source}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
