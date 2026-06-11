import { describe, it, expect } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = 1_700_000_000_000;

describe("relativeTime", () => {
  it("reports 'just now' under 5s", () => {
    expect(relativeTime(NOW - 2_000, NOW)).toBe("just now");
  });
  it("reports seconds, minutes, hours, days", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("10s ago");
    expect(relativeTime(NOW - 120_000, NOW)).toBe("2m ago");
    expect(relativeTime(NOW - 7_200_000, NOW)).toBe("2h ago");
    expect(relativeTime(NOW - 172_800_000, NOW)).toBe("2d ago");
  });
  it("never reports a negative future delta", () => {
    expect(relativeTime(NOW + 5_000, NOW)).toBe("just now");
  });
});
