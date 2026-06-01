import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequiresToolsEditor } from "./RequiresToolsEditor";
import type { RequiredToolSpec } from "../types/RequiredToolSpec";

function Harness({ initial = [] }: { initial?: RequiredToolSpec[] }) {
  const [tools, setTools] = useState<RequiredToolSpec[]>(initial);
  return <RequiresToolsEditor tools={tools} onChange={setTools} />;
}

describe("RequiresToolsEditor", () => {
  it("adds and edits a tool row", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /add tool/i }));
    const name = screen.getByLabelText("tool name 0");
    await user.type(name, "fs-read");
    expect(name).toHaveValue("fs-read");
    await user.type(screen.getByLabelText("tool source 0"), "https://x/fs.git");
    expect(screen.getByLabelText("tool source 0")).toHaveValue("https://x/fs.git");
  });

  it("removes a tool row", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ name: "a", source: "s", version: null }]} />);
    expect(screen.getByLabelText("tool name 0")).toHaveValue("a");
    await user.click(screen.getByRole("button", { name: /remove tool 0/i }));
    expect(screen.queryByLabelText("tool name 0")).not.toBeInTheDocument();
  });
});
