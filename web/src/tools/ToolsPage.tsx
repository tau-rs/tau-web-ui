import { SkillsIndex } from "./SkillsIndex";

export function ToolsPage() {
  const tab = (active: boolean, soon = false) =>
    `rounded-md px-3 py-1 text-xs font-semibold ${
      active ? "bg-accent text-accent-fg" : "text-muted"
    } ${soon ? "cursor-not-allowed opacity-50" : ""}`;
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Tools &amp; Skills</h2>
        <div className="ml-2 flex gap-1">
          <span className={tab(true)}>Skills</span>
          <span className={tab(false, true)}>
            Tools <span className="ml-1 rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">soon</span>
          </span>
          <span className={tab(false, true)}>
            Plugins <span className="ml-1 rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">soon</span>
          </span>
        </div>
      </div>
      <SkillsIndex />
    </div>
  );
}
