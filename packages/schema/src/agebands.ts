/**
 * Age bands, not birthdates (DESIGN.md 7, CLAUDE.md rule 9).
 * Six real bands matching Roblox's scheme, plus UNKNOWN.
 */

export const AGE_BANDS = [
  "UNDER_9",
  "A9_12",
  "A13_15",
  "A16_17",
  "A18_20",
  "A21_PLUS",
  "UNKNOWN",
] as const;

export type AgeBand = (typeof AGE_BANDS)[number];

/** Ordinal position used for gap math. UNKNOWN has no position. */
const ORDER: Record<AgeBand, number | null> = {
  UNDER_9: 0,
  A9_12: 1,
  A13_15: 2,
  A16_17: 3,
  A18_20: 4,
  A21_PLUS: 5,
  UNKNOWN: null,
};

/** Midpoint age used for the adult test and for readable gap reporting. */
const MIDPOINT: Record<AgeBand, number | null> = {
  UNDER_9: 7,
  A9_12: 10.5,
  A13_15: 14,
  A16_17: 16.5,
  A18_20: 19,
  A21_PLUS: 30,
  UNKNOWN: null,
};

export function isMinorBand(band: AgeBand): boolean {
  return band === "UNDER_9" || band === "A9_12" || band === "A13_15" || band === "A16_17";
}

export function isAdultBand(band: AgeBand): boolean {
  return band === "A18_20" || band === "A21_PLUS";
}

export function bandOrder(band: AgeBand): number | null {
  return ORDER[band];
}

/** True when both bands are known and equal. Same-band traffic scores at reduced priority. */
export function sameBand(a: AgeBand, b: AgeBand): boolean {
  return a === b && a !== "UNKNOWN";
}

/**
 * Band distance from actor to target. Positive means the actor is older.
 * Null when either band is unknown, so callers must decide what to do with
 * missing data rather than getting a silent zero.
 */
export function bandGap(actor: AgeBand, target: AgeBand): number | null {
  const a = ORDER[actor];
  const t = ORDER[target];
  if (a === null || t === null) return null;
  return a - t;
}

/** Approximate year gap from band midpoints. Reporting only, never a threshold. */
export function yearGap(actor: AgeBand, target: AgeBand): number | null {
  const a = MIDPOINT[actor];
  const t = MIDPOINT[target];
  if (a === null || t === null) return null;
  return a - t;
}

/**
 * Multiplier for the age gap term in the pair score (DESIGN.md 6.2).
 * An adult talking to an under-13 is the shape in the case files. Teen to teen
 * is lawful and must not be inflated, so same-band pairs sit below 1.
 */
export function ageGapMultiplier(actor: AgeBand, target: AgeBand): number {
  if (!isMinorBand(target)) return 0.4;
  if (actor === "UNKNOWN" || target === "UNKNOWN") return 0.8;

  const gap = bandGap(actor, target);
  if (gap === null) return 0.8;

  if (isAdultBand(actor)) {
    if (target === "UNDER_9" || target === "A9_12") return 2.0;
    if (target === "A13_15") return 1.8;
    return 1.4;
  }
  if (gap <= 0) return 0.5;
  if (gap === 1) return 1.0;
  return 1.3;
}
