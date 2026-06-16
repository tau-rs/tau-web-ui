import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChecksGlanceCard } from "./ChecksGlanceCard";

describe("ChecksGlanceCard", () => {
  it("summarizes the last run's checks (met counts + retries)", async () => {
    render(<ChecksGlanceCard pid="demo" runId="run-retry" />);
    await waitFor(() => expect(screen.getByText(/1 deliverable met/i)).toBeInTheDocument());
    expect(screen.getByText(/1 goal met/i)).toBeInTheDocument();
    expect(screen.getByText(/1 retry/i)).toBeInTheDocument();
  });
});
