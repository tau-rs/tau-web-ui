import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store/store";
import { useProjectId } from "../app/project-context";

type Mode = "agent" | "workflow";

export function Launcher() {
  const project = useStore((s) => s.project);
  const workflows = useStore((s) => s.workflows);
  const launch = useStore((s) => s.launch);
  const launchWorkflow = useStore((s) => s.launchWorkflow);
  const loadWorkflows = useStore((s) => s.loadWorkflows);
  const pid = useProjectId();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>("agent");
  const [agent, setAgent] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadWorkflows(pid).catch(() => {});
  }, [loadWorkflows, pid]);

  const agents = project?.agents ?? [];
  const selAgent = agent || agents[0] || "";
  const selWorkflow = workflow || workflows[0] || "";
  const target = mode === "agent" ? selAgent : selWorkflow;

  async function onRun() {
    if (!target || !prompt.trim()) return;
    setBusy(true);
    try {
      const id =
        mode === "agent"
          ? await launch(pid, selAgent, prompt)
          : await launchWorkflow(pid, selWorkflow, prompt);
      setPrompt("");
      navigate(`/projects/${pid}/runs/${id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-xs">
        {(["agent", "workflow"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-2.5 py-1 font-medium capitalize ${
              mode === m ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
            }`}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
      {mode === "agent" ? (
        <select
          value={selAgent}
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
      ) : (
        <select
          value={selWorkflow}
          onChange={(e) => setWorkflow(e.target.value)}
          aria-label="workflow"
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
        >
          {workflows.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      )}
      <input
        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
        placeholder={mode === "agent" ? "Prompt…" : "Workflow input…"}
        value={prompt}
        aria-label="prompt"
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onRun()}
      />
      <button
        onClick={onRun}
        disabled={busy || !target}
        className="rounded-md bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-fg disabled:opacity-50"
      >
        {busy ? "Running…" : "Run"}
      </button>
    </div>
  );
}
