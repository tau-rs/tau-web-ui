import { describe, it, expect, vi, beforeEach } from "vitest";
import { listAgents, getAgent, putAgent, deleteAgent } from "./agents";

beforeEach(() => {
  vi.restoreAllMocks();
});

const agent = {
  id: "writer",
  display_name: "Writer",
  package: null,
  llm_backend: "anthropic",
  prompt: { system: "hi", system_file: null },
  requires_tools: [],
};

describe("agents api", () => {
  it("listAgents GETs the scoped agents path", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listAgents("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents");
  });

  it("getAgent GETs one", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => agent });
    vi.stubGlobal("fetch", f);
    await getAgent("demo", "writer");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/writer");
  });

  it("putAgent PUTs to the agent id; create adds ?create=1", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => agent });
    vi.stubGlobal("fetch", f);
    await putAgent("demo", agent, { create: true });
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/writer?create=1");
    expect(f.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(f.mock.calls[0][1].body).id).toBe("writer");
  });

  it("putAgent without create has no query", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => agent });
    vi.stubGlobal("fetch", f);
    await putAgent("demo", agent);
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/writer");
  });

  it("percent-encodes the agent id so a slashed id stays in one path segment", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => agent });
    vi.stubGlobal("fetch", f);
    await getAgent("demo", "../etc/passwd");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/..%2Fetc%2Fpasswd");
  });

  it("percent-encodes the agent id in putAgent, before the ?create query", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => agent });
    vi.stubGlobal("fetch", f);
    await putAgent("demo", { ...agent, id: "a/b" }, { create: true });
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/a%2Fb?create=1");
  });

  it("percent-encodes the agent id in deleteAgent", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    vi.stubGlobal("fetch", f);
    await deleteAgent("demo", "a#b");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/a%23b");
  });

  it("deleteAgent DELETEs", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    vi.stubGlobal("fetch", f);
    await deleteAgent("demo", "writer");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/agents/writer");
    expect(f.mock.calls[0][1].method).toBe("DELETE");
  });
});
