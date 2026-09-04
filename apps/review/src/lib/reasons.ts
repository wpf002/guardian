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
}

const RAW_REASONS: Reason[] = [
  // dismiss
  {
    code: "dismiss.same_band_no_gap",
    decision: "dismiss",
    label: "Same band, no gap",
    definition:
      "Both accounts sit in the same band. The age gap that drove the rank is not there.",
  },
  {
    code: "dismiss.teen_romance_lawful",
    decision: "dismiss",
    label: "Teen romance, lawful",
    definition:
      "Two accounts both in 13+ bands with no gap that makes it unlawful. The largest false-positive class, and the eval suite has a control for it.",
  },
  {
    code: "dismiss.economy_transaction",
    decision: "dismiss",
    label: "In-game economy exchange",
    definition: "Robux, skins, a giveaway. The economic-bait detector fires on the same vocabulary.",
  },
  {
    code: "dismiss.roleplay_fiction",
    decision: "dismiss",
    label: "Roleplay or fiction",
    definition: "In-character content. Fiction, tabletop, collaborative writing.",
  },
  {
    code: "dismiss.both_adult_band",
    decision: "dismiss",
    label: "Both accounts in adult bands",
    definition: "Both accounts sit in adult bands.",
  },
  {
    code: "dismiss.vigilante_roleplay",
    decision: "dismiss",
    label: "Decoy or catcher roleplay",
    definition:
      "One or both accounts are roleplaying a decoy. Guardian's bot will be installed on servers whose members do this, and it is a real false-positive source.",
  },
  {
    code: "dismiss.trusted_connection",
    decision: "dismiss",
    label: "Known relationship",
    definition: "Parent, guardian, sibling, or a connection the operator can vouch for.",
  },
  {
    code: "dismiss.staff_in_role",
    decision: "dismiss",
    label: "Moderator in role",
    definition: "Fan-out on a moderator account is the job, not the signal.",
  },
  {
    code: "dismiss.lexicon_false_positive",
    decision: "dismiss",
    label: "Lexicon false positive",
    definition:
      "The lexicon read a token wrong. Writes into the mining loop with feedbackSource reviewer.",
    detail: "token",
  },
  {
    code: "dismiss.duplicate_of",
    decision: "dismiss",
    label: "Duplicate of another case",
    definition: "The same conversation as another open case.",
    detail: "case_id",
  },

  // watch
  {
    code: "watch.one_signal_no_progression",
    decision: "watch",
    label: "One signal, no progression",
    definition: "One critical signal fired and nothing progressed.",
  },
  {
    code: "watch.progression_gap_unconfirmed",
    decision: "watch",
    label: "Progression, band unconfirmed",
    definition: "The progression is there and the age gap rests on an unverified band.",
  },
  {
    code: "watch.insufficient_context",
    decision: "watch",
    label: "Not enough context",
    definition: "Too few messages in the window to tell.",
  },
  {
    code: "watch.awaiting_band_verification",
    decision: "watch",
    label: "Waiting on band verification",
    definition: "Waiting on the operator to verify a band.",
  },

  // confirm, reviewer-confirmed T2
  {
    code: "confirm.progression_pattern",
    decision: "confirm",
    label: "Ordered progression pattern",
    definition: "An ordered stage progression. Carries the from and to stage numbers.",
    detail: "stages",
  },
  {
    code: "confirm.migration_ask_with_gap",
    decision: "confirm",
    label: "Migration ask with age gap",
    definition: "A request to continue on another app, with an age gap.",
  },
  {
    code: "confirm.economic_bait_adult_to_minor",
    decision: "confirm",
    label: "Economic bait across an age gap",
    definition: "Money, goods or in-game currency offered across an age gap.",
  },
  {
    code: "confirm.coercion_nonfinancial",
    decision: "confirm",
    label: "Coercion, non-financial",
    definition: "Coercion without a payment demand: self-harm, marks, proof.",
  },
  {
    code: "confirm.actor_pattern_across_pairs",
    decision: "confirm",
    label: "Pattern across pairs",
    definition: "The pattern is across pairs rather than inside one.",
  },

  // propose T3, one to one with CyberTipline incident types
  {
    code: "propose.online_enticement",
    decision: "report",
    label: "Online enticement of a child for sexual acts",
    definition: "The CyberTipline incident type of the same name.",
  },
  {
    code: "propose.child_sex_trafficking",
    decision: "report",
    label: "Child sex trafficking",
    definition: "The CyberTipline incident type of the same name.",
  },
  {
    code: "propose.unsolicited_obscene_material",
    decision: "report",
    label: "Unsolicited obscene material sent to a child",
    definition: "The CyberTipline incident type of the same name.",
  },
  {
    code: "propose.csam_operator_verdict",
    decision: "report",
    label: "Operator hash verdict",
    definition:
      "The operator's own hash verdict. The operator is the viewer, never Guardian and never the reviewer.",
  },
  {
    code: "propose.child_sexual_molestation",
    decision: "report",
    label: "Child sexual molestation",
    definition: "The CyberTipline incident type of the same name.",
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
  return REASONS.filter((r) => r.decision === decision);
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
