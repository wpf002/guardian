/**
 * The 18 USC 2258A preservation duty.
 *
 * 2258A(h): a provider must preserve the contents of a report, and any visual
 * depictions, data or other digital files reasonably accessible and included in
 * it, for 90 days after the report is submitted. The REPORT Act (Public Law
 * 118-59, May 2024) extended that to one year. Guardian's retention classes are
 * built on the one year figure, and the DESIGN.md tier table says the same:
 * T3 keeps everything for one year per 2258A.
 *
 * The clock starts at submission, which for this API is the /finish call, not
 * the /submit that opens the report. A report opened and never finished was
 * never submitted, and NCMEC deletes it on its own after 24 hours.
 *
 * The one thing this module exists to guarantee: the retention sweep cannot
 * delete something under preservation. Guardian's other retention rules delete
 * on a schedule (T0 raw text within 24 hours, T1 at 30 days), and a preserved
 * report outranks all of them. The sweep asks this module and this module says
 * no; there is no path where a preserved row falls out of a sweep because a
 * caller forgot the special case.
 */

/** One year, as the statute counts it. Leap years are handled by date math. */
export const PRESERVATION_YEARS = 1;

/**
 * When preservation ends for a report submitted at `submittedAt`.
 *
 * Calendar arithmetic, not 365 days: a report finished on 2027-02-29 in a leap
 * year has no anniversary, and setUTCFullYear rolls it to 2028-03-01, which is
 * the later date and therefore the safe one.
 */
export function preserveUntil(submittedAt: Date): Date {
  const end = new Date(submittedAt.getTime());
  end.setUTCFullYear(end.getUTCFullYear() + PRESERVATION_YEARS);
  return end;
}

/** What the sweep knows about one row. Deliberately small. */
export interface PreservableRow {
  /** Null where no report has been submitted for this row. */
  preserveUntil?: Date | null;
  /** True once /finish returned successfully. */
  reportSubmitted?: boolean;
  /** When /finish returned, where the row carries it instead of the end date. */
  submittedAt?: Date | null;
}

export interface PreservationVerdict {
  /** True when the sweep must leave this row alone. */
  preserved: boolean;
  /** When preservation lifts, or null where nothing preserves this row. */
  until: Date | null;
  /** Why, in one sentence, for the sweep's log. */
  reason: string;
}

/**
 * Ask before deleting. Called by the retention sweep for every candidate row.
 *
 * Fails closed in one specific way: a row that says a report was submitted but
 * carries no date is preserved rather than deleted, because the alternative is
 * destroying material under a federal preservation duty on the strength of a
 * missing field.
 */
export function preservationVerdict(row: PreservableRow, now: Date = new Date()): PreservationVerdict {
  const explicit = row.preserveUntil ?? null;
  const derived = row.submittedAt ? preserveUntil(row.submittedAt) : null;
  const until = explicit ?? derived;

  if (row.reportSubmitted === true && until === null) {
    return {
      preserved: true,
      until: null,
      reason:
        "A report was submitted for this row and no preservation end date is recorded. Preserved until the date is established, because 18 USC 2258A requires one year from submission and a missing field is not permission to delete.",
    };
  }

  if (until === null) {
    return {
      preserved: false,
      until: null,
      reason: "No report has been submitted for this row, so no preservation duty attaches to it.",
    };
  }

  if (now.getTime() < until.getTime()) {
    return {
      preserved: true,
      until,
      reason: `Under the 18 USC 2258A one year preservation duty until ${until.toISOString()}.`,
    };
  }

  return {
    preserved: false,
    until,
    reason: `The one year preservation period ended at ${until.toISOString()}, so the ordinary retention class applies again.`,
  };
}

/**
 * The predicate the sweep calls. Named for what it stops rather than what it
 * permits, so a reader of the sweep sees the refusal.
 */
export function refuseDeletionUnderPreservation(
  row: PreservableRow,
  now: Date = new Date(),
): boolean {
  return preservationVerdict(row, now).preserved;
}

/**
 * Filter a batch of deletion candidates down to the ones the sweep may act on,
 * and say what it skipped. The sweep logs the skipped set; a preserved row that
 * silently disappears from a batch is the failure this return shape prevents.
 */
export function partitionForSweep<T extends PreservableRow>(
  rows: readonly T[],
  now: Date = new Date(),
): { deletable: T[]; preserved: Array<{ row: T; verdict: PreservationVerdict }> } {
  const deletable: T[] = [];
  const preserved: Array<{ row: T; verdict: PreservationVerdict }> = [];
  for (const row of rows) {
    const verdict = preservationVerdict(row, now);
    if (verdict.preserved) preserved.push({ row, verdict });
    else deletable.push(row);
  }
  return { deletable, preserved };
}
