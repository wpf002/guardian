"use client";

import { ErrorState } from "@/components/ErrorState";
import styles from "./page.module.css";

/**
 * Names what failed, says what is unaffected, and retries only when a person
 * asks. Nothing from the error object is printed: a stack trace on this screen
 * is a leak, not a diagnostic.
 */
export default function QueueError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className={styles.page}>
      <p className={styles.loadingTitle}>Queue</p>
      <ErrorState
        title="The queue could not be reached."
        unaffected="Cases are not lost. The scorer keeps writing while this view is down, and anything you already decided is recorded."
        onRetry={reset}
      />
    </div>
  );
}
