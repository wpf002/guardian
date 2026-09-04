/**
 * The wording guard at the data boundary (DESIGN-UI 3 and 10).
 *
 * assertNoAccusation throws, and a throw inside a leaf React component is an
 * error boundary and a blank screen for a reviewer mid-case, which is a worse
 * failure than the string. So a string built from data is guarded here, in the
 * same call that returns it, and a failure degrades to one sentence with the
 * case otherwise intact. The counter is the cheapest proof to counsel that
 * rule 5 is enforced at runtime and not only in CI.
 */

import { assertNoAccusation, findAccusations } from "@guardian/schema/language";

export const WITHHELD_SUMMARY = "This summary was withheld by the wording guard.";

let withheld = 0;

/**
 * Guard a string built from data. Returns the string, or the withheld sentence
 * when it would have made a claim about a person.
 */
export function compose(where: string, text: string): string {
  const findings = findAccusations(text);
  if (findings.length === 0) return text;
  withheld += 1;
  if (process.env.NODE_ENV !== "test") {
    console.warn(`wording guard withheld a string at ${where}: ${findings[0]!.why}`);
  }
  return WITHHELD_SUMMARY;
}

/**
 * Guard a literal. Throws, so a violating string fails at import rather than at
 * render. Use this for anything written by hand, never for anything built from
 * a row.
 */
export function assertCopy(where: string, text: string): string {
  return assertNoAccusation(text, where);
}

/** Non-zero is a defect somebody can act on. Surfaced to the owner in settings. */
export function withheldStringCount(): number {
  return withheld;
}

/** Test hook. */
export function resetWithheldStringCount(): void {
  withheld = 0;
}
