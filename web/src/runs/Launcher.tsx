import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";

export function Launcher() {
  const project = useStore((s) => s.project);
  const launch = useStore((s) => s.launch);
  const navigate = useNavigate();
  const [agent, setAgent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const agents = project?.agents ?? [];
  const selected = agent || agents[0] || "";

  async function onRun() {
    if (!selected || !prompt.trim()) return;
    setBusy(true);
    try {
      const id = await launch(selected, prompt);
      setPrompt("");
      navigate(`/runs/${id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setAgent(e.target.value)}
        aria-label="agent"
        className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
      >
        {agents.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <input
        className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
        placeholder="Prompt…"
        value={prompt}
        aria-label="prompt"
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onRun()}
      />
      <button
        onClick={onRun}
        disabled={busy || !selected}
        className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
      >
        {busy ? "Running…" : "Run"}
      </button>
    </div>
  );
}
