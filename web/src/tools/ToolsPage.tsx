import { useState } from "react";
import { SkillsIndex } from "./SkillsIndex";
import { ToolsTab } from "./ToolsTab";
import { PluginsTab } from "./PluginsTab";

export function ToolsPage() {
  const [tab, setTab] = useState<"skills" | "tools" | "plugins">("skills");
  const chip = (active: boolean) =>
    `rounded-md px-3 py-1 text-xs font-semibold ${
      active ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
    }`;
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Tools &amp; Skills</h2>
        <div className="ml-2 flex gap-1">
          <button className={chip(tab === "skills")} onClick={() => setTab("skills")}>
            Skills
          </button>
          <button className={chip(tab === "tools")} onClick={() => setTab("tools")}>
            Tools
          </button>
          <button className={chip(tab === "plugins")} onClick={() => setTab("plugins")}>
            Plugins{" "}
            <span className="ml-1 rounded bg-amber-100 px-1 text-[8px] font-bold uppercase text-amber-800">
              gated
            </span>
          </button>
        </div>
      </div>
      {tab === "skills" ? <SkillsIndex /> : tab === "tools" ? <ToolsTab /> : <PluginsTab />}
    </div>
  );
}
