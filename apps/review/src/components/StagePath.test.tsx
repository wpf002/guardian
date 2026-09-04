import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StagePath } from "./StagePath";

const path = [
  { stage: "probe" as const, reachedAt: new Date("2026-09-01T14:00:00Z"), elapsedHoursFromPrevious: null },
  { stage: "migrate" as const, reachedAt: new Date("2026-09-02T09:00:00Z"), elapsedHoursFromPrevious: 19 },
];

describe("StagePath", () => {
  it("shows which stages were reached and in what order", () => {
    render(<StagePath path={path} velocityWindow="4h" />);
    expect(screen.getByText("reached 1")).toBeTruthy();
    expect(screen.getByText("reached 2")).toBeTruthy();
    expect(screen.getAllByText("not reached").length).toBe(4);
    expect(screen.getByText("19h after the last")).toBeTruthy();
    expect(screen.getByText("Velocity window: 4h.")).toBeTruthy();
  });

  it("says so when nothing was reached, and prints the profiling limit", () => {
    render(<StagePath path={[]} soleAutomatedBasis />);
    expect(screen.getByText("No stage was reached in this window.")).toBeTruthy();
    expect(screen.getByText(/A report cannot be proposed from it/)).toBeTruthy();
  });
});
