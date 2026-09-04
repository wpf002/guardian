import { describe, expect, it } from "vitest";
import {
  PRESERVATION_YEARS,
  partitionForSweep,
  preservationVerdict,
  preserveUntil,
  refuseDeletionUnderPreservation,
} from "../src/preservation.js";

describe("preserveUntil", () => {
  it("is one year from submission, as 18 USC 2258A requires after the REPORT Act", () => {
    expect(PRESERVATION_YEARS).toBe(1);
    expect(preserveUntil(new Date("2026-09-04T12:00:00.000Z")).toISOString()).toBe(
      "2027-09-04T12:00:00.000Z",
    );
  });

  it("keeps the time of day, so the clock is exact rather than to the day", () => {
    expect(preserveUntil(new Date("2026-01-01T23:59:59.000Z")).toISOString()).toBe(
      "2027-01-01T23:59:59.000Z",
    );
  });

  it("rolls a leap day forward rather than backward", () => {
    // 2028-02-29 has no 2029 anniversary. Rolling to March 1 is the later date
    // and therefore the safe one under a preservation duty.
    expect(preserveUntil(new Date("2028-02-29T00:00:00.000Z")).toISOString()).toBe(
      "2029-03-01T00:00:00.000Z",
    );
  });

  it("crosses a leap year correctly", () => {
    expect(preserveUntil(new Date("2027-03-01T00:00:00.000Z")).toISOString()).toBe(
      "2028-03-01T00:00:00.000Z",
    );
  });
});

describe("the retention sweep must refuse to delete anything under preservation", () => {
  const submittedAt = new Date("2026-09-04T12:00:00.000Z");
  const until = preserveUntil(submittedAt);

  it("preserves a row for the whole year", () => {
    const row = { submittedAt, reportSubmitted: true };
    expect(refuseDeletionUnderPreservation(row, new Date("2026-09-05T00:00:00.000Z"))).toBe(true);
    expect(refuseDeletionUnderPreservation(row, new Date("2027-09-03T00:00:00.000Z"))).toBe(true);
    // The boundary itself is still preserved.
    expect(refuseDeletionUnderPreservation(row, new Date(until.getTime() - 1))).toBe(true);
  });

  it("releases the row once the year is up", () => {
    const row = { submittedAt, reportSubmitted: true };
    expect(refuseDeletionUnderPreservation(row, until)).toBe(false);
    expect(refuseDeletionUnderPreservation(row, new Date("2027-09-05T00:00:00.000Z"))).toBe(false);
  });

  it("prefers an explicit preserveUntil over one derived from the submission date", () => {
    const verdict = preservationVerdict(
      { submittedAt, preserveUntil: new Date("2030-01-01T00:00:00.000Z"), reportSubmitted: true },
      new Date("2028-01-01T00:00:00.000Z"),
    );
    expect(verdict.preserved).toBe(true);
    expect(verdict.until!.toISOString()).toBe("2030-01-01T00:00:00.000Z");
  });

  it("does not preserve a row with no report behind it", () => {
    const verdict = preservationVerdict({}, new Date("2026-09-05T00:00:00.000Z"));
    expect(verdict.preserved).toBe(false);
    expect(verdict.until).toBeNull();
    expect(verdict.reason).toMatch(/No report has been submitted/);
  });

  it("fails closed when a report was submitted and the date is missing", () => {
    const verdict = preservationVerdict({ reportSubmitted: true }, new Date("2030-01-01T00:00:00.000Z"));
    expect(verdict.preserved).toBe(true);
    expect(verdict.reason).toMatch(/not permission to delete/);
  });

  it("partitions a sweep batch and says what it skipped", () => {
    const now = new Date("2026-10-01T00:00:00.000Z");
    const rows = [
      { id: "a", submittedAt, reportSubmitted: true },
      { id: "b" },
      { id: "c", reportSubmitted: true },
      { id: "d", submittedAt: new Date("2024-01-01T00:00:00.000Z"), reportSubmitted: true },
    ];
    const { deletable, preserved } = partitionForSweep(rows, now);
    expect(deletable.map((r) => r.id)).toEqual(["b", "d"]);
    expect(preserved.map((p) => p.row.id)).toEqual(["a", "c"]);
    expect(preserved.every((p) => p.verdict.reason.length > 0)).toBe(true);
  });
});
