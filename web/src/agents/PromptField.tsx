import type { AgentPrompt } from "../types/AgentPrompt";

export function PromptField({
  mode,
  prompt,
  onModeChange,
  onChange,
}: {
  mode: "system" | "file";
  prompt: AgentPrompt;
  onModeChange: (m: "system" | "file") => void;
  onChange: (p: AgentPrompt) => void;
}) {
  const tab = (active: boolean) =>
    `rounded px-2 py-0.5 text-[10px] font-semibold ${
      active ? "bg-accent text-accent-fg" : "border border-border text-muted"
    }`;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <button type="button" className={tab(mode === "system")} onClick={() => onModeChange("system")}>
          Inline
        </button>
        <button type="button" className={tab(mode === "file")} onClick={() => onModeChange("file")}>
          File
        </button>
      </div>
      {mode === "system" ? (
        <textarea
          aria-label="system prompt"
          className="h-28 w-full rounded border border-border bg-surface px-2 py-1 text-xs"
          value={prompt.system ?? ""}
          onChange={(e) => onChange({ system: e.target.value || null, system_file: null })}
        />
      ) : (
        <input
          aria-label="system prompt file"
          placeholder="agents/researcher.md"
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
          value={prompt.system_file ?? ""}
          onChange={(e) => onChange({ system: null, system_file: e.target.value || null })}
        />
      )}
    </div>
  );
}
