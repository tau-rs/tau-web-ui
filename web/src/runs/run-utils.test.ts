import { describe, it, expect } from "vitest";
import { relativeTime, formatTokenSplit } from "./run-utils";
import type { Run } from "../types/Run";

const NOW = "2026-05-31T12:00:00.000Z";

describe("relativeTime", () => {
  it("formats buckets", () => {
    expect(relativeTime("2026-05-31T11:59:58.000Z", NOW)).toBe("just now");
    expect(relativeTime("2026-05-31T11:59:30.000Z", NOW)).toBe("30s ago");
    expect(relativeTime("2026-05-31T11:45:00.000Z", NOW)).toBe("15m ago");
    expect(relativeTime("2026-05-31T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(relativeTime("2026-05-29T12:00:00.000Z", NOW)).toBe("2d ago");
  });
});

describe("formatTokenSplit", () => {
  it("shows in/out or dash", () => {
    const base = {
      token_usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
    } as unknown as Run;
    expect(formatTokenSplit(base)).toBe("12 in · 8 out");
    expect(formatTokenSplit({ token_usage: null } as unknown as Run)).toBe("—");
  });
});
