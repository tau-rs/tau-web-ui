import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SkillSummary } from "../types/SkillSummary";
import { listSkills, importSkill } from "../api/skills";

export function SkillsIndex() {
  const { pid } = useParams();
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [url, setUrl] = useState("");

  const reload = () =>
    listSkills()
      .then(setSkills)
      .catch(() => {});
  useEffect(() => {
    reload();
  }, []);

  async function onImport() {
    if (!url.trim()) return;
    await importSkill(url.trim()).catch(() => {});
    setUrl("");
    reload();
  }

  const input = "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-accent/40 bg-accent/5 p-2">
        <input
          aria-label="import skill git url"
          placeholder="https://github.com/org/skill.git"
          className={`flex-1 ${input}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          onClick={onImport}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold"
        >
          Import skill
        </button>
        <Link
          to={`/projects/${pid}/tools/skills/new`}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg"
        >
          + New skill
        </Link>
      </div>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="py-1 pr-2 font-medium">skill</th>
            <th className="px-2 py-1 font-medium">version</th>
            <th className="px-2 py-1 font-medium">source</th>
            <th className="px-2 py-1 font-medium">capabilities</th>
            <th className="px-2 py-1 font-medium">requires</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr key={s.name} className="border-b border-border/60 last:border-0">
              <td className="py-1 pr-2 font-medium">
                <Link to={`/projects/${pid}/tools/skills/${s.name}`} className="text-accent">
                  {s.name}
                </Link>{" "}
                <span
                  className={`rounded px-1 text-[8px] font-bold uppercase ${
                    s.editable ? "bg-accent/10 text-accent" : "bg-bg text-muted"
                  }`}
                >
                  {s.editable ? "local" : "installed"}
                </span>
              </td>
              <td className="px-2 py-1 text-muted">{s.version ?? "—"}</td>
              <td className="px-2 py-1 font-mono text-muted">{s.source}</td>
              <td className="px-2 py-1 font-mono text-muted">
                {s.capability_kinds.join(", ") || "—"}
              </td>
              <td className="px-2 py-1 text-muted">{s.requires_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
