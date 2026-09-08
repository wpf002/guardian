import type { QueueSummary } from "@/lib/data/types";
import { shortTime } from "./words";
import styles from "./QueueHeader.module.css";

export interface QueueHeaderProps {
  summary: QueueSummary;
  /** A short statement about the last action, when there is one. */
  notice?: string | null;
}

/**
 * Above the fold: where you are and how many are waiting. No charts, no trend,
 * no welcome.
 *
 * Two things that were here are gone. A disclosure headed "Why this order" held
 * a paragraph explaining the rank formula; nobody asked for it, and a queue that
 * argues for its own sort order before showing a case is spending the fold on
 * itself. And there was a session budget, added from reviewer-wellbeing research
 * rather than from the spec, which became the largest element on a page whose
 * job is to show cases.
 */
export function QueueHeader({ summary, notice }: QueueHeaderProps) {
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
