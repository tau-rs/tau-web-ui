import type { SkillSummary } from "../types/SkillSummary";
import type { SkillDetail } from "../types/SkillDetail";
import { scopedPath } from "./client";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const listSkills = () => fetch(scopedPath("/skills")).then(json<SkillSummary[]>);

export const getSkill = (name: string) =>
  fetch(scopedPath(`/skills/${name}`)).then(json<SkillDetail>);

export const putSkill = (skill: SkillDetail, opts?: { create?: boolean }) =>
  fetch(scopedPath(`/skills/${skill.name}${opts?.create ? "?create=1" : ""}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(skill),
  }).then(json<SkillDetail>);

export const deleteSkill = (name: string) =>
  fetch(scopedPath(`/skills/${name}`), { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`);
  });

export const importSkill = (git_url: string) =>
  fetch(scopedPath("/skills/import"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ git_url }),
  })
    .then(json<{ skill: string }>)
    .then((r) => r.skill);
