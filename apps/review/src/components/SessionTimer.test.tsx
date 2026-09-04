import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionTimer } from "./SessionTimer";

const base = new Date("2026-09-01T09:00:00Z");

describe("SessionTimer", () => {
  it("counts minutes rather than running a stopwatch", () => {
    const now = () => base.getTime() + 30 * 60_000;
    render(<SessionTimer startedAt={base} now={now} />);
    expect(screen.getByText("30 of 120 min")).toBeTruthy();
    expect(screen.getByText("90 min left")).toBeTruthy();
  });

  it("prompts the next break at the configured interval", () => {
    const now = () => base.getTime() + 20 * 60_000;
    render(<SessionTimer startedAt={base} now={now} />);
    expect(screen.getByText("Next break in 5 min.")).toBeTruthy();
  });

  it("says what a spent budget does and does not do", () => {
    const now = () => base.getTime() + 130 * 60_000;
    render(<SessionTimer startedAt={base} now={now} />);
    expect(screen.getByText(/does not log you out/)).toBeTruthy();
    expect(screen.getByRole("progressbar").dataset.tone).toBeUndefined();
  });

  it("offers the break control when the shift screen passes one", () => {
    const onTakeBreak = vi.fn();
    render(<SessionTimer startedAt={base} now={() => base.getTime()} onTakeBreak={onTakeBreak} />);
    expect(screen.getByRole("button", { name: /Take a break now/ })).toBeTruthy();
  });
});
