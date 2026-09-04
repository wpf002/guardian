"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ErrorState";
import styles from "@/components/settings/settings.module.css";

/**
 * The route boundary. It names what failed and what is still true, because a
 * settings page that fails tells you nothing about whether the queue is running,
 * and the honest answer is that it is.
 */
export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("settings route failed", error);
  }, [error]);

  return (
    <div className={`container ${styles.page}`}>
      <h1>Settings</h1>
      <div className={styles.sections}>
        <ErrorState
          title="Settings could not be loaded."
          unaffected="Nothing was changed, and scoring, the queue and the audit chain are unaffected. This page reads configuration and writes only when you press a button."
          onRetry={reset}
        />
      </div>
    </div>
  );
}
