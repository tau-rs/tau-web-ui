import { useCallback, useEffect, useState } from "react";
import type { ProjectConfig } from "../types/ProjectConfig";
import { getConfig, putConfig, importAgent } from "../api/config";
import { useProjectId } from "../app/project-context";
import { surfaceError } from "../notify/notify";
import { CapabilitiesCard } from "./CapabilitiesCard";

export function ConfigPage() {
  const pid = useProjectId();
  const [cfg, setCfg] = useState<ProjectConfig | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importBackend, setImportBackend] = useState("anthropic");

  const reload = useCallback(
    () =>
      getConfig(pid)
        .then((c) => {
          setCfg(c);
          setName(c.name);
          setDescription(c.description ?? "");
        })
        .catch(() => {}),
    [pid],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const backends = Array.from(
    new Set((cfg?.agents ?? []).map((a) => a.llm_backend).filter(Boolean) as string[]),
  );
  if (!backends.includes("anthropic")) backends.push("anthropic");

  async function onSave() {
    try {
      await putConfig(pid, name, description);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      reload();
    } catch (err) {
      surfaceError("Failed to save config", err);
    }
  }

  async function onImport() {
    if (!importUrl.trim()) return;
    await importAgent(pid, importUrl, importBackend).catch(() => {});
    setImportUrl("");
    reload();
  }

  const card = "rounded-lg border border-border bg-surface p-3";
  const label = "mb-1 block text-[10px] uppercase tracking-wide text-muted";
  const input = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-base font-semibold">Config &amp; Capabilities</h2>

      <div className={card}>
        <h3 className="mb-2 text-xs font-semibold">Project</h3>
        <div className="mb-2">
          <label className={label}>name</label>
          <input
            aria-label="project name"
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="mb-2">
          <label className={label}>description</label>
          <input
            aria-label="project description"
            className={input}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onSave}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
          >
            Save
          </button>
          {saved && <span className="text-xs text-st-ok">✓ saved to tau.toml</span>}
        </div>
      </div>

      <div className={card}>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-xs font-semibold">Agents</h3>
          <span className="text-[10px] text-muted">· read-only (edit in Agents)</span>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-accent/40 bg-accent/5 p-2">
          <input
            aria-label="import git url"
            placeholder="https://github.com/org/agent.git"
            className={`flex-1 ${input}`}
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
          />
          <select
            aria-label="import llm backend"
            className={input.replace("w-full", "w-28")}
            value={importBackend}
            onChange={(e) => setImportBackend(e.target.value)}
          >
            {backends.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            onClick={onImport}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
          >
            Import
          </button>
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 pr-2 font-medium">agent</th>
              <th className="px-2 py-1 font-medium">llm_backend</th>
              <th className="px-2 py-1 font-medium">package</th>
              <th className="px-2 py-1 font-medium">source</th>
            </tr>
          </thead>
          <tbody>
            {(cfg?.agents ?? []).map((a) => (
              <tr key={a.id} className="border-b border-border/60 last:border-0">
                <td className="py-1 pr-2 font-medium">{a.id}</td>
                <td className="px-2 py-1 font-mono text-muted">{a.llm_backend ?? "—"}</td>
                <td className="px-2 py-1 font-mono text-muted">{a.package ?? "—"}</td>
                <td className="px-2 py-1 font-mono text-muted">{a.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CapabilitiesCard />

      <div className={card}>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-xs font-semibold">Credentials</h3>
          <span className="rounded bg-amber-100 px-1.5 text-[10px] font-bold uppercase text-amber-800">
            gated · β.5
          </span>
        </div>
        <p className="text-xs text-muted">
          Provider chain (Env · File · SecretMgr · TokenBroker) — lands when tau ships the
          credential provider chain.
        </p>
      </div>
    </div>
  );
}
