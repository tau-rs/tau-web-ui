import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStore } from "./store";

beforeEach(() => vi.restoreAllMocks());

describe("trace load merges mock check spans", () => {
  it("appends check spans for a retry run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          run: { id: "run-retry", agent_id: "research", source: "log", status: "completed" },
          spans: [],
          events: [],
        }),
      }),
    );
    await useStore.getState().openTrace("demo", "run-retry");
    const spans = useStore.getState().currentTrace!.spans;
    expect(
      spans.some((s) => (s.attributes as { check_kind?: string }).check_kind === "deliverable"),
    ).toBe(true);
  });
});
