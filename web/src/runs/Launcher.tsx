import { useState } from "react";
import { useStore } from "../store/store";

export function Launcher() {
  const project = useStore((s) => s.project);
  const launch = useStore((s) => s.launch);
  const [agent, setAgent] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const agents = project?.agents ?? [];
  const selected = agent || agents[0] || "";

  async function onRun() {
    if (!selected || !prompt.trim()) return;
    setBusy(true);
    try { await launch(selected, prompt); setPrompt(""); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
      <select value={selected} onChange={(e) => setAgent(e.target.value)} aria-label="agent">
        {agents.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <input style={{ flex: 1 }} placeholder="Prompt…" value={prompt}
        aria-label="prompt"
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onRun()} />
      <button onClick={onRun} disabled={busy || !selected}>{busy ? "Running…" : "Run"}</button>
    </div>
  );
}
