"use client";

import { Button } from "@/components";
import type { Tier } from "@/lib/data/types";
import styles from "./Decision.module.css";

export interface ReopenPanelProps {
  resolvedTier: Tier;
  resolvedAt: Date;
  /** True when the excerpts behind this case have already been deleted. */
  excerptsExpired: boolean;
  /** When the excerpts are scheduled to go, so the clock is a visible property. */
  retentionDeadline: Date | null;
  onReopen: () => void;
}

const REPORTED: Tier = "T3";

/**
 * Reopening a resolved case.
 *
 * History is additive. Reopening does not edit or delete the earlier decision,
 * and nothing here says the earlier decision was wrong. A reported case is not
 * reopened at all: retracting a filed report is a different act with a
 * different consequence.
 */
export function ReopenPanel({
  resolvedTier,
  resolvedAt,
  excerptsExpired,
  retentionDeadline,
  onReopen,
}: ReopenPanelProps) {
  const reported = resolvedTier === REPORTED;

  return (
    <section className={styles.panel} aria-label="Resolved case">
      <h2 className={styles.title}>Decided</h2>
      <p className={styles.lead}>{`Decided on ${resolvedAt.toLocaleDateString()}.`}</p>

      {reported ? (
        <p className={styles.consequence}>This was reported, so it can&apos;t be reopened here.</p>
      ) : excerptsExpired ? (
        <p className={styles.consequence}>The messages were deleted on schedule, so there&apos;s nothing left to read.</p>
      ) : (
        <>
          <p className={styles.consequence}>
            {retentionDeadline
              ? `You can reopen this until the messages are deleted on ${retentionDeadline.toLocaleDateString()}. The earlier decision stays on record.`
              : "Reopening keeps the earlier decision on record."}
          </p>
          <div className={styles.escapes}>
            <Button variant="secondary" onClick={onReopen}>
              Reopen
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
