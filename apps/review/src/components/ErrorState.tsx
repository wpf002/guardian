"use client";

import { useState } from "react";
import { Button } from "./Button";
import styles from "./States.module.css";

export interface ErrorStateProps {
  /** Names what failed. Never "something went wrong". */
  title: string;
  /** What is unaffected, so a reviewer knows what is still true. */
  unaffected: string;
  lastSuccessAt?: string;
  /** Manual only. A view that auto-retries flickers between states. */
  onRetry?: () => void | Promise<void>;
}

export function ErrorState({ title, unaffected, lastSuccessAt, onRetry }: ErrorStateProps) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className={styles.state} data-state="error" role="alert">
      <p className={styles.title}>{title}</p>
      <p className={styles.detail}>{unaffected}</p>
      {lastSuccessAt ? <p className={styles.meta}>Last successful load {lastSuccessAt}.</p> : null}
      {onRetry ? (
        <div className={styles.action}>
          <Button variant="secondary" loading={retrying} onClick={retry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
