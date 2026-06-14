import { describe, it, expect, vi, beforeEach } from "vitest";
import { listSessions, getSession, exportUrl } from "./sessions";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("sessions api", () => {
  it("listSessions GETs the scoped path", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", f);
    await listSessions("demo");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/sessions");
  });

  it("getSession percent-encodes the id", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", f);
    await getSession("demo", "../../etc");
    expect(f.mock.calls[0][0]).toBe("/api/projects/demo/sessions/..%2F..%2Fetc");
  });

  it("exportUrl builds a scoped download url with format", () => {
    expect(exportUrl("demo", "018f5a2c", "md")).toBe(
      "/api/projects/demo/sessions/018f5a2c/export?format=md",
    );
  });
});
