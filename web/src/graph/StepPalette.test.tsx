import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepPalette } from "./StepPalette";

describe("StepPalette", () => {
  it("lists kinds + agents and picks one", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<StepPalette agents={["researcher", "greeter"]} onPick={onPick} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "agent.run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "tool.call" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "researcher" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "greeter" }));
    expect(onPick).toHaveBeenCalledWith({ kind: "agent.run", agent: "greeter" });
  });

  it("filters by the search term", async () => {
    const user = userEvent.setup();
    render(<StepPalette agents={["researcher", "greeter"]} onPick={() => {}} onClose={() => {}} />);
    await user.type(screen.getByLabelText("search steps"), "greet");
    expect(screen.getByRole("button", { name: "greeter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "researcher" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "agent.run" })).not.toBeInTheDocument();
  });
});
