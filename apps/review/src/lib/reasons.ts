/**
 * The parts of the decision path a browser is allowed to know about.
 *
 * The reason taxonomy, the propose annotations and the undo window are read by
 * client components (the reason listbox, the propose dialog, the undo bar).
 * lib/decisions.ts, which owns the write, reaches Prisma, the audit chain and
 * the full @guardian/schema barrel, and that barrel loads the lexicon from disk
 * at import. Pulling it into a client bundle asks the browser for node:fs and
 * the build fails. So the data lives here, and lib/decisions.ts re-exports it:
 * server code keeps importing "@/lib/decisions" and sees no change.
 *
 * Nothing in this module writes a tier. Rule 6 lives next door.
 */

import type { ReviewDecision } from "@guardian/schema";
import { assertCopy } from "./compose";

/** Undo, within the 60 second window. Read by the undo bar and by the write. */
export const UNDO_WINDOW_MS = 60_000;

/* -------------------------------------------------------------------------- */
/* Reason taxonomy (DESIGN-UI 9)                                              */
/* -------------------------------------------------------------------------- */

/**
 * Why a reviewer decided what they decided. Stored as the code, displayed as
 * the label. The code is the stable thing: labels get rewritten, and the fusion
 * feedback and the calibration numbers have to stay comparable across a
 * rewording.
 */
export interface Reason {
  code: string;
  decision: ReviewDecision;
  label: string;
  definition: string;
  /** Reasons that carry an operand the caller must collect. */
  detail?: "token" | "case_id" | "stages" | "free_text";
  /**
   * Set on the reasons a second reviewer picks from. They ride on decision
   * "report" like a proposal does, because a concurrence is an answer to one,
   * but they must never appear in the propose list: the first reviewer is
   * choosing a CyberTipline incident type and the second is saying whether the
   * evidence carries it. `reasonsFor` filters them out for that reason.
   */
  concurrence?: "uphold" | "overturn";
}

const RAW_REASONS: Reason[] = [
  // dismiss
  {
    code: "dismiss.same_band_no_gap",
    decision: "dismiss",
    label: "They're about the same age",
    definition: "Both accounts are about the same age.",
  },
  {
    code: "dismiss.teen_romance_lawful",
    decision: "dismiss",
    label: "Two teens, nothing unlawful",
    definition: "Both are teenagers, and nothing here is against the law.",
  },
  {
    code: "dismiss.economy_transaction",
    decision: "dismiss",
    label: "Normal in-game trading",
    definition: "Robux, skins or a giveaway, and nothing more.",
  },
  {
    code: "dismiss.roleplay_fiction",
    decision: "dismiss",
    label: "Roleplay or a story",
    definition: "They were playing characters or writing a story together.",
  },
  {
    code: "dismiss.both_adult_band",
    decision: "dismiss",
    label: "Both are adults",
    definition: "Both accounts are 18 or over.",
  },
  {
    code: "dismiss.vigilante_roleplay",
    decision: "dismiss",
    label: "Someone posing as a kid to catch people",
    definition: "One of them was pretending to be a child to bait people.",
  },
  {
    code: "dismiss.trusted_connection",
    decision: "dismiss",
    label: "They know each other",
    definition: "Family, or someone your team can vouch for.",
  },
  {
    code: "dismiss.staff_in_role",
    decision: "dismiss",
    label: "A moderator doing their job",
    definition: "Moderators talk to lots of members.",
  },
  {
    code: "dismiss.lexicon_false_positive",
    decision: "dismiss",
    label: "Guardian misread a word",
    definition: "A word or emoji was read the wrong way.",
    detail: "token",
  },
  {
    code: "dismiss.duplicate_of",
    decision: "dismiss",
    label: "Same as another conversation",
    definition: "This conversation is already open somewhere else.",
    detail: "case_id",
  },

  // watch
  {
    code: "watch.one_signal_no_progression",
    decision: "watch",
    label: "One worrying message, nothing more",
    definition: "One message stood out, and nothing followed it.",
  },
  {
    code: "watch.progression_gap_unconfirmed",
    decision: "watch",
    label: "Worrying, but their ages aren't confirmed",
    definition: "It's heading somewhere, but nobody has confirmed how old they are.",
  },
  {
    code: "watch.insufficient_context",
    decision: "watch",
    label: "Not enough to tell",
    definition: "Too few messages to know.",
  },
  {
    code: "watch.awaiting_band_verification",
    decision: "watch",
    label: "Checking someone's age",
    definition: "Waiting for your team to confirm how old someone is.",
  },

  // confirm, reviewer-confirmed T2
  {
    code: "confirm.progression_pattern",
    decision: "confirm",
    label: "Following the usual grooming steps",
    definition: "The messages move through the steps grooming usually takes, in order.",
    detail: "stages",
  },
  {
    code: "confirm.migration_ask_with_gap",
    decision: "confirm",
    label: "Asked a younger account to move apps",
    definition: "An older account asked a younger one to keep talking somewhere else.",
  },
  {
    code: "confirm.economic_bait_adult_to_minor",
    decision: "confirm",
    label: "Offered a younger account gifts or money",
    definition: "Money, gifts or in-game currency offered to a younger account.",
  },
  {
    code: "confirm.coercion_nonfinancial",
    decision: "confirm",
    label: "Pressured or threatened them",
    definition: "Pressure without asking for money, like demanding self-harm or proof.",
  },
  {
    code: "confirm.actor_pattern_across_pairs",
    decision: "confirm",
    label: "Doing this with other kids too",
    definition: "The same account is doing this in other conversations.",
  },

  // propose T3, one to one with CyberTipline incident types
  {
    code: "propose.online_enticement",
    decision: "report",
    label: "Online enticement of a child for sexual acts",
    definition: "Contacting a child online to get them to do something sexual.",
  },
  {
    code: "propose.child_sex_trafficking",
    decision: "report",
    label: "Child sex trafficking",
    definition: "Buying, selling or trading sex with a child.",
  },
  {
    code: "propose.unsolicited_obscene_material",
    decision: "report",
    label: "Unsolicited obscene material sent to a child",
    definition: "Sending sexual images or messages to a child who didn't ask for them.",
  },
  {
    code: "propose.csam_operator_verdict",
    decision: "report",
    label: "Your scanner matched a known abuse image",
    definition: "Your own scanner flagged an image. Your team saw it, not Guardian.",
  },
  {
    code: "propose.child_sexual_molestation",
    decision: "report",
    label: "Child sexual molestation",
    definition: "Sexual abuse of a child.",
  },

  // A second reviewer answering a proposal. Uphold writes T3 and starts the
  // one-year hold; overturn returns the pair to T2 and writes no report.
  {
    code: "uphold.independent_agreement",
    decision: "report",
    concurrence: "uphold",
    label: "I read it, and I agree",
    definition: "I read the conversation myself and came to the same answer.",
  },
  {
    code: "uphold.critical_signal_stands",
    decision: "report",
    concurrence: "uphold",
    label: "The worrying message is really there",
    definition: "The message that flagged this says what Guardian thought it said.",
  },
  {
    code: "overturn.evidence_does_not_support",
    decision: "report",
    concurrence: "overturn",
    label: "The conversation doesn't show it",
    definition: "What I read doesn't match what the report would say.",
  },
  {
    code: "overturn.band_unverified",
    decision: "report",
    concurrence: "overturn",
    label: "We don't know their real ages",
    definition: "Reporting depends on how old they are, and nobody has confirmed that.",
  },
  {
    code: "overturn.lawful_relationship",
    decision: "report",
    concurrence: "overturn",
    label: "Nothing unlawful between them",
    definition: "Their ages don't make this against the law.",
  },
  {
    code: "overturn.wrong_incident_type",
    decision: "report",
    concurrence: "overturn",
    label: "Wrong kind of report",
    definition: "Something is here, but it should be reported as a different kind.",
  },
];

/** Labels and definitions are hand-written literals, so they throw at import. */
export const REASONS: Reason[] = RAW_REASONS.map((reason) => ({
  ...reason,
  label: assertCopy(`decisions.reason.${reason.code}.label`, reason.label),
  definition: assertCopy(`decisions.reason.${reason.code}.definition`, reason.definition),
}));

export type ReasonCode = string;

const REASON_BY_CODE = new Map(REASONS.map((r) => [r.code, r]));

export function reasonsFor(decision: ReviewDecision): Reason[] {
  return REASONS.filter((r) => r.decision === decision && r.concurrence === undefined);
}

/** What a second reviewer picks from, on one side of the answer or the other. */
export function concurrenceReasons(side: "uphold" | "overturn"): Reason[] {
  return REASONS.filter((r) => r.concurrence === side);
}

/** The write path validates a posted code against this. */
export function reasonByCode(code: string): Reason | undefined {
  return REASON_BY_CODE.get(code);
}

export function reasonLabel(code: string): string {
  return REASON_BY_CODE.get(code)?.label ?? "reason not recorded";
}

/**
 * Two annotations rather than reasons, because either can sit alongside any
 * propose reason. Imminent danger requires a free-text reason string.
 */
export const PROPOSE_ANNOTATIONS = {
  SEXTORTION_PATTERN: "annotation.sextortion_pattern",
  IMMINENT_DANGER: "annotation.imminent_danger",
} as const;
export type ProposeAnnotation =
  (typeof PROPOSE_ANNOTATIONS)[keyof typeof PROPOSE_ANNOTATIONS];
