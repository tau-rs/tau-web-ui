import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import type { AgentDetail } from "../types/AgentDetail";
import type { AgentPrompt } from "../types/AgentPrompt";
import type { Provider } from "../types/Provider";
import { getAgent, putAgent, deleteAgent } from "../api/agents";
import { getProviders } from "../api/providers";
import { useProjectId } from "../app/project-context";
import { PromptField } from "./PromptField";
import { RequiresToolsEditor } from "./RequiresToolsEditor";

const ID_RE = /^[A-Za-z0-9_-]+$/;

const blank = (): AgentDetail => ({
  id: "",
  display_name: null,
  package: null,
  llm_backend: null,
  prompt: { system: null, system_file: null },
  requires_tools: [],
});

export function AgentEditorPage() {
  const { agentId } = useParams();
  const pid = useProjectId();
  const isNew = agentId === undefined; // route /agents/new has no :agentId
  const navigate = useNavigate();

  const [a, setA] = useState<AgentDetail>(blank());
  const [promptMode, setPromptMode] = useState<"system" | "file">("system");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew || !agentId) return;
    getAgent(pid, agentId)
      .then((d) => {
        setA({ ...blank(), ...d, requires_tools: d.requires_tools ?? [] });
        setPromptMode(d.prompt.system_file ? "file" : "system");
      })
      .catch(() => setError("could not load agent"));
  }, [isNew, agentId, pid]);

  const [providers, setProviders] = useState<Provider[]>([]);
  const recommended = providers.find((p) => p.recommended)?.name ?? "";

  useEffect(() => {
    getProviders(pid)
      .then((ps) => {
        if (!Array.isArray(ps)) return;
        setProviders(ps);
        if (isNew) {
          const rec = ps.find((p) => p.recommended)?.name;
          if (rec) setA((prev) => (prev.llm_backend ? prev : { ...prev, llm_backend: rec }));
        }
      })
      .catch(() => {});
  }, [isNew, pid]);

  const label = "mb-1 block text-[10px] uppercase tracking-wide text-muted";
  const input = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  const set = (patch: Partial<AgentDetail>) => setA((prev) => ({ ...prev, ...patch }));
  const toolCount = useMemo(() => a.requires_tools.length, [a.requires_tools]);

  async function onSave() {
    setError(null);
    const id = isNew ? a.id.trim() : agentId!;
    if (isNew && !ID_RE.test(id)) {
      setError("invalid id — use letters, digits, _ or -");
      return;
    }
    const payload: AgentDetail = {
      ...a,
      id,
      prompt:
        promptMode === "system"
          ? { system: a.prompt.system || null, system_file: null }
          : { system: null, system_file: a.prompt.system_file || null },
      // Drop blank tool rows so we never write a meaningless requires.tools entry.
      requires_tools: a.requires_tools.filter((t) => t.name.trim() && t.source.trim()),
    };
    try {
      await putAgent(pid, payload, { create: isNew });
      navigate(`/projects/${pid}/agents/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  async function onDelete() {
    if (isNew || !agentId) return;
    try {
      await deleteAgent(pid, agentId);
      navigate(`/projects/${pid}/agents`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4">
      <button
        type="button"
        onClick={() => navigate(`/projects/${pid}/agents`)}
        className="text-xs text-accent"
      >
        ← all agents
      </button>
      <h2 className="text-base font-semibold">{isNew ? "New agent" : agentId}</h2>

      <div className="rounded-lg border border-border bg-surface p-3 space-y-2.5">
        <div>
          <label className={label}>agent id</label>
          <input
            aria-label="agent id"
            className={input}
            disabled={!isNew}
            value={a.id}
            onChange={(e) => set({ id: e.target.value })}
          />
        </div>
        <div>
          <label className={label}>display name</label>
          <input
            aria-label="display name"
            className={input}
            value={a.display_name ?? ""}
            onChange={(e) => set({ display_name: e.target.value || null })}
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={label}>package</label>
            <input
              aria-label="package"
              className={input}
              placeholder="fs-read@^0.1"
              value={a.package ?? ""}
              onChange={(e) => set({ package: e.target.value || null })}
            />
          </div>
          <div className="w-56">
            <label className={label}>llm provider</label>
            <input
              list="llm-providers"
              aria-label="llm backend"
              className={input}
              placeholder="anthropic"
              value={a.llm_backend ?? ""}
              onChange={(e) => set({ llm_backend: e.target.value || null })}
            />
            <datalist id="llm-providers">
              {providers.map((p) => (
                <option key={p.name} value={p.name} />
              ))}
            </datalist>
            <div className="mt-1 flex items-center gap-2">
              {recommended && (
                <button
                  type="button"
                  onClick={() => set({ llm_backend: recommended })}
                  className="rounded-full bg-st-ok-soft px-2 py-0.5 text-[9px] font-semibold text-st-ok"
                  title="use the recommended provider"
                >
                  ✓ recommended: {recommended}
                </button>
              )}
              <Link to={`/projects/${pid}/providers`} className="text-[9px] text-accent">
                ⚙ Manage providers…
              </Link>
            </div>
          </div>
        </div>
        <div>
          <label className={label}>system prompt</label>
          <PromptField
            mode={promptMode}
            prompt={a.prompt}
            onModeChange={setPromptMode}
            onChange={(p: AgentPrompt) => set({ prompt: p })}
          />
        </div>
        <div>
          <label className={label}>requires.tools ({toolCount})</label>
          <RequiresToolsEditor
            tools={a.requires_tools}
            onChange={(t) => set({ requires_tools: t })}
          />
        </div>
      </div>

      {error && <div className="text-xs text-st-error">{error}</div>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          Save
        </button>
        {!isNew && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md border border-st-error/40 px-3 py-1.5 text-xs font-semibold text-st-error"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
