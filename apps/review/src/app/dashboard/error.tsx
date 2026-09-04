"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components";
import styles from "./page.module.css";

/**
 * The failure state names what failed and what is unaffected, and retries only
 * when a person asks. A dashboard that retries itself flickers between states
 * while somebody is reading a number off it.
 *
 * Nothing on this page is load bearing for a case: the queue, the timeline and
 * every recorded decision are elsewhere and keep working while this is broken.
 * Saying so is the point of the second line.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("dashboard read failed", error);
  }, [error]);

  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.header}>
        <h1 className={styles.title}>Health</h1>
      </header>
      <ErrorState
        title="The dashboard could not read this partition."
        unaffected="Scoring, the review queue, recorded decisions and the audit chain are unaffected. Nothing on this page changes any of them."
        onRetry={reset}
      />
    </div>
  );
}
