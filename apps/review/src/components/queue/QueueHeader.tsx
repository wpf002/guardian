import type { QueueSummary } from "@/lib/data/types";
import { shortTime } from "./words";
import styles from "./QueueHeader.module.css";

export interface QueueHeaderProps {
  summary: QueueSummary;
  /**
   * How many accounts in a younger band somebody older is talking to.
   *
   * The header counted conversations, which is Guardian's unit rather than a
   * person's: three accounts working on one child counted as three, and the
   * number a moderator opening this page needs is one.
   */
  targetedCount: number;
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
export function QueueHeader({ summary, targetedCount, notice }: QueueHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.main}>
        <h1 className={styles.title}>Dashboard</h1>
        {/*
          What is here to read, and nothing about how far behind anybody is.
          
          This counted a backlog and a breach-risk figure beside it, which turns
          a page for reading conversations into a page about keeping up with a
          queue. Rule 6 asks for a person to confirm before a report exists. It
          does not ask for a service level.
        */}
        <p className={`${styles.counts} tabular`} role="status">
          <span>{summary.partitionName}</span>
          {/*
            Two words after the number. It read "3 Accounts Somebody Older Is
            Talking To", which is a sentence explaining the grouping printed
            above a tab that already says it, every time the page loads.
          */}
          <span>
            <strong>{targetedCount}</strong> Being Contacted
          </span>
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
