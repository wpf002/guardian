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

/**
 * The four statutory brackets. The kernel reasons in six bands because that is
 * what the platforms publish; the statutes reason in brackets. Texas HB 18 and
 * the California Age-Appropriate Design Code both cut at under 13, 13 to 15,
 * 16 to 17 and adult, and Regulation (EU) 2026/1881 turns on age difference
 * across that same line.
 *
 * Deriving rather than storing keeps one mapping. Every band sits inside
 * exactly one bracket, so nothing is lost in the projection, and any future
 * change to the band scheme has to preserve that property or this function
 * stops being total. The band coverage test in agebands.test.ts holds that.
 */
export const STATUTORY_BRACKETS = [
  "UNDER_13",
  "AGE_13_15",
  "AGE_16_17",
  "AGE_18_PLUS",
  "UNKNOWN",
] as const;

export type StatutoryBracket = (typeof STATUTORY_BRACKETS)[number];

const BRACKET: Record<AgeBand, StatutoryBracket> = {
  UNDER_9: "UNDER_13",
  A9_12: "UNDER_13",
  A13_15: "AGE_13_15",
  A16_17: "AGE_16_17",
  A18_20: "AGE_18_PLUS",
  A21_PLUS: "AGE_18_PLUS",
  UNKNOWN: "UNKNOWN",
};

/** The statutory bracket a band falls in. Derived, never stored. */
export function statutoryBracket(band: AgeBand): StatutoryBracket {
  return BRACKET[band];
}

/**
 * True when both bands are known and fall in different brackets. This is the
 * age-difference test the EU derogation names as a permitted risk factor, and
 * it is coarser on purpose than `bandGap`.
 */
export function crossesStatutoryBracket(actor: AgeBand, target: AgeBand): boolean {
  const a = statutoryBracket(actor);
  const t = statutoryBracket(target);
  if (a === "UNKNOWN" || t === "UNKNOWN") return false;
  return a !== t;
}

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
