"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./Button";
import styles from "./Toast.module.css";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  /** The one action, if there is one. */
  action?: { label: string; onAction: () => void };
  onDismiss?: () => void;
  /**
   * Seconds this bar stays useful. Rendered as text, and the bar does not move
   * or fade while it counts. Omit for a bar that stays until dismissed.
   */
  countdownSeconds?: number;
  children?: ReactNode;
}

export function Toast({
  message,
  tone = "info",
  action,
  onDismiss,
  countdownSeconds,
  children,
}: ToastProps) {
  // Seeded once. A bar whose window changes underneath the reader is a bar that
  // cannot be trusted, so a new window means a new bar.
  const [remaining, setRemaining] = useState<number | null>(countdownSeconds ?? null);

  useEffect(() => {
    if (countdownSeconds === undefined) return;
    const timer = setInterval(() => {
      setRemaining((value) => (value === null || value <= 0 ? 0 : value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdownSeconds]);

  const expired = remaining !== null && remaining <= 0;

  return (
    <div className={`${styles.toast} ${styles[tone]}`} role="status" aria-live="polite">
      <span className={styles.message}>{message}</span>
      {children}
      {remaining !== null ? (
        <span className={styles.seconds}>
          {expired ? "window closed" : `${remaining}s left`}
        </span>
      ) : null}
      <span className={styles.actions}>
        {action && !expired ? (
          <Button variant="secondary" onClick={action.onAction}>
            {action.label}
          </Button>
        ) : null}
        {onDismiss ? (
          <Button variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : null}
      </span>
    </div>
  );
}
