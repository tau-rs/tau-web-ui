import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectListItem } from "../types/ProjectListItem";
import { SaveAsProjectForm } from "./SaveAsProjectForm";

export function UnsavedCard({ item, onSaved }: { item: ProjectListItem; onSaved: () => void }) {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const s = item.summary;
  return (
    <div className="rounded-lg border border-dashed border-amber-400 bg-amber-50/40 p-3">
      <button
        onClick={() => navigate(`/projects/${item.meta.id}/dashboard`)}
        className="w-full text-left"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-amber-100 px-1.5 text-[9px] font-bold uppercase text-amber-800">
            unsaved
          </span>
          <strong className="text-sm">Working environment</strong>
        </div>
        <div className="flex gap-4 text-xs">
          <span>
            <b>{s.runs}</b> runs
          </span>
          <span className={s.failed_24h > 0 ? "text-st-error" : ""}>
            <b>{s.failed_24h}</b> failed
          </span>
          <span>
            <b>{s.agents}</b> agents
          </span>
        </div>
      </button>
      {saving ? (
        <SaveAsProjectForm
          onSaved={(m) => {
            onSaved();
            navigate(`/projects/${m.id}/dashboard`);
          }}
        />
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="mt-2 rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800"
        >
          Save as project
        </button>
      )}
    </div>
  );
}
