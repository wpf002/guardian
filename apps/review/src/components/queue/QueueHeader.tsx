import { SessionTimer } from "@/components/SessionTimer";
import type { QueueSummary } from "@/lib/data/types";
import { shortTime } from "./words";
import styles from "./QueueHeader.module.css";

export interface QueueHeaderProps {
  summary: QueueSummary;
  /** Printed, because a reviewer who cannot see why A is above B loses trust. */
  rankingSentence: string;
  /** Stand-in for the shift start until a reviewer session row exists. */
  sessionStartedAt: Date;
  /** A short statement about the last action, when there is one. */
  notice?: string | null;
}

/**
 * Above the fold: partition, counts, the ranking rule and the session budget.
 * No charts, no trend, no welcome.
 *
 * The budget sits here rather than in settings because exposure held to a few
 * hours a day is the finding that drives reviewer outcomes, and making the
 * budget ambient is the cheapest way to hold it.
 */
export function QueueHeader({
  summary,
  rankingSentence,
  sessionStartedAt,
  notice,
}: QueueHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.main}>
        <h1 className={styles.title}>Queue</h1>
        <p className={`${styles.counts} tabular`} role="status">
          <span>{summary.partitionName}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{summary.total} in queue</span>
          <span aria-hidden="true">&middot;</span>
          <span>live</span>
          <span aria-hidden="true">&middot;</span>
          <span>{summary.breachRiskCount} at breach risk</span>
        </p>
        <p className={styles.ranking}>{rankingSentence}</p>
        <details className={styles.how}>
          <summary className={styles.summary}>How ranking works</summary>
          <p className={styles.howBody}>
            Severity comes first: the tier, and whether a critical signal fired. That is multiplied
            by how identifiable the younger band is and by how many pairs the same account appears
            in, then divided by the SLA time left, so a case with less time rises. The order is a
            property of the queue. It is not a statement about anybody.
          </p>
        </details>
        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}
      </div>
      <div className={styles.aside}>
        <SessionTimer startedAt={sessionStartedAt} />
        <p className={styles.asideNote}>
          Your session budget is not persisted yet, so it counts from the moment you signed in.
        </p>
      </div>
    </header>
  );
}

/** The last arrival, so a reviewer can tell an empty queue from a broken one. */
export function lastArrivalWords(at: Date | null): string {
  return at === null ? "Nothing has arrived in this partition yet." : `Last arrival ${shortTime(at)}.`;
}
