import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CapabilitiesEditor } from "./CapabilitiesEditor";
import type { Capability } from "../types/Capability";

function Harness() {
  const [caps, setCaps] = useState<Capability[]>([]);
  return <CapabilitiesEditor capabilities={caps} onChange={setCaps} />;
}

describe("CapabilitiesEditor", () => {
  it("adds a capability and edits its kind + a param list", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /add capability/i }));

    const paths = screen.getByLabelText("paths 0");
    await user.type(paths, "/tmp/**");
    expect(paths).toHaveValue("/tmp/**");

    await user.selectOptions(screen.getByLabelText("capability kind 0"), "net.http");
    expect(screen.getByLabelText("hosts 0")).toBeInTheDocument();
    expect(screen.getByLabelText("methods 0")).toBeInTheDocument();
    expect(screen.queryByLabelText("paths 0")).not.toBeInTheDocument();
  });

  it("removes a capability", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /add capability/i }));
    expect(screen.getByLabelText("capability kind 0")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /remove capability 0/i }));
    expect(screen.queryByLabelText("capability kind 0")).not.toBeInTheDocument();
  });
});
