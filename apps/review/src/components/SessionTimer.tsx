"use client";

import { useEffect, useState } from "react";
import { Button } from "./Button";
import styles from "./SessionTimer.module.css";

/** Wellness limits from DESIGN-UI 11. An org may move each only protectively. */
export const SESSION_BUDGET_MINUTES = 120;
export const MICRO_BREAK_MINUTES = 25;
/** Tone changes at 60% and the queue stops serving at 100%. */
export const ELEVATED_AT = 0.6;

export interface SessionTimerProps {
  /** When this shift's case time started. */
  startedAt: Date;
  budgetMinutes?: number;
  breakIntervalMinutes?: number;
  /** Minutes already spent before this mount, from the reviewer's session row. */
  minutesAlreadySpent?: number;
  onTakeBreak?: () => void;
  /** Test seam. Defaults to the wall clock. */
  now?: () => number;
}

/**
 * Elapsed shift time and the break prompt. It counts minutes, not seconds: a
 * ticking second counter is a stopwatch, and nothing in this product measures a
 * reviewer's speed.
 */
export function SessionTimer({
  startedAt,
  budgetMinutes = SESSION_BUDGET_MINUTES,
  breakIntervalMinutes = MICRO_BREAK_MINUTES,
  minutesAlreadySpent = 0,
  onTakeBreak,
  now,
}: SessionTimerProps) {
  const clock = now ?? Date.now;
  const [minutes, setMinutes] = useState(() =>
    Math.max(0, Math.floor((clock() - startedAt.getTime()) / 60_000) + minutesAlreadySpent),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setMinutes(
        Math.max(0, Math.floor((clock() - startedAt.getTime()) / 60_000) + minutesAlreadySpent),
      );
    }, 30_000);
    return () => clearInterval(timer);
  }, [startedAt, minutesAlreadySpent, clock]);

  const fraction = budgetMinutes > 0 ? Math.min(minutes / budgetMinutes, 1) : 0;
  const remaining = Math.max(budgetMinutes - minutes, 0);
  const minutesToBreak = Math.max(breakIntervalMinutes - (minutes % breakIntervalMinutes), 0);
  const breakDue = minutes > 0 && minutes % breakIntervalMinutes === 0;
  const tone = fraction >= 1 ? "spent" : fraction >= ELEVATED_AT ? "elevated" : "normal";

  return (
    <div
      className={`${styles.timer} ${tone === "elevated" ? styles.elevated : ""} ${tone === "spent" ? styles.spent : ""}`}
      data-tone={tone}
    >
      <div className={styles.line}>
        <span>
          {minutes} of {budgetMinutes} min
        </span>
        <span className={styles.label}>{remaining} min left</span>
      </div>
      <div
        className={styles.meter}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={budgetMinutes}
        aria-valuenow={minutes}
        aria-label="Session budget used"
      >
        <span className={styles.fill} style={{ transform: `scaleX(${fraction})`, display: "block" }} />
      </div>
      {tone === "spent" ? (
        <p className={styles.prompt}>
          Your session budget is spent. The queue stops serving new cases. It does not log you out
          and it never interrupts a case you have open.
        </p>
      ) : breakDue ? (
        <p className={styles.prompt}>A break is due now.</p>
      ) : (
        <p className={styles.prompt}>Next break in {minutesToBreak} min.</p>
      )}
      {onTakeBreak ? (
        <Button variant="secondary" onClick={onTakeBreak}>
          Take a break now
        </Button>
      ) : null}
    </div>
  );
}
