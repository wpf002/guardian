import styles from "./TierBadge.module.css";
import type { Tier } from "@/lib/data/types";

/** The tier word, and what the tier means in plain words. Never a risk adjective. */
export const TIER_MEANING: Record<Tier, string> = {
  T0: "nothing notable",
  T1: "watch, retained 30 days",
  T2: "review",
  T3: "reviewer-confirmed, report drafted",
};

export interface TierBadgeProps {
  tier: Tier;
  variant?: "inline" | "bar";
  /** Prints the meaning after the word. Off on a dense list. */
  withMeaning?: boolean;
  /** Named in words, never a colour or a shape on its own. */
  criticalSignals?: string[];
}

export function TierBadge({
  tier,
  variant = "inline",
  withMeaning = false,
  criticalSignals = [],
}: TierBadgeProps) {
  const tone = styles[tier.toLowerCase()] ?? styles.t0;
  const hasCritical = criticalSignals.length > 0;
  const label = hasCritical
    ? `Tier ${tier}, critical signal: ${criticalSignals.join(", ")}`
    : `Tier ${tier}`;

  return (
    <span
      className={`${styles.badge} ${styles[variant]} ${tone}`}
      data-tier={tier}
      data-variant={variant}
      aria-label={label}
    >
      {hasCritical ? (
        <span className={styles.critical} aria-hidden="true">
          &#9670;
        </span>
      ) : null}
      <span className={styles.word}>{tier}</span>
      {withMeaning ? <span className={styles.meaning}>{TIER_MEANING[tier]}</span> : null}
    </span>
  );
}
