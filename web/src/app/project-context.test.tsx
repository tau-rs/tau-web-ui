import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { ProjectProvider, useProjectId } from "./project-context";
import { getProject } from "../api/client";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => vi.restoreAllMocks());

/** Issues a scoped request for whatever project the surrounding context names. */
function Probe() {
  const pid = useProjectId();
  useEffect(() => {
    getProject(pid).catch(() => {});
  }, [pid]);
  return null;
}

describe("active project (ProjectContext + explicit-arg client)", () => {
  it("targets the new project after a project switch, not the previous one", async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    const { rerender } = render(
      <ProjectProvider pid="alpha">
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/projects/alpha/project"));

    // Switch the active project (what navigating from /projects/alpha to
    // /projects/beta does). The next request must hit beta — with the old
    // render-time-mutated global this could read a stale project.
    rerender(
      <ProjectProvider pid="beta">
        <Probe />
      </ProjectProvider>,
    );
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/projects/beta/project"));

    const urls = f.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/api/projects/alpha/project");
    expect(urls).toContain("/api/projects/beta/project");
  });

  it("throws if useProjectId is used outside a ProjectProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within a ProjectProvider/);
    spy.mockRestore();
  });
});
