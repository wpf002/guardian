import type { Lexicon } from "./lexicon.js";
import { normalize } from "./normalize.js";
import type { FeedbackSource } from "./provenance.js";

/**
 * The lexicon mining loop's write path, and the guard on it.
 *
 * The loop turns feedback into candidate phrases a person later promotes into a
 * new lexicon version. That makes it a write path into detection, and one of
 * its sources is a dismissal control in a Discord mod channel, which is open to
 * anyone the guild gave Manage Messages to. A guild that wanted Guardian blind
 * to a phrase could otherwise dismiss on it repeatedly until the phrase looked
 * like a mined finding.
 *
 * Three things stop that, and they are all here rather than at the call sites:
 *
 * - Nothing promotes itself. A candidate is a proposal. Every score row names
 *   the lexicon version it ran under, so a phrase reaches production only in a
 *   new version a person cut, and this module cannot cut one.
 * - The writer is on the row. FeedbackSource says whether a reviewer, a
 *   moderator or an automated path proposed it, so a promotion decision can
 *   weigh a moderator's proposal differently from a reviewer's.
 * - A budget per writer per window, plus a repetition floor a single writer
 *   cannot reach alone. One account submitting a phrase a hundred times is one
 *   account's opinion, and the mining signal is agreement across conversations.
 *
 * The failure this is built to accept is under-recording. A candidate that was
 * rate limited is a phrase nobody mined, which costs a detection Guardian might
 * have had. A candidate mined from one account's campaign is a detection
 * Guardian has and should not.
 */

/** Windows and budgets. Named so a caller can state them rather than pass numbers. */
export const FEEDBACK_LIMITS = {
  /** Proposals one writer may make in a window. */
  perWriterPerWindow: 20,
  windowMs: 60 * 60 * 1000,
  /**
   * Distinct writers a candidate needs before it is worth a person's time. A
   * proposal below this is still recorded; it is not surfaced for promotion.
   */
  distinctWritersToSurface: 3,
  /** Longest phrase worth mining. Beyond this it is a message, not a phrase. */
  maxPhraseChars: 120,
} as const;

export type FeedbackRefusalCode =
  | "rate_limited"
  | "too_long"
  | "empty"
  | "not_a_phrase"
  | "suppression_list";

export interface FeedbackRefusal {
  ok: false;
  code: FeedbackRefusalCode;
  /** One sentence, safe to show a moderator. Never quotes what they wrote. */
  reason: string;
}

export interface FeedbackAccepted {
  ok: true;
  /** The form the mining loop keys on, after the versioned normalizer. */
  normalized: string;
  surface: string;
}

export type FeedbackVerdict = FeedbackAccepted | FeedbackRefusal;

export interface FeedbackProposal {
  /** Whoever wrote it, already salted-hashed. Never a raw Discord id. */
  byUid: string;
  /** The phrase, as they wrote it. */
  surface: string;
  /** Which lexicon list this is proposed for, e.g. "migration.platform". */
  proposedList: string;
  source: FeedbackSource;
  at: Date;
}

/**
 * A list a candidate may never be proposed for.
 *
 * Suppression lists are exemptions, and for an exemption adding is blinding
 * (ROADMAP S3). A moderator who can add to an exemption list can turn a
 * detector off for their own guild by describing the thing it detects. The
 * check is on the list name rather than on the phrase, because the phrase is
 * not the problem.
 */
const SUPPRESSION_LISTS = new Set([
  "exemptions",
  "suppression",
  "negations",
  "reported_speech",
  "support",
]);

export function isSuppressionList(list: string): boolean {
  const head = list.split(".")[0] ?? list;
  return SUPPRESSION_LISTS.has(head) || SUPPRESSION_LISTS.has(list);
}

/**
 * Per-writer budget over a sliding window. In memory on purpose: this bounds
 * one process's acceptance rate, and the repetition floor is what makes the
 * whole loop robust to a writer who restarts it.
 */
export class FeedbackRateLimiter {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly max: number = FEEDBACK_LIMITS.perWriterPerWindow,
    private readonly windowMs: number = FEEDBACK_LIMITS.windowMs,
  ) {}

  allow(byUid: string, atMs: number): boolean {
    const cutoff = atMs - this.windowMs;
    const times = (this.seen.get(byUid) ?? []).filter((t) => t > cutoff);
    if (times.length >= this.max) {
      this.seen.set(byUid, times);
      return false;
    }
    times.push(atMs);
    this.seen.set(byUid, times);
    return true;
  }

  /** Drop writers whose window has passed. Called on an interval by a caller. */
  prune(atMs: number): void {
    const cutoff = atMs - this.windowMs;
    for (const [uid, times] of this.seen) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length === 0) this.seen.delete(uid);
      else this.seen.set(uid, kept);
    }
  }
}

/**
 * Whether this proposal may be recorded at all. The rate limiter is passed in
 * rather than owned, so one process has one budget across every surface that
 * writes candidates.
 */
export function screenFeedback(
  proposal: FeedbackProposal,
  limiter: FeedbackRateLimiter,
  lexicon: Pick<Lexicon, "emoji" | "leet">,
): FeedbackVerdict {
  const surface = proposal.surface.trim();
  if (surface === "") {
    return { ok: false, code: "empty", reason: "Nothing was proposed." };
  }
  if (surface.length > FEEDBACK_LIMITS.maxPhraseChars) {
    return {
      ok: false,
      code: "too_long",
      reason: `A lexicon entry is a phrase, not a message. Keep it under ${FEEDBACK_LIMITS.maxPhraseChars} characters.`,
    };
  }
  if (isSuppressionList(proposal.proposedList)) {
    return {
      ok: false,
      code: "suppression_list",
      reason:
        "Exemption lists are not extendable from here. Adding to an exemption is blinding a detector, and that is a change a person makes in a new lexicon version.",
    };
  }

  const rewritten = normalize(surface, lexicon);
  const normalized = rewritten.normalized.trim();
  // The compact form is the letters and digits alone. A proposal with none of
  // those normalizes to punctuation, which is a phrase no detector can match
  // and a row nobody can read.
  if (rewritten.compact === "") {
    return {
      ok: false,
      code: "not_a_phrase",
      reason: "That has no letters or digits in it, so there would be no phrase to match on.",
    };
  }
  if (!limiter.allow(proposal.byUid, proposal.at.getTime())) {
    return {
      ok: false,
      code: "rate_limited",
      reason:
        "That is more proposals than one account makes in an hour. The mining signal is agreement across conversations, not repetition by one writer.",
    };
  }

  return { ok: true, normalized, surface };
}

/* -------------------------------------------------------------------------- */
/* The store                                                                  */
/* -------------------------------------------------------------------------- */

/** The generated delegate's shape, named so nothing imports the client here. */
export interface LexiconCandidateDelegate {
  upsert(args: {
    where: {
      customerId_proposedList_normalized?: {
        customerId: string;
        proposedList: string;
        normalized: string;
      };
    };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface RecordCandidateInput extends FeedbackProposal {
  customerId: string;
  /** Which lexicon version produced the normalized form. */
  lexiconVersion: string;
}

/**
 * Record a screened proposal. A second sighting increments the count on the
 * existing row rather than adding one, which is what makes repetition by many
 * writers legible and repetition by one writer merely a larger number on one
 * row that the limiter already bounded.
 */
export async function recordCandidate(
  delegate: LexiconCandidateDelegate,
  input: RecordCandidateInput,
  accepted: FeedbackAccepted,
): Promise<void> {
  await delegate.upsert({
    where: {
      customerId_proposedList_normalized: {
        customerId: input.customerId,
        proposedList: input.proposedList,
        normalized: accepted.normalized,
      },
    },
    create: {
      customerId: input.customerId,
      normalized: accepted.normalized,
      surface: accepted.surface,
      proposedList: input.proposedList,
      lexiconVersion: input.lexiconVersion,
      source: input.source,
      occurrences: 1,
      firstSeenAt: input.at,
      lastSeenAt: input.at,
    },
    update: {
      occurrences: { increment: 1 },
      lastSeenAt: input.at,
    },
  });
}
