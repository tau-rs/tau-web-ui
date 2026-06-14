import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentCapabilities } from "../types/AgentCapabilities";
import { CapabilitiesCard } from "./CapabilitiesCard";

const mockGet = vi.fn();
vi.mock("../api/caps", () => ({ getCapabilities: (pid: string) => mockGet(pid) }));
vi.mock("../app/project-context", () => ({ useProjectId: () => "p1" }));
const surfaceError = vi.fn();
vi.mock("../notify/notify", () => ({ surfaceError: (...a: unknown[]) => surfaceError(...a) }));

beforeEach(() => {
  mockGet.mockReset();
  surfaceError.mockReset();
});

const rows: AgentCapabilities[] = [
  {
    agent_id: "researcher",
    display_name: "Researcher",
    llm_backend: "anthropic",
    effective: [
      {
        kind: "fs.read",
        allow_paths: ["./src/**"],
        deny_paths: [],
        deny_hosts: [],
        deny_commands: [],
      },
      {
        kind: "fs.write",
        allow_paths: ["out/**"],
        deny_paths: [],
        deny_hosts: [],
        deny_commands: [],
        max_bytes: 1048576n,
      },
    ],
  },
  {
    agent_id: "spawner",
    display_name: "Spawner",
    llm_backend: "anthropic",
    effective: [{ kind: "agent.spawn", deny_paths: [], deny_hosts: [], deny_commands: [] }],
  },
  { agent_id: "greeter", display_name: "Greeter", llm_backend: "anthropic", effective: [] },
  { agent_id: "orphan", display_name: "Orphan", llm_backend: "anthropic", effective: null },
];

describe("CapabilitiesCard", () => {
  it("renders allow chips, the byte limit, and the two empty states", async () => {
    mockGet.mockResolvedValue(rows);
    render(<CapabilitiesCard />);
    expect(await screen.findByText("./src/**")).toBeInTheDocument();
    expect(screen.getByText("fs.write")).toBeInTheDocument();
    expect(screen.getByText(/≤\s*1 MB/)).toBeInTheDocument();
    expect(screen.getByText(/fully sandboxed/i)).toBeInTheDocument();
    expect(screen.getByText(/package not installed/i)).toBeInTheDocument();
  });

  it("renders a granted indicator for an unscoped capability kind", async () => {
    mockGet.mockResolvedValue(rows);
    render(<CapabilitiesCard />);
    // The kind label and an explicit "granted" tag, not a bare label.
    expect(await screen.findByText("agent.spawn")).toBeInTheDocument();
    expect(screen.getByText(/^granted$/i)).toBeInTheDocument();
  });

  it("surfaces an inline error and a toast on fetch failure", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    render(<CapabilitiesCard />);
    await waitFor(() =>
      expect(screen.getByText(/could not load capabilities/i)).toBeInTheDocument(),
    );
    expect(surfaceError).toHaveBeenCalled();
  });
});
