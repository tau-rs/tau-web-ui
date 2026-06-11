import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAsync } from "./useAsync";

afterEach(() => vi.restoreAllMocks());

describe("useAsync", () => {
  it("transitions loading -> data", async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve([1, 2]), []));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("data"));
    const s = result.current;
    if (s.status !== "data") throw new Error("expected data");
    expect(s.data).toEqual([1, 2]);
  });

  it("transitions loading -> empty via isEmpty", async () => {
    const { result } = renderHook(() =>
      useAsync(() => Promise.resolve([] as number[]), [], { isEmpty: (d) => d.length === 0 }),
    );
    await waitFor(() => expect(result.current.status).toBe("empty"));
  });

  it("transitions loading -> error and exposes the reason", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useAsync(() => Promise.reject(new Error("503: down")), []));
    await waitFor(() => expect(result.current.status).toBe("error"));
    const s = result.current;
    if (s.status !== "error") throw new Error("expected error");
    expect(s.error).toBe("503: down");
    expect(spy).toHaveBeenCalled();
  });

  it("a 500 through the real client lands on error, not empty", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" }),
    );
    const { request } = await import("../api/client");
    const { result } = renderHook(() =>
      // isEmpty would classify a [] result as empty — a failed read must NOT take
      // that branch; it must surface as an error.
      useAsync(() => request<number[]>("/api/x"), [], { isEmpty: (d) => d.length === 0 }),
    );
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("error"));
    const s = result.current;
    if (s.status !== "error") throw new Error("expected error");
    expect(s.error).toContain("500");
    expect(spy).toHaveBeenCalled();
  });

  it("reload re-runs the fetcher", async () => {
    let n = 0;
    const { result } = renderHook(() => useAsync(() => Promise.resolve(++n), []));
    await waitFor(() => expect(result.current.status).toBe("data"));
    act(() => result.current.reload());
    await waitFor(() => {
      const s = result.current;
      expect(s.status === "data" && s.data === 2).toBe(true);
    });
  });
});
