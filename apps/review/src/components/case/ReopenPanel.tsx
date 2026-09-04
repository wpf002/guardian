"use client";

import { Button, TierBadge } from "@/components";
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
      <h2 className={styles.title}>This case is resolved</h2>
      <p className={styles.lead}>
        Recorded on {resolvedAt.toLocaleString()} at <TierBadge tier={resolvedTier} withMeaning />.
      </p>

      {reported ? (
        <p className={styles.consequence}>
          A case that reached a reviewer-confirmed report is not reopened here. Retracting a
          filed report is a separate act with its own consequence, and that path is not built
          yet.
        </p>
      ) : excerptsExpired ? (
        <p className={styles.consequence}>
          The excerpts behind this decision were deleted under the retention rule, so there is
          nothing left to read. The features and the tier remain.
        </p>
      ) : (
        <>
          <p className={styles.consequence}>
            Reopening records a new decision alongside the earlier one. The earlier row is not
            edited and not deleted, and it stays visible in the decision log exactly as it was.
            {retentionDeadline
              ? ` Reopening is available until the excerpts are deleted on ${retentionDeadline.toLocaleDateString()}.`
              : ""}
          </p>
          <div className={styles.escapes}>
            <Button variant="secondary" onClick={onReopen}>
              Reopen this case
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
