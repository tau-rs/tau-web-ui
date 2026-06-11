import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { SkillDetail } from "../types/SkillDetail";
import { getSkill, putSkill, deleteSkill } from "../api/skills";
import { useProjectId } from "../app/project-context";
import { CapabilitiesEditor } from "./CapabilitiesEditor";
import { PackageDepEditor } from "./PackageDepEditor";

const NAME_RE = /^[a-z0-9-]+$/;

const blank = (): SkillDetail => ({
  name: "",
  description: null,
  version: null,
  source: "",
  editable: true,
  content: "",
  capabilities: [],
  requires_tools: [],
  requires_skills: [],
});

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SkillEditorPage() {
  const { name } = useParams();
  const pid = useProjectId();
  const isNew = name === undefined;
  const navigate = useNavigate();

  const [s, setS] = useState<SkillDetail>(blank());
  const [error, setError] = useState<string | null>(null);
  const readOnly = !isNew && !s.editable;

  useEffect(() => {
    if (isNew || !name) return;
    getSkill(pid, name)
      .then((d) => setS({ ...blank(), ...d, capabilities: d.capabilities ?? [] }))
      .catch(() => setError("could not load skill"));
  }, [isNew, name, pid]);

  const label = "mb-1 block text-[10px] uppercase tracking-wide text-muted";
  const input = "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  const set = (patch: Partial<SkillDetail>) => setS((prev) => ({ ...prev, ...patch }));

  async function onSave() {
    setError(null);
    const id = isNew ? s.name.trim() : name!;
    if (isNew && !NAME_RE.test(id)) {
      setError("invalid name — use lowercase letters, digits, or -");
      return;
    }
    try {
      await putSkill(pid, { ...s, name: id }, { create: isNew });
      navigate(`/projects/${pid}/tools/skills/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  async function onDelete() {
    if (isNew || !name) return;
    try {
      await deleteSkill(pid, name);
      navigate(`/projects/${pid}/tools`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  }

  function onExport() {
    download(
      "SKILL.md",
      `---\nname: ${s.name}\ndescription: ${s.description ?? ""}\n---\n${s.content}\n`,
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-4">
      <button onClick={() => navigate(`/projects/${pid}/tools`)} className="text-xs text-accent">
        ← all skills
      </button>
      <h2 className="text-base font-semibold">{isNew ? "New skill" : name}</h2>

      <div className="space-y-2.5 rounded-lg border border-border bg-surface p-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className={label}>skill name</label>
            <input
              aria-label="skill name"
              className={input}
              disabled={!isNew}
              value={s.name}
              onChange={(e) => set({ name: e.target.value })}
            />
          </div>
          <div className="w-32">
            <label className={label}>version</label>
            <input
              aria-label="version"
              className={input}
              disabled={readOnly}
              placeholder="0.1.0"
              value={s.version ?? ""}
              onChange={(e) => set({ version: e.target.value || null })}
            />
          </div>
        </div>
        <div>
          <label className={label}>description</label>
          <input
            aria-label="description"
            className={input}
            disabled={readOnly}
            value={s.description ?? ""}
            onChange={(e) => set({ description: e.target.value || null })}
          />
        </div>
        <div>
          <label className={label}>SKILL.md body</label>
          <textarea
            aria-label="SKILL.md body"
            className="h-40 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs"
            disabled={readOnly}
            value={s.content}
            onChange={(e) => set({ content: e.target.value })}
          />
        </div>
        {!readOnly && (
          <>
            <div>
              <label className={label}>capabilities</label>
              <CapabilitiesEditor
                capabilities={s.capabilities}
                onChange={(c) => set({ capabilities: c })}
              />
            </div>
            <div>
              <label className={label}>requires.tools</label>
              <PackageDepEditor
                label="tool"
                deps={s.requires_tools}
                onChange={(d) => set({ requires_tools: d })}
              />
            </div>
            <div>
              <label className={label}>requires.skills</label>
              <PackageDepEditor
                label="skill"
                deps={s.requires_skills}
                onChange={(d) => set({ requires_skills: d })}
              />
            </div>
          </>
        )}
      </div>

      {error && <div className="text-xs text-st-error">{error}</div>}

      <div className="flex gap-2">
        {!readOnly && (
          <button
            onClick={onSave}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
          >
            Save
          </button>
        )}
        {!isNew && !readOnly && (
          <button
            onClick={onDelete}
            className="rounded-md border border-st-error/40 px-3 py-1.5 text-xs font-semibold text-st-error"
          >
            Delete
          </button>
        )}
        <button
          onClick={onExport}
          className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
        >
          Export
        </button>
      </div>
    </div>
  );
}
