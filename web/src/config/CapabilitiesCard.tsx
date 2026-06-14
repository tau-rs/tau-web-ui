import { useEffect, useState } from "react";
import type { AgentCapabilities } from "../types/AgentCapabilities";
import type { CapabilityRow } from "../types/CapabilityRow";
import { getCapabilities } from "../api/caps";
import { useProjectId } from "../app/project-context";
import { surfaceError } from "../notify/notify";

function fmtBytes(n: bigint): string {
  const b = Number(n);
  if (b >= 1_048_576) return `≤ ${Math.round(b / 1_048_576)} MB`;
  if (b >= 1024) return `≤ ${Math.round(b / 1024)} KB`;
  return `≤ ${b} B`;
}

/** Allow-list values for a row, across the per-kind field names. */
function allows(c: CapabilityRow): string[] {
  return [...(c.allow_paths ?? []), ...(c.allow_hosts ?? []), ...(c.allow_commands ?? [])];
}
function denies(c: CapabilityRow): string[] {
  return [...c.deny_paths, ...c.deny_hosts, ...c.deny_commands];
}

function Chips({ cap }: { cap: CapabilityRow }) {
  const a = allows(cap);
  const d = denies(cap);
  return (
    <span className="mr-2 inline-flex flex-wrap items-center gap-1">
      <span className="text-muted">{cap.kind}</span>
      {a.map((v) => (
        <span
          key={`a-${v}`}
          className="rounded-full bg-st-ok-soft px-1.5 font-mono text-[10px] text-st-ok"
        >
          {v}
        </span>
      ))}
      {d.map((v) => (
        <span
          key={`d-${v}`}
          className="rounded-full bg-st-error-soft px-1.5 font-mono text-[10px] text-st-error"
        >
          {v}
        </span>
      ))}
      {cap.max_bytes != null && (
        <span className="text-[10px] text-muted">{fmtBytes(cap.max_bytes)}</span>
      )}
    </span>
  );
}

export function CapabilitiesCard() {
  const pid = useProjectId();
  const [rows, setRows] = useState<AgentCapabilities[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Guard against setState after unmount (this component fetches on mount).
    let live = true;
    getCapabilities(pid)
      .then((r) => live && setRows(r))
      .catch((err) => {
        if (!live) return;
        setError(true);
        surfaceError("Failed to load capabilities", err);
      });
    return () => {
      live = false;
    };
  }, [pid]);

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold">Effective Capabilities</h3>
        <span className="text-[10px] text-muted">· live · read-only</span>
      </div>

      {error && <p className="text-xs text-st-error">Could not load capabilities.</p>}
      {!error && rows == null && <p className="text-xs text-muted">Loading…</p>}
      {!error && rows?.length === 0 && (
        <p className="text-xs text-muted">No agents in this project.</p>
      )}

      {rows && rows.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">agent</th>
              <th className="px-2 py-1 font-medium">capabilities</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.agent_id} className="border-b border-border/60 align-top last:border-0">
                <td className="py-1 pr-2 font-mono font-medium" title={a.display_name}>
                  {a.agent_id}
                </td>
                <td className="px-2 py-1">
                  {a.effective == null ? (
                    <span className="text-muted">unavailable — package not installed</span>
                  ) : a.effective.length === 0 ? (
                    <span className="text-muted">no capabilities — fully sandboxed</span>
                  ) : (
                    a.effective.map((c, i) => <Chips key={`${c.kind}-${i}`} cap={c} />)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
