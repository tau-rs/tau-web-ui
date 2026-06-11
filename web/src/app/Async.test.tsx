import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Async } from "./Async";
import type { AsyncState } from "./useAsync";

function renderAsync<T>(state: AsyncState<T>, reload = () => {}) {
  return render(
    <Async
      state={{ ...state, reload }}
      skeleton={<div data-testid="skel" />}
      empty={<div data-testid="empty" />}
    >
      {(data) => <div data-testid="data">{String(data)}</div>}
    </Async>,
  );
}

describe("Async", () => {
  it("shows the skeleton while loading (distinct from empty)", () => {
    renderAsync<string>({ status: "loading" });
    expect(screen.getByTestId("skel")).toBeInTheDocument();
    expect(screen.queryByTestId("empty")).not.toBeInTheDocument();
  });
  it("shows the empty slot when empty", () => {
    renderAsync<string>({ status: "empty" });
    expect(screen.getByTestId("empty")).toBeInTheDocument();
    expect(screen.queryByTestId("skel")).not.toBeInTheDocument();
  });
  it("renders children with data", () => {
    renderAsync<string>({ status: "data", data: "hi" });
    expect(screen.getByTestId("data")).toHaveTextContent("hi");
  });
  it("shows the reason and a working Retry on error", async () => {
    const reload = vi.fn();
    renderAsync<string>({ status: "error", error: "503: down" }, reload);
    expect(screen.getByRole("alert")).toHaveTextContent("503: down");
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(reload).toHaveBeenCalled();
  });
});
