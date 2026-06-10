import { describe, it, expect, vi, beforeEach } from "vitest";
import { surfaceError, notify, useNotifications } from "./notify";

beforeEach(() => {
  useNotifications.setState({ items: [] });
  vi.restoreAllMocks();
});

describe("surfaceError", () => {
  it("logs the error and pushes an error notification", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    surfaceError("Failed to save config", new Error("500: boom"));
    expect(spy).toHaveBeenCalled();
    const { items } = useNotifications.getState();
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("error");
    expect(items[0].message).toContain("Failed to save config");
    expect(items[0].message).toContain("500: boom");
  });

  it("notify() adds an item dismissable by id", () => {
    notify("info", "hi");
    const { items, dismiss } = useNotifications.getState();
    expect(items).toHaveLength(1);
    dismiss(items[0].id);
    expect(useNotifications.getState().items).toHaveLength(0);
  });
});
