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
import type {
  AgeBand,
  BandProvenance,
  BandReading,
  ClaimState,
  OpenProposal,
} from "@/lib/data/types";

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
/**
 * The named signal, or nothing at all.
 *
 * "critical: none" used to print on every card that had no critical signal,
 * which is a line of text saying that nothing happened. The tier badge already
 * carries the diamond when a signal fired, so absence needs no words.
 */
export function criticalClause(signals: string[]): string | null {
  if (signals.length === 0) return null;
  return compose("queue.criticalClause", signals.map(signalWord).join(", "));
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
/**
 * What the support posture means, said in full.
 *
 * It used to read "no enforcement action offered on this case", which tells a
 * reviewer what the software will not do rather than what they are looking at.
 * The account this tier describes is itself in a younger band, and the reason
 * that happens is that people who do this were disproportionately victims
 * themselves (ROADMAP S4). A reviewer who reads the headline first and this
 * second has already read the case wrong, so it goes above the headline and it
 * says the thing.
 */
export const SUPPORT_POSTURE_NOTE =
  "The account this describes is itself in a younger band. Read this as a welfare case, not an enforcement one.";
export const SUPPORT_POSTURE_CHIP = "support posture suggested";

export function shortTime(at: Date): string {
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* -------------------------------------------------------------------------- */
/* The row's four lines                                                       */
/* -------------------------------------------------------------------------- */

/** The six stages, so "five of six" means something. */
const STAGE_COUNT = 6;

/**
 * What fired, and whether it forces a review on its own.
 *
 * This is the line that keeps a reviewer thinking. Every triage discipline that
 * puts a score in front of a human has been burned by the human deferring to
 * it, and Guardian's whole legal posture rests on the person deciding. So the
 * row separates the checkable fact from the estimate: a critical signal is a
 * rule that fired and forces review whatever the score says, and everything
 * else is the model's reading.
 */
export function basisClause(criticalSignals: string[]): string {
  if (criticalSignals.length === 0) {
    return compose(
      "queue.basisClause.none",
      "Nothing here is serious enough on its own. Guardian flagged the shape of it.",
    );
  }
  const named = criticalSignals.map(signalWord).join(", ");
  return compose(
    "queue.basisClause.critical",
    `A ${named} is enough on its own.`,
  );
}

/** How far it went and over how long. The trajectory, which is the signal. */
export function trajectoryClause(stagesReached: number, spanHours: number): string {
  if (stagesReached <= 1) {
    return compose("queue.trajectory.single", "It got no further than that.");
  }
  /*
   * "over 1 hours" was on screen. Rounding a span to whole hours and then
   * printing the number with a fixed plural gets it wrong for every case that
   * ran under two hours, which is the compressed pattern this product cares
   * most about.
   */
  const days = Math.round(spanHours / 24);
  const span =
    spanHours <= 0
      ? "in one sitting"
      : spanHours < 1
        ? "inside an hour"
        : spanHours < 2
          ? "over about an hour"
          : spanHours < 48
            ? `over ${Math.round(spanHours)} hours`
            : `over ${days} ${days === 1 ? "day" : "days"}`;
  return compose(
    "queue.trajectory",
    `It moved through ${stagesReached} of the ${STAGE_COUNT} grooming stages ${span}.`,
  );
}

/**
 * Both ages, how each was read, and whether that reading is worth anything.
 *
 * A case resting on an age gap that came from a Discord role is the commonest
 * reason to close one without opening it, so the provenance is a sentence
 * rather than a suffix.
 */
export function agesClause(actor: BandReading, target: BandReading): string {
  const verified: BandProvenance[] = ["government_id", "customer_declared"];
  const estimated: BandProvenance[] = ["facial_estimate", "os_bracket"];

  const ages = `Ages ${bandWord(actor.band)} and ${bandWord(target.band)}`;
  const both = actor.provenance === target.provenance ? actor.provenance : null;

  /*
   * Both unknown is the bridged-chat case (ROADMAP 2c). A relayed player is a
   * name inside somebody else's post rather than a member with roles, so
   * Guardian has no age for either side. Saying so is the point: the age gap is
   * the signal this product is built around, and a reviewer who is not told it
   * was unavailable will read its absence as its absence from the conversation.
   */
  if (actor.band === "UNKNOWN" && target.band === "UNKNOWN") {
    return compose(
      "queue.ages.neither",
      "Neither age is known, so the age gap counted for nothing here. This rests on what was said.",
    );
  }
  if (actor.band === "UNKNOWN" || target.band === "UNKNOWN") {
    return compose("queue.ages.unknown", `${ages}. One side's age was never read.`);
  }
  if (both && verified.includes(both)) {
    return compose("queue.ages.verified", `${ages}, both from your own records.`);
  }
  if (both && estimated.includes(both)) {
    return compose("queue.ages.estimated", `${ages}, both estimated rather than confirmed.`);
  }
  if (both === "server_role") {
    return compose(
      "queue.ages.role",
      `${ages}. Both come from Discord roles, so neither is confirmed.`,
    );
  }
  return compose(
    "queue.ages.mixed",
    `${ages}. One is ${PROVENANCE_WORDS[actor.provenance]} and the other ${PROVENANCE_WORDS[target.provenance]}, so neither is confirmed.`,
  );
}

/**
 * When this is due, as a clock time.
 *
 * It used to be a countdown that re-rendered every row every thirty seconds.
 * That is the sort key printed six times, it does not help anybody decide what
 * to open, and a shift spent watching six deadlines decrement is a stopwatch
 * whatever the comment above it says. A clock time is checkable against the
 * wall and needs no timer.
 */
export function dueClause(
  tier: string,
  createdAt: Date,
  slaRemainingMinutes: number | null,
  resolved: boolean,
): { text: string; urgent: boolean } {
  if (resolved) return { text: "resolved", urgent: false };
  if (slaRemainingMinutes === null) return { text: "Watch, no target", urgent: false };

  const due = new Date(createdAt.getTime() + SLA_MINUTES * 60_000);
  const clock = `${String(due.getUTCHours()).padStart(2, "0")}:${String(due.getUTCMinutes()).padStart(2, "0")}`;

  if (slaRemainingMinutes <= 0) {
    return { text: `Past the target, was due ${clock}`, urgent: true };
  }
  if (slaRemainingMinutes <= BREACH_RISK_MINUTES) {
    return { text: `Due by ${clock}, under an hour`, urgent: true };
  }
  return { text: `Due by ${clock}`, urgent: false };
}

/** DESIGN.md 6.4: a human sees a T2 within four hours. */
const SLA_MINUTES = 4 * 60;

/** "the older account" / "the younger account". A side, never a person. */
export function speakerWord(from: "older" | "younger"): string {
  return from === "older" ? "the older account" : "the younger account";
}

/**
 * A clause written to sit mid-line, promoted to its own sentence.
 *
 * actorContext is phrased for a chip ("actor in 3 pairs this week") and the row
 * sets it after another sentence, where a lowercase fragment and a missing full
 * stop read as a layout accident.
 */
export function sentenceCase(clause: string): string {
  const trimmed = clause.trim();
  if (trimmed === "") return "";
  const first = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/**
 * The line an unanswered proposal puts on its queue row.
 *
 * A proposal writes no tier, so without this the pair sits in the queue as an
 * ordinary T2 and the second reviewer it is waiting for cannot tell. Two
 * sentences, because the two readers need different things: the person who
 * proposed it needs to know it is still waiting, and everybody else needs to
 * know they are the one who can finish it.
 */
export function proposalClause(proposal: OpenProposal, now = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - proposal.proposedAt.getTime()) / 60_000));
  const waited =
    minutes < 60
      ? `${minutes} min`
      : minutes < 24 * 60
        ? `${Math.round(minutes / 60)}h`
        : `${Math.round(minutes / (24 * 60))}d`;
  return proposal.mine
    ? `Your report proposal has been waiting ${waited} for a second reviewer.`
    : `Waiting on you. ${proposal.proposerName} proposed a report ${waited} ago, and it needs a second person before it can be filed.`;
}

/**
 * The one line the list carries under the quote.
 *
 * The card had four paragraphs: whether a critical signal fired, how many of
 * six stages were walked and over how long, both ages with the provenance of
 * each, and how many conversations the account was in. Every one of them is
 * true and every one belongs on the case, where somebody is actually deciding.
 * On a list they are four paragraphs a moderator scrolls past to reach the next
 * headline.
 *
 * What survives is what settles the only question a list has to settle: is this
 * worth opening. A forced review says so. An account doing this to several
 * children says so. Otherwise the trajectory does.
 */
export function summaryLine(item: {
  criticalSignals: string[];
  stagesReached: number;
  actorContext: string;
}): string {
  if (item.criticalSignals.length > 0) {
    const named = item.criticalSignals.map(signalWord).join(", ");
    return compose("queue.summary.critical", `A ${named}. Serious on its own.`);
  }
  const several = /\b([2-9]|\d\d+) conversations\b/.exec(item.actorContext);
  if (several) {
    return compose(
      "queue.summary.fanout",
      `This account is in ${several[1]} conversations like this one this week.`,
    );
  }
  if (item.stagesReached <= 1) {
    return compose("queue.summary.single", "One step, and it went no further.");
  }
  return compose(
    "queue.summary.stages",
    `It walked ${item.stagesReached} of the ${STAGE_COUNT} grooming steps.`,
  );
}

/**
 * An account, as short as it can be and still be looked up.
 *
 * On fixtures a uid is "northwood:jayden_k" and the customer prefix is the same
 * on every row, so it carries no information and costs half the line. In
 * production a uid is a per-customer salted hash (rule 8) and the last eight
 * characters are what a reviewer matches against the case page and the bundle.
 */
export function accountLabel(uid: string): string {
  const bare = uid.includes(":") ? uid.slice(uid.lastIndexOf(":") + 1) : uid;
  return bare.length > 20 ? bare.slice(-8) : bare;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When this happened, in the words somebody says out loud.
 *
 * Rendered on the server against a fixed now, so it does not disagree with
 * itself after hydration. Anything older than a week gets the date, because
 * "9 days ago" is arithmetic the reader then has to undo.
 */
export function whenWords(at: Date, now = new Date()): string {
  const clock = at
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    })
    .toLowerCase();
  const days = Math.floor((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  if (days < 7) return `${DAY_NAMES[at.getUTCDay()]} ${clock}`;
  return `${at.getUTCDate()} ${MONTH_NAMES[at.getUTCMonth()]} ${clock}`;
}

function startOfDay(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Which conversation this row is, tied to a time and to two accounts.
 *
 * The card printed the last four of the pair id, in a mono face, and nothing
 * else. That is a database key: it does not say who was talking, or when, and a
 * moderator holding a Discord alert with two account names and a timestamp had
 * no way to find the matching case. This is that line.
 *
 * It names accounts and never a person: an account identifier is what the mod
 * alert already carries and what the case page has always shown, and no word
 * here says anything about who either account belongs to (rule 5).
 */
export function whoAndWhen(
  item: { actorUid: string; targetUid: string; channel: string | null; createdAt: Date },
  now = new Date(),
): string {
  const between = `${accountLabel(item.actorUid)} to ${accountLabel(item.targetUid)}`;
  const where = item.channel ? ` in ${item.channel}` : "";
  return compose("queue.whoAndWhen", `${between}${where} · ${whenWords(item.createdAt, now)}`);
}
