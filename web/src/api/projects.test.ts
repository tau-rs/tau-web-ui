import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listProjects,
  getCrossRuns,
  addProjectByPath,
  addProjectByGit,
  removeProject,
} from "./projects";

beforeEach(() => vi.restoreAllMocks());

describe("projects api", () => {
  it("listProjects GETs /api/projects", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listProjects();
    expect(f.mock.calls[0][0]).toBe("/api/projects");
  });

  it("getCrossRuns passes status + limit", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await getCrossRuns("failed", 20);
    expect(f.mock.calls[0][0]).toBe("/api/projects/runs?status=failed&limit=20");
  });

  it("addProjectByPath posts { path }", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "demo" }) });
    vi.stubGlobal("fetch", f);
    await addProjectByPath("/abs/demo");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ path: "/abs/demo" });
  });

  it("addProjectByGit posts { git_url }", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "bot" }) });
    vi.stubGlobal("fetch", f);
    await addProjectByGit("https://x/bot.git");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ git_url: "https://x/bot.git" });
  });

  it("removeProject DELETEs the project", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    vi.stubGlobal("fetch", f);
    await removeProject("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo");
    expect(f.mock.calls[0][1].method).toBe("DELETE");
  });
});
