import type { SkillSummary } from "../types/SkillSummary";
import type { SkillDetail } from "../types/SkillDetail";
import { request, requestVoid, scopedPath } from "./client";

export const listSkills = (pid: string) => request<SkillSummary[]>(scopedPath(pid, "/skills"));

export const getSkill = (pid: string, name: string) =>
  request<SkillDetail>(scopedPath(pid, `/skills/${encodeURIComponent(name)}`));

export const putSkill = (pid: string, skill: SkillDetail, opts?: { create?: boolean }) =>
  request<SkillDetail>(
    scopedPath(pid, `/skills/${encodeURIComponent(skill.name)}${opts?.create ? "?create=1" : ""}`),
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(skill),
    },
  );

export const deleteSkill = (pid: string, name: string) =>
  requestVoid(scopedPath(pid, `/skills/${encodeURIComponent(name)}`), { method: "DELETE" });

export const importSkill = (pid: string, git_url: string) =>
  request<{ skill: string }>(scopedPath(pid, "/skills/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  }).then((r) => r.skill);
