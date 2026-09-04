/**
 * The one polite live region in the app, and the only way to write to it.
 *
 * The region is rendered once by the app shell. Anything that changes the page
 * without moving focus (a span revealed, a decision recorded, a queue count
 * moving) says so here in a sentence, because a change a screen reader is not
 * told about is a change that did not happen for that reviewer.
 *
 * Sentences only. This is not an event feed and it never names a person.
 */

export const LIVE_REGION_ID = "guardian-live-region";

export function announce(sentence: string): void {
  if (typeof document === "undefined") return;
  const region = document.getElementById(LIVE_REGION_ID);
  if (!region) return;
  // The same string twice in a row is not re-announced by most readers, so the
  // region is cleared first. The clear itself is not announced.
  region.textContent = "";
  region.textContent = sentence;
}
