import { useState } from "react";
import type { StepPick } from "./edit";

export function StepPalette({
  agents,
  onPick,
  onClose,
}: {
  agents: string[];
  onPick: (pick: StepPick) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const ql = q.toLowerCase();
  const showAgentRun = "agent.run".includes(ql);
  const showToolCall = "tool.call".includes(ql);
  const matched = agents.filter((a) => a.toLowerCase().includes(ql));
  const item = "flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent/10";
  const dot = "flex h-4 w-4 flex-none items-center justify-center rounded text-[8px]";
  return (
    <div
      role="dialog"
      aria-label="add step"
      className="w-44 overflow-hidden rounded-lg border border-border bg-surface text-xs shadow-lg"
    >
      <input
        autoFocus
        aria-label="search steps"
        placeholder="search…"
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        onKeyDown={(ev) => ev.key === "Escape" && onClose()}
        className="w-full border-b border-border bg-surface px-2 py-1.5 text-xs outline-none"
      />
      <div className="max-h-44 overflow-auto py-1">
        {showAgentRun && (
          <button type="button" className={item} onClick={() => onPick({ kind: "agent.run" })}>
            <span aria-hidden className={`${dot} bg-accent text-white`}>
              ◆
            </span>
            agent.run
          </button>
        )}
        {showToolCall && (
          <button type="button" className={item} onClick={() => onPick({ kind: "tool.call" })}>
            <span aria-hidden className={`${dot} bg-st-running text-white`}>
              ⚒
            </span>
            tool.call
          </button>
        )}
        {matched.length > 0 && (
          <div className="px-2 pb-0.5 pt-1.5 text-[9px] uppercase text-muted">agents</div>
        )}
        {matched.map((a) => (
          <button
            key={a}
            type="button"
            className={item}
            onClick={() => onPick({ kind: "agent.run", agent: a })}
          >
            <span aria-hidden className={`${dot} bg-accent/20 text-accent`}>
              ◆
            </span>
            {a}
          </button>
        ))}
        {!showAgentRun && !showToolCall && matched.length === 0 && (
          <div className="px-2 py-1 text-muted">no matches</div>
        )}
      </div>
    </div>
  );
}
