import { describe, it, expect, vi, beforeEach } from "vitest";
import { listSkills, getSkill, putSkill, deleteSkill, importSkill } from "./skills";

beforeEach(() => {
  vi.restoreAllMocks();
});

const skill = {
  name: "critic",
  description: null,
  version: null,
  source: "local://critic",
  editable: true,
  content: "x",
  capabilities: [],
  requires_tools: [],
  requires_skills: [],
};

describe("skills api", () => {
  it("listSkills GETs the scoped path", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listSkills("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills");
  });

  it("getSkill GETs one", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => skill });
    vi.stubGlobal("fetch", f);
    await getSkill("demo", "critic");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/critic");
  });

  it("putSkill PUTs; create adds ?create=1", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => skill });
    vi.stubGlobal("fetch", f);
    await putSkill("demo", skill, { create: true });
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/critic?create=1");
    expect(f.mock.calls[0][1].method).toBe("PUT");
  });

  it("percent-encodes the skill name so a slashed name stays in one path segment", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => skill });
    vi.stubGlobal("fetch", f);
    await getSkill("demo", "../../etc");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/..%2F..%2Fetc");
  });

  it("percent-encodes the skill name in putSkill, before the ?create query", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => skill });
    vi.stubGlobal("fetch", f);
    await putSkill("demo", { ...skill, name: "a/b" }, { create: true });
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/a%2Fb?create=1");
  });

  it("percent-encodes the skill name in deleteSkill", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    vi.stubGlobal("fetch", f);
    await deleteSkill("demo", "a%2e");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/a%252e");
  });

  it("deleteSkill DELETEs", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    vi.stubGlobal("fetch", f);
    await deleteSkill("demo", "critic");
    expect(f.mock.calls[0][1].method).toBe("DELETE");
  });

  it("importSkill POSTs git_url", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ skill: "x" }) });
    vi.stubGlobal("fetch", f);
    await importSkill("demo", "https://x/y.git");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/skills/import");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ git_url: "https://x/y.git" });
  });
});
