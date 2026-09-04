/**
 * Turning a chain verification into words.
 *
 * Kept out of actions.ts because a "use server" module may only export async
 * functions, and out of the client component because formatting a Date in the
 * browser after formatting it on the server is a hydration mismatch.
 */

import type { ChainVerification } from "@/components/dashboard";
import type { VerificationView } from "./metrics";
import { shortHash, stampUtc } from "./format";

/** The panel owns the shape it renders, so this is its type and not a copy of it. */
export type VerificationDisplay = ChainVerification;

export function describeVerification(view: VerificationView): VerificationDisplay {
  const checkedAt = stampUtc(view.at);
  const entries = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

  if (view.state === "ok") {
    return {
      state: "ok",
      headline: `Chain verified. ${entries(view.checked)} checked.`,
      detail: `Head hash ${shortHash(view.head)}. Every entry links to the one before it.`,
      checkedAt,
    };
  }
  if (view.state === "broken") {
    return {
      state: "broken",
      headline: `Chain verification failed at entry ${view.brokenAt}.`,
      detail: `${view.reason.replace(/_/g, " ")}: ${view.detail}. ${entries(
        view.checked,
      )} checked before the break.`,
      checkedAt,
    };
  }
  return {
    state: "unavailable",
    headline: "The chain could not be read.",
    detail: `${view.why}. Scoring, the queue and every recorded decision are unaffected.`,
    checkedAt,
  };
}
