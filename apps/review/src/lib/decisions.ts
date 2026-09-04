/**
 * The one code path that records a reviewer decision.
 *
 * Two rules are enforced here rather than described anywhere else.
 *
 * Rule 6: the model tops out at T2 and only a human produces T3. This module is
 * the only place in the repository that can write tier T3, and it will only do
 * it for a second reviewer's concurrence on a proposal somebody else made. A
 * proposal on its own writes no tier at all.
 *
 * Rule 5: nothing this module emits labels a person. Every string it writes
 * into a row, a payload or a return value goes through the wording guard first.
 *
 * The schema this writes against is the one in packages/schema/prisma. Three
 * gaps from DESIGN-UI 13.2 are not migrated yet: Review has no state column, no
 * parentReviewId and one nullable reason string rather than a code plus three
 * notes. Until they land, the code goes in Review.reason and the notes, the
 * state and the parent ride in the audit payload, which is append-only and
 * hash-chained, so nothing is lost. It is not queryable, which is the cost.
 */

import {
  escalateRetention,
  expiresAt,
  retentionForTier,
  type RetentionClass,
  type ReviewDecision,
  type Tier,
} from "@guardian/schema";
import { compose } from "./compose";
import {
  UNDO_WINDOW_MS,
  reasonByCode,
  reasonLabel,
  type ProposeAnnotation,
  type Reason,
  type ReasonCode,
} from "./reasons";
import { getPrisma, isMockMode } from "./db";
import { getMockData } from "./mock/fixtures";
import { appendAudit, appendAuditInTransaction } from "./data/audit";
import type { Session } from "./auth";
import type { ReviewRecord } from "./data/types";

/* -------------------------------------------------------------------------- */
/* Reason taxonomy (DESIGN-UI 9)                                              */
/* -------------------------------------------------------------------------- */

/**
 * The taxonomy itself lives in ./reasons so the reason listbox, the propose
 * dialog and the undo bar can import it without dragging this module, Prisma
 * and the schema barrel's disk reads into the browser bundle. It is re-exported
 * here because "@/lib/decisions" is the name every server caller already uses.
 */
export {
  PROPOSE_ANNOTATIONS,
  REASONS,
  UNDO_WINDOW_MS,
  reasonLabel,
  reasonsFor,
  type ProposeAnnotation,
  type Reason,
  type ReasonCode,
} from "./reasons";

/* -------------------------------------------------------------------------- */
/* Recording a decision                                                        */
/* -------------------------------------------------------------------------- */

export interface DecisionNotes {
  /** What in the timeline supports this. */
  timeline?: string;
  /** What context was gathered outside the timeline. */
  outsideContext?: string;
  /** What the reviewer recommends the operator do. Survives into the report. */
  recommendation?: string;
}

/**
 * Present only on a second reviewer's concurrence, which is the single route to
 * T3. The proposer is carried so the guard can refuse a reviewer concurring
 * with themselves.
 */
export interface Concurrence {
  proposalReviewId: string;
  proposerReviewerId: string;
  upheld: boolean;
}

export interface RecordDecisionInput {
  session: Session;
  pairId: string;
  decision: ReviewDecision;
  reasonCode: ReasonCode;
  reasonDetail?: Record<string, unknown>;
  notes?: DecisionNotes;
  minutesSpent?: number;
  interrupted?: boolean;
  /** How many excerpts this reviewer marked as read. Never a pace value. */
  viewedExcerptCount?: number;
  annotations?: ProposeAnnotation[];
  /**
   * The change-origin attestation. Recorded on every proposal, because a
   * decision reached at the direction of a law enforcement request is the
   * government-agent argument (US v. Rosenow, 9th Cir. 2022).
   */
  lawEnforcementRequested?: boolean;
  concurrence?: Concurrence;
}

export type ReviewState = "recorded" | "proposed" | "upheld" | "overturned";

export interface DecisionResult {
  review: ReviewRecord;
  state: ReviewState;
  resultTier: Tier;
  auditSeq: number;
  /** One sentence about what happened, already past the wording guard. */
  summary: string;
}

export class DecisionRefused extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DecisionRefused";
  }
}

/**
 * What tier a decision produces. The only branch that can return T3 is an
 * upheld concurrence on somebody else's proposal.
 */
export function resolveResultTier(
  decision: ReviewDecision,
  modelTier: Tier,
  concurrence?: Concurrence,
): { tier: Tier; state: ReviewState } {
  switch (decision) {
    case "dismiss":
      return { tier: "T0", state: "recorded" };
    case "watch":
      return { tier: "T1", state: "recorded" };
    case "confirm":
      return { tier: "T2", state: "recorded" };
    case "report":
      if (!concurrence) {
        // A proposal writes no tier. The case stays where the model left it.
        return { tier: modelTier === "T3" ? "T2" : modelTier, state: "proposed" };
      }
      return concurrence.upheld
        ? { tier: "T3", state: "upheld" }
        : { tier: "T2", state: "overturned" };
  }
}

function assertT3Allowed(
  resultTier: Tier,
  decision: ReviewDecision,
  concurrence: Concurrence | undefined,
  session: Session,
): void {
  if (resultTier !== "T3") return;
  if (decision !== "confirm" && decision !== "report") {
    throw new DecisionRefused(
      "t3_requires_confirm_or_report",
      "Tier T3 requires a confirm or a report decision. Nothing else may produce it.",
    );
  }
  if (!concurrence || !concurrence.upheld) {
    throw new DecisionRefused(
      "t3_requires_concurrence",
      "Tier T3 requires a second reviewer's concurrence on a proposal. A proposal alone writes no tier.",
    );
  }
  if (concurrence.proposerReviewerId === session.reviewerId) {
    throw new DecisionRefused(
      "t3_requires_second_person",
      "The second reviewer cannot be the reviewer who proposed the report.",
    );
  }
}

/**
 * A confirm and a proposal both claim a person read the evidence. The browser
 * counts what it rendered, which is a claim the server cannot check, so the
 * server checks its own record instead: markExcerptsViewed is the only thing
 * that sets humanViewedAt, and a pair without it has had no excerpt rendered to
 * anybody.
 */
function assertExcerptRead(decision: ReviewDecision, humanViewedAt: Date | null): void {
  if (decision !== "confirm" && decision !== "report") return;
  if (humanViewedAt !== null) return;
  throw new DecisionRefused(
    "excerpt_not_read",
    "No excerpt on this case has been rendered to a person yet. Open one in the timeline before confirming or proposing.",
  );
}

function summaryFor(state: ReviewState, resultTier: Tier, reasonCode: string): string {
  const label = reasonLabel(reasonCode);
  switch (state) {
    case "proposed":
      return compose(
        "decisions.summary.proposed",
        `Proposed for report: ${label}. This creates no tier. A second reviewer decides.`,
      );
    case "upheld":
      return compose(
        "decisions.summary.upheld",
        `The second reviewer upheld the proposal. Tier T3, and a report is drafted for the operator to file.`,
      );
    case "overturned":
      return compose(
        "decisions.summary.overturned",
        "Overturned on review. The pair returns to tier T2 and a QA event is recorded.",
      );
    default:
      return compose(
        "decisions.summary.recorded",
        `Recorded: ${label}. The pair is now tier ${resultTier}. It does not clear anyone of anything.`,
      );
  }
}

function validate(input: RecordDecisionInput): Reason {
  const reason = reasonByCode(input.reasonCode);
  if (!reason) {
    throw new DecisionRefused("unknown_reason", `No reason with code ${input.reasonCode}.`);
  }
  if (reason.decision !== input.decision) {
    throw new DecisionRefused(
      "reason_decision_mismatch",
      `Reason ${reason.code} belongs to the ${reason.decision} set, not to ${input.decision}.`,
    );
  }
  if (
    (input.decision === "confirm" || input.decision === "report") &&
    !input.notes?.timeline?.trim()
  ) {
    throw new DecisionRefused(
      "note_required",
      "Confirm and propose need the timeline note. Say what in the timeline supports this.",
    );
  }
  if (input.minutesSpent !== undefined && input.minutesSpent < 0) {
    throw new DecisionRefused("bad_minutes", "Minutes cannot be negative.");
  }
  return reason;
}

/**
 * Records one decision: a Review row, the pair's tier and resolvedAt, a
 * retention escalation, and one review.decision entry on the audit chain.
 *
 * All four are one transaction. Appending after the row committed left the
 * mirror-image failure open: the decision lands, the append throws, the
 * reviewer is told nothing changed, and the pair sits at its new tier with no
 * entry on the chain. A decision that may or may not have landed is the one
 * error this app cannot ship, so either everything commits or nothing does.
 */
export async function recordDecision(input: RecordDecisionInput): Promise<DecisionResult> {
  const reason = validate(input);
  const { session, pairId, decision } = input;

  if (isMockMode()) {
    const data = await getMockData();
    const pair = data.pairs.find(
      (p) => p.queue.pairId === pairId && p.queue.customerId === session.customerId,
    );
    if (!pair) throw new DecisionRefused("not_found", "This case is not in your queue.");
    if (decision === "report" && pair.queue.soleAutomatedBasis && !input.concurrence) {
      throw new DecisionRefused(
        "sole_automated_basis",
        "This tier rests on the actor score alone, with no conversational fact on the pair. A report cannot be proposed from it.",
      );
    }

    assertExcerptRead(decision, pair.humanViewedAt);

    const modelTier = pair.queue.tier;
    const { tier: resultTier, state } = resolveResultTier(decision, modelTier, input.concurrence);
    assertT3Allowed(resultTier, decision, input.concurrence, session);

    const review: ReviewRecord = {
      id: `rvw_${pairId}_${data.reviews.length + 1}`,
      pairId,
      shortId: pairId.slice(-4),
      reviewerId: session.reviewerId,
      reviewerName: session.displayName,
      decision,
      reasonCode: reason.code,
      reasonLabel: reason.label,
      modelTier,
      resultTier,
      minutesSpent: input.minutesSpent ?? null,
      viewedExcerptCount: input.viewedExcerptCount ?? null,
      notes: {
        timeline: input.notes?.timeline ?? null,
        outsideContext: input.notes?.outsideContext ?? null,
        recommendation: input.notes?.recommendation ?? null,
      },
      parentReviewId: input.concurrence?.proposalReviewId ?? null,
      createdAt: new Date(),
      retentionDeadline: expiresAt(retentionForTier(resultTier)),
      auditSeq: null,
    };

    if (state !== "proposed") {
      pair.queue.tier = resultTier;
      pair.queue.resolvedAt = new Date();
    }
    data.reviews.unshift(review);

    const { seq } = await appendAudit(session, {
      kind: "review.decision",
      payload: auditPayload(input, reason, modelTier, resultTier, state),
    });
    review.auditSeq = seq;

    return { review, state, resultTier, auditSeq: seq, summary: summaryFor(state, resultTier, reason.code) };
  }

  const prisma = await getPrisma();
  const pair = await prisma.pair.findFirst({
    where: { id: pairId, customerId: session.customerId },
    select: {
      id: true,
      tier: true,
      retention: true,
      expiresAt: true,
      humanViewedAt: true,
      soleAutomatedBasis: true,
    },
  });
  if (!pair) throw new DecisionRefused("not_found", "This case is not in your queue.");
  if (decision === "report" && pair.soleAutomatedBasis && !input.concurrence) {
    throw new DecisionRefused(
      "sole_automated_basis",
      "This tier rests on the actor score alone, with no conversational fact on the pair. A report cannot be proposed from it.",
    );
  }
  assertExcerptRead(decision, pair.humanViewedAt);

  const modelTier = pair.tier as Tier;
  const { tier: resultTier, state } = resolveResultTier(decision, modelTier, input.concurrence);
  assertT3Allowed(resultTier, decision, input.concurrence, session);

  const currentRetention = pair.retention as RetentionClass;
  const retention: RetentionClass = escalateRetention(
    currentRetention,
    retentionForTier(resultTier),
  );
  /**
   * The deletion clock moves only when the class actually escalates.
   *
   * expiresAt() anchors on now, so rewriting it on every decision restarted the
   * countdown: a T1 pair one day from deletion, dismissed, was kept another
   * thirty days because somebody decided it was nothing. A dismissal must not
   * extend retention, and repeated decisions must not keep a pair alive.
   */
  const escalated = retention !== currentRetention;
  const retentionDeadline = escalated ? expiresAt(retention) : pair.expiresAt;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.review.create({
      data: {
        pairId,
        reviewerId: session.reviewerId,
        decision,
        reason: reason.code,
        modelTier,
        resultTier,
        minutesSpent: input.minutesSpent ?? null,
        feedbackSource: "reviewer",
        viewedExcerptCount: input.viewedExcerptCount ?? null,
      },
    });
    if (state !== "proposed") {
      await tx.pair.update({
        where: { id: pairId },
        data: {
          tier: resultTier,
          resolvedAt: new Date(),
          retention,
          ...(escalated ? { expiresAt: retentionDeadline } : {}),
        },
      });
    }
    const audit = await appendAuditInTransaction(session, tx as never, {
      kind: "review.decision",
      payload: {
        ...auditPayload(input, reason, modelTier, resultTier, state),
        reviewId: row.id,
      },
    });
    return { row, seq: audit.seq };
  });
  const { row: createdRow, seq } = created;

  return {
    review: {
      id: createdRow.id,
      pairId,
      shortId: pairId.slice(-4),
      reviewerId: session.reviewerId,
      reviewerName: session.displayName,
      decision,
      reasonCode: reason.code,
      reasonLabel: reason.label,
      modelTier,
      resultTier,
      minutesSpent: createdRow.minutesSpent,
      viewedExcerptCount: createdRow.viewedExcerptCount,
      notes: {
        timeline: input.notes?.timeline ?? null,
        outsideContext: input.notes?.outsideContext ?? null,
        recommendation: input.notes?.recommendation ?? null,
      },
      parentReviewId: input.concurrence?.proposalReviewId ?? null,
      createdAt: createdRow.createdAt,
      retentionDeadline,
      auditSeq: seq,
    },
    state,
    resultTier,
    auditSeq: seq,
    summary: summaryFor(state, resultTier, reason.code),
  };
}

function auditPayload(
  input: RecordDecisionInput,
  reason: Reason,
  modelTier: Tier,
  resultTier: Tier,
  state: ReviewState,
): Record<string, unknown> {
  return {
    pairId: input.pairId,
    reviewerId: input.session.reviewerId,
    decision: input.decision,
    state,
    reasonCode: reason.code,
    reasonDetail: input.reasonDetail ?? null,
    annotations: input.annotations ?? [],
    modelTier,
    resultTier,
    minutesSpent: input.minutesSpent ?? null,
    interrupted: input.interrupted ?? false,
    viewedExcerptCount: input.viewedExcerptCount ?? null,
    notes: {
      timeline: input.notes?.timeline ?? null,
      outsideContext: input.notes?.outsideContext ?? null,
      recommendation: input.notes?.recommendation ?? null,
    },
    changeOrigin: {
      origin: "guardian",
      lawEnforcementRequested: input.lawEnforcementRequested ?? false,
    },
    parentReviewId: input.concurrence?.proposalReviewId ?? null,
  };
}

/**
 * Undo, within the 60 second window. Emits a compensating audit entry and never
 * mutates the original row: history is additive, and a defence lawyer reading a
 * mutated decision log gets a free cross-examination.
 *
 * The tier restored is the one recorded on the review being compensated, not a
 * tier the caller chose. A client-supplied tier was a tier write with no Review
 * row behind it, no reason code and no place in the taxonomy: a pair the model
 * scored T0 could be undone into T2, back into the queue with a four hour SLA
 * and into the dashboard's tier rates.
 */
export async function undoDecision(
  session: Session,
  reviewId: string,
): Promise<{ auditSeq: number; restoredTier: Tier }> {
  if (isMockMode()) {
    const data = await getMockData();
    const review = data.reviews.find(
      (r) => r.id === reviewId && r.reviewerId === session.reviewerId,
    );
    if (!review) throw new DecisionRefused("not_found", "That decision is not in your log.");
    assertUndoAllowed(review.modelTier, review.createdAt);
    const pair = data.pairs.find((p) => p.queue.pairId === review.pairId);
    if (pair) {
      pair.queue.tier = review.modelTier;
      pair.queue.resolvedAt = null;
    }
    const { seq } = await appendAudit(session, {
      kind: "review.decision",
      payload: {
        compensates: reviewId,
        pairId: review.pairId,
        restoredTier: review.modelTier,
      },
    });
    return { auditSeq: seq, restoredTier: review.modelTier };
  }

  const prisma = await getPrisma();
  const review = await prisma.review.findFirst({
    where: { id: reviewId, reviewerId: session.reviewerId, pair: { customerId: session.customerId } },
  });
  if (!review) throw new DecisionRefused("not_found", "That decision is not in your log.");
  const restoreTier = review.modelTier as Tier;
  assertUndoAllowed(restoreTier, review.createdAt);

  const { seq } = await prisma.$transaction(async (tx) => {
    await tx.pair.updateMany({
      where: { id: review.pairId, customerId: session.customerId },
      data: { tier: restoreTier, resolvedAt: null },
    });
    return appendAuditInTransaction(session, tx as never, {
      kind: "review.decision",
      payload: { compensates: reviewId, pairId: review.pairId, restoredTier: restoreTier },
    });
  });
  return { auditSeq: seq, restoredTier: restoreTier };
}

/** The two things that close an undo: the tier it would restore, and the clock. */
function assertUndoAllowed(restoreTier: Tier, decidedAt: Date): void {
  if (restoreTier === "T3") {
    throw new DecisionRefused(
      "cannot_restore_t3",
      "Undo cannot restore tier T3. A reported case is retracted, which is a different act.",
    );
  }
  if (Date.now() - decidedAt.getTime() > UNDO_WINDOW_MS) {
    throw new DecisionRefused(
      "undo_window_closed",
      "The undo window has closed. Reopen the decision from your decision log instead.",
    );
  }
}
