import type { RetentionClass, Tier } from "./types.js";

/**
 * Retention is a scheduled job, not a hope (CLAUDE.md rule 7). Every stored row
 * carries a class and an expiry, assigned at write time from the current tier
 * and revised upward when the tier moves.
 */

export const RETENTION_MS: Record<RetentionClass, number | null> = {
  EPHEMERAL_24H: 24 * 60 * 60 * 1000,
  WATCH_30D: 30 * 24 * 60 * 60 * 1000,
  /** 18 USC 2258A preservation duty. */
  CASE_1Y: 365 * 24 * 60 * 60 * 1000,
  /** Held until a named custodian releases it. */
  LEGAL_HOLD: null,
};

const RANK: Record<RetentionClass, number> = {
  EPHEMERAL_24H: 0,
  WATCH_30D: 1,
  CASE_1Y: 2,
  LEGAL_HOLD: 3,
};

export function retentionForTier(tier: Tier): RetentionClass {
  switch (tier) {
    case "T0":
      return "EPHEMERAL_24H";
    case "T1":
      return "WATCH_30D";
    case "T2":
      return "WATCH_30D";
    case "T3":
      return "CASE_1Y";
  }
}

/** Retention only ever ratchets up. A later T0 score must not shorten a T3 case. */
export function escalateRetention(current: RetentionClass, next: RetentionClass): RetentionClass {
  return RANK[next] > RANK[current] ? next : current;
}

export function expiresAt(retention: RetentionClass, from: Date = new Date()): Date | null {
  const ms = RETENTION_MS[retention];
  if (ms === null) return null;
  return new Date(from.getTime() + ms);
}

/**
 * T0 keeps features only and drops raw text within 24h (DESIGN.md 7). This is
 * the single place that decides whether text survives the write.
 */
export function textRetainedForTier(tier: Tier): boolean {
  return tier !== "T0";
}
