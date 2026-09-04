/**
 * Display words for the queue.
 *
 * Every string here is written about a pair, a signal or a queue property and
 * never about a person (CLAUDE.md rule 5). Anything built from a row goes
 * through compose, which degrades rather than throws, so a bad string costs a
 * clause and never the whole list.
 *
 * The band and provenance maps are duplicated from the fixtures on purpose: the
 * fixture module builds an audit chain at import, and pulling that into the
 * client bundle to read seven labels is the wrong trade. A shared label module
 * belongs in the foundation when a second page needs the same words.
 */

import { compose } from "@/lib/compose";
import type { AgeBand, BandProvenance, BandReading, ClaimState } from "@/lib/data/types";

/** How a case was opened. A claim is a write; a read only open is not. */
export type OpenMode = "claim" | "read_only";

const BAND_WORDS: Record<AgeBand, string> = {
  UNDER_9: "under 9",
  A9_12: "9-12",
  A13_15: "13-15",
  A16_17: "16-17",
  A18_20: "18-20",
  A21_PLUS: "21+",
  UNKNOWN: "unknown",
};

/**
 * A band from a Discord role is not the same claim as one from an identity
 * document, and the gap usually drives the rank, so the card says which it is.
 */
const PROVENANCE_WORDS: Record<BandProvenance, string> = {
  facial_estimate: "facial estimate",
  government_id: "identity document",
  os_bracket: "device bracket",
  server_role: "role-derived",
  platform_default: "platform default",
  customer_declared: "customer declared",
  unknown: "source not recorded",
};

/** Signal codes as the scorer writes them, in the words a reviewer reads. */
const SIGNAL_WORDS: Record<string, string> = {
  threat_template: "threat template match",
  payment_after_media: "payment demand after a media event",
  coercion_nonfinancial: "coercion language, non-financial",
  meetup_logistics: "meetup logistics with an age gap",
  known_csam_hash: "known-hash verdict from the operator",
  off_platform_migration: "migration ask",
  supervision_probe: "supervision probe",
  economic_bait: "economic bait",
};

export function bandWord(band: AgeBand): string {
  return BAND_WORDS[band] ?? "unknown";
}

export function signalWord(code: string): string {
  return SIGNAL_WORDS[code] ?? code.replace(/_/g, " ");
}

/** "bands 16-17 to 9-12, role-derived". Both provenances when they differ. */
export function bandsClause(actor: BandReading, target: BandReading): string {
  const source =
    actor.provenance === target.provenance
      ? PROVENANCE_WORDS[actor.provenance]
      : `${PROVENANCE_WORDS[actor.provenance]} and ${PROVENANCE_WORDS[target.provenance]}`;
  return compose(
    "queue.bandsClause",
    `bands ${bandWord(actor.band)} to ${bandWord(target.band)}, ${source}`,
  );
}

/** The absent case is stated rather than left to inference. */
export function criticalClause(signals: string[]): string {
  if (signals.length === 0) return "critical: none";
  return compose("queue.criticalClause", `critical: ${signals.map(signalWord).join(", ")}`);
}

/** Under an hour of SLA left counts as breach risk, in the header and on the row. */
export const BREACH_RISK_MINUTES = 60;

/**
 * Minutes and not seconds. A ticking second counter is a stopwatch, and the SLA
 * is a property of the queue rather than a measure of a reviewer.
 */
export function slaClause(minutesRemaining: number | null): string {
  if (minutesRemaining === null) return "no SLA (watch)";
  if (minutesRemaining <= 0) return "past the SLA window";
  const hours = Math.floor(minutesRemaining / 60);
  const minutes = minutesRemaining % 60;
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

function agoWords(minutes: number): string {
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Claim ownership in words. Enforced on open rather than advisory. */
export function claimClause(claim: ClaimState): string {
  if (claim.state === "unclaimed") return "unclaimed";
  if (claim.state === "mine") {
    return compose("queue.claimClause", `claimed by you, ${agoWords(claim.sinceMinutes)}`);
  }
  return compose("queue.claimClause", `claimed by ${claim.who}, ${agoWords(claim.sinceMinutes)}`);
}

/** Line three, when the operator's posture for this case is support. */
export const SUPPORT_POSTURE_NOTE = "no enforcement action offered on this case";
export const SUPPORT_POSTURE_CHIP = "support posture suggested";

export function shortTime(at: Date): string {
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
