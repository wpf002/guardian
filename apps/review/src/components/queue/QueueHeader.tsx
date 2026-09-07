import type { QueueSummary } from "@/lib/data/types";
import { shortTime } from "./words";
import styles from "./QueueHeader.module.css";

export interface QueueHeaderProps {
  summary: QueueSummary;
  /** Printed, because a reviewer who cannot see why A is above B loses trust. */
  rankingSentence: string;
  /** A short statement about the last action, when there is one. */
  notice?: string | null;
}

/**
 * Above the fold: where you are, how many are waiting, how much shift is left.
 * No charts, no trend, no welcome, and no paragraph explaining the ranking. The
 * ranking sentence moved into a disclosure a reviewer opens once and never
 * again, because it was three lines of justification sitting on top of the work.
 *
 * There is no session budget here. One was added from reviewer-wellbeing
 * research, nobody asked for it, and it became the largest element on a page
 * whose job is to show cases. Bounded exposure is a real finding and it belongs
 * where a shift is actually managed, not above the queue.
 */
export function QueueHeader({
  summary,
  rankingSentence,
  notice,
}: QueueHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.main}>
        <h1 className={styles.title}>Queue</h1>
        <p className={`${styles.counts} tabular`} role="status">
          <span>{summary.partitionName}</span>
          <span>
            <strong>{summary.total}</strong> waiting
          </span>
          {summary.breachRiskCount > 0 ? (
            <span>
              <strong>{summary.breachRiskCount}</strong> running out of time
            </span>
          ) : null}
        </p>
        <details className={styles.how}>
          <summary className={styles.summary}>Why this order</summary>
          <p className={styles.howBody}>{rankingSentence}</p>
        </details>
        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </header>
  );
}

/** The last arrival, so a reviewer can tell an empty queue from a broken one. */
export function lastArrivalWords(at: Date | null): string {
  return at === null ? "Nothing has arrived in this partition yet." : `Last arrival ${shortTime(at)}.`;
}
