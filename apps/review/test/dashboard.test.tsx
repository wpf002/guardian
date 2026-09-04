import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { isAccusatory } from "@guardian/schema";
import { DashboardView } from "@/app/dashboard/page";
import { getDashboardMetrics } from "@/app/dashboard/metrics";
import { describeVerification } from "@/app/dashboard/verification";
import { mockSession } from "@/lib/auth";
import { resetMockData } from "@/lib/mock/fixtures";
import type { DashboardMetrics } from "@/app/dashboard/metrics";

/**
 * The dashboard renders from the fixtures, with no database and no request.
 * Everything here goes through the real metrics read, so a change that breaks
 * the aggregation fails the render test rather than passing a hand-written
 * object.
 */

async function metrics(): Promise<DashboardMetrics> {
  return getDashboardMetrics(mockSession(), { now: new Date() });
}

const verifyOk = async () =>
  describeVerification({ state: "ok" as const, checked: 40, head: "a".repeat(64), at: new Date() });

describe("operator dashboard", () => {
  beforeEach(() => {
    resetMockData();
  });

  it("renders queue health, cost, calibration, retention and the chain in mock mode", async () => {
    render(<DashboardView metrics={await metrics()} verify={verifyOk} />);

    expect(screen.getByRole("heading", { level: 1, name: "Health" })).toBeTruthy();
    expect(screen.getByText("Open at T2")).toBeTruthy();
    expect(screen.getByText("Oldest open T2, time in queue")).toBeTruthy();
    expect(screen.getByText("Reviewer minutes per 1,000 users per day")).toBeTruthy();
    expect(screen.getByText("T2 target predictive value")).toBeTruthy();
    expect(screen.getByText("40% or better")).toBeTruthy();
    expect(screen.getByText("Next sweep expected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify now" })).toBeTruthy();
    expect(screen.getByText("Model")).toBeTruthy();
  });

  it("shows the four hour target as a queue target and never ranks a reviewer", async () => {
    render(<DashboardView metrics={await metrics()} verify={verifyOk} />);

    expect(screen.getAllByText(/target 4 hours/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/leaderboard/i)).toBeNull();
    expect(screen.queryByText(/fastest/i)).toBeNull();
    expect(screen.queryByText(/per reviewer/i)).toBeNull();
  });

  it("keeps every chart's numbers in the document as a table for a screen reader", async () => {
    render(<DashboardView metrics={await metrics()} verify={verifyOk} />);

    // The tables are always mounted, visually hidden until asked for, so the
    // SVG can stay decorative without hiding the numbers from anybody.
    expect(screen.getByText("Pairs by tier, over 7 and 30 days")).toBeTruthy();
    expect(screen.getByText("Recorded decisions by kind, over 30 days")).toBeTruthy();
    expect(screen.getByText("Pairs by retention class")).toBeTruthy();
  });

  it("toggles a chart's data table open and closed from the keyboard-reachable control", async () => {
    render(<DashboardView metrics={await metrics()} verify={verifyOk} />);

    const toggle = screen.getAllByRole("button", { name: "Show the table" })[0]!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const controlled = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(controlled.className).toBe("sr-only");

    fireEvent.click(toggle);

    const opened = screen.getAllByRole("button", { name: "Hide the table" })[0]!;
    expect(opened.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(opened.getAttribute("aria-controls")!)!.className).not.toBe(
      "sr-only",
    );
  });

  it("reports a verification result from the chain when the control is used", async () => {
    render(<DashboardView metrics={await metrics()} verify={verifyOk} />);

    fireEvent.click(screen.getByRole("button", { name: "Verify now" }));

    await waitFor(() => {
      expect(screen.getByText(/Chain verified\. 40 entries checked\./)).toBeTruthy();
    });
  });

  it("says what a broken chain is and which entry broke, rather than a bare failure", async () => {
    const verifyBroken = async () =>
      describeVerification({
        state: "broken" as const,
        checked: 11,
        brokenAt: 12,
        reason: "hash_mismatch",
        at: new Date(),
      });

    render(<DashboardView metrics={await metrics()} verify={verifyBroken} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify now" }));

    await waitFor(() => {
      expect(screen.getByText(/Chain verification failed at entry 12\./)).toBeTruthy();
    });
    expect(screen.getByText(/hash mismatch/)).toBeTruthy();
  });

  /**
   * The chain spans every customer, so the verifier's own detail string, which
   * names the entry's kind and the customer that wrote it, must not reach an
   * operator's screen. It goes to the server log.
   */
  it("does not print another customer's identifiers when the chain breaks", async () => {
    const verifyBroken = async () =>
      describeVerification({
        state: "broken" as const,
        checked: 11,
        brokenAt: 12,
        reason: "hash_mismatch",
        at: new Date(),
      });

    render(<DashboardView metrics={await metrics()} verify={verifyBroken} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify now" }));

    await waitFor(() => {
      expect(screen.getByText(/Chain verification failed at entry 12\./)).toBeTruthy();
    });
    expect(document.body.textContent).not.toMatch(/customer cus_/);
  });

  it("keeps the view up when the verification itself fails", async () => {
    const verifyThrows = async () => {
      throw new Error("chain unreachable");
    };

    render(<DashboardView metrics={await metrics()} verify={verifyThrows} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify now" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Nothing was changed");
    });
    expect(screen.getByRole("heading", { level: 1, name: "Health" })).toBeTruthy();
  });

  it("renders the empty state rather than a grid of zeroes", async () => {
    const base = await metrics();
    const empty: DashboardMetrics = {
      ...base,
      isEmpty: true,
    };
    render(<DashboardView metrics={empty} verify={verifyOk} />);

    expect(screen.getByText("Nothing has been scored on this partition yet.")).toBeTruthy();
    expect(screen.queryByText("Open at T2")).toBeNull();
  });

  it("prints no string that the wording guard would refuse", async () => {
    const { container } = render(<DashboardView metrics={await metrics()} verify={verifyOk} />);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(isAccusatory(text)).toBe(false);
  });
});

describe("dashboard metrics", () => {
  beforeEach(() => {
    resetMockData();
  });

  it("counts pairs and minutes, and carries the target figures from the design", async () => {
    const read = await metrics();
    expect(read.queue.openT2 + read.queue.openT1).toBeGreaterThan(0);
    expect(read.tierRates.some((row) => row.windowDays === 7)).toBe(true);
    expect(read.tierRates.some((row) => row.windowDays === 30)).toBe(true);
    expect(read.audit.headSeq).toBeGreaterThan(0);
    expect(read.audit.verification.state).toBe("ok");
    expect(read.isEmpty).toBe(false);
  });

  it("withholds a rate below the stated sample size rather than printing a number", async () => {
    const read = await metrics();
    if (read.cost.ppvSampleSize < read.cost.minSampleForRate) {
      expect(read.cost.realizedT2Ppv).toBeNull();
    } else {
      expect(read.cost.realizedT2Ppv).not.toBeNull();
    }
  });

  it("labels every critical signal kind in words", async () => {
    const read = await metrics();
    for (const row of read.criticalSignals) {
      expect(row.label).not.toContain("_");
      expect(isAccusatory(row.label)).toBe(false);
    }
  });
});
