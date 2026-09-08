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

import { createHash } from "node:crypto";
import {
  escalateRetention,
  expiresAt,
  findAccusations,
  looksLikeMediaBytes,
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
import { appendAudit, appendAuditInTransaction, hasReadEvidence } from "./data/audit";
import type { Session } from "./session";
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
  priorTier: Tier,
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
        return { tier: priorTier === "T3" ? "T2" : priorTier, state: "proposed" };
      }
      return concurrence.upheld
        ? { tier: "T3", state: "upheld" }
        : { tier: "T2", state: "overturned" };
  }
}

/**
 * A pair that two reviewers put at T3 is not undone by one.
 *
 * The reopen panel refuses this in the browser and the server action had no
 * equivalent, so a session that had proposed nothing and read nothing could
 * dismiss a reported case: one person removing a tier two people were required
 * to create, and the review row it wrote recorded that T3 in the column the
 * schema documented as the tier the model had assigned. The hash chain then
 * asserted the model reached T3, which is the one thing rule 6 says it cannot.
 * That column is `priorTier` now and says what it holds (ROADMAP S-9).
 *
 * Retracting a report is a real need and a different act. It is not this one,
 * and building it is a decision about who may do it, not a missing branch here.
 */
function assertNotOverwritingT3(currentTier: Tier, concurrence: Concurrence | undefined): void {
  if (currentTier !== "T3") return;
  if (concurrence) return;
  throw new DecisionRefused(
    "t3_already_recorded",
    "This case is at tier T3, which two reviewers produced. One reviewer does not undo it. Retracting a confirmed report is a separate act with its own record.",
  );
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

/**
 * The second reviewer has to have read the evidence themselves.
 *
 * `Pair.humanViewedAt` is set by whoever read first and never records who, so
 * on a concurrence it is already satisfied by the proposer: without this the
 * second reviewer could write T3 having opened nothing. Two people are required
 * on a T3 because two people are supposed to have looked, and a check that the
 * first person looked twice is not that.
 */
async function assertSecondReviewerRead(
  session: Session,
  pairId: string,
  concurrence: Concurrence | undefined,
): Promise<void> {
  if (!concurrence) return;
  if (await hasReadEvidence(session, pairId)) return;
  throw new DecisionRefused(
    "concurrence_without_own_read",
    "You have not opened an excerpt on this case. A concurrence is a second reading, so the timeline has to be rendered to you before you answer the proposal.",
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
  /*
   * The concurrence reasons ride on decision "report" because a concurrence is
   * an answer to a proposal, so the decision check above lets them through on a
   * proposal too. These two close that: a first reviewer cannot propose a
   * report whose stated reason is "same reading from the evidence", and a
   * second reviewer cannot uphold under an overturn reason.
   */
  if (reason.concurrence && !input.concurrence) {
    throw new DecisionRefused(
      "concurrence_reason_without_proposal",
      `Reason ${reason.code} is what a second reviewer picks when answering a proposal. A proposal states a CyberTipline incident type instead.`,
    );
  }
  if (input.concurrence && !reason.concurrence) {
    throw new DecisionRefused(
      "proposal_reason_on_concurrence",
      `Reason ${reason.code} states an incident type, which the proposal already did. A concurrence says whether the evidence carries it.`,
    );
  }
  if (input.concurrence && reason.concurrence !== (input.concurrence.upheld ? "uphold" : "overturn")) {
    throw new DecisionRefused(
      "concurrence_side_mismatch",
      `Reason ${reason.code} belongs to the ${reason.concurrence} set. It cannot carry the other answer.`,
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
  assertNotesAreFilable(input.notes);
  return reason;
}

/**
 * Two checks on the reviewer's own words, at the moment they are written.
 *
 * Reviewer notes are the one free-text channel into a CyberTipline filing that
 * never crosses the ingest edge: the recommendation note is copied verbatim into
 * the report narrative and into the submitted document. Both checks exist at the
 * report builder too, but refusing there means an already-recorded T3 cannot be
 * filed until somebody edits a note the console has no edit path for. So the
 * load-bearing check is this one, at write time, where the reviewer is still
 * looking at the field.
 *
 * Rule 1: a data URI or a long base64 run in a note is Guardian storing and
 * later transmitting bytes.
 * Rule 5: Guardian never labels a person, and a note saying one does becomes
 * Guardian's own speech the moment it is filed under the provider's name.
 */
function assertNotesAreFilable(notes: DecisionNotes | undefined): void {
  if (!notes) return;
  const fields: Array<[string, string | undefined]> = [
    ["the timeline note", notes.timeline],
    ["the outside-context note", notes.outsideContext],
    ["the recommendation note", notes.recommendation],
  ];
  for (const [label, value] of fields) {
    if (!value) continue;
    if (looksLikeMediaBytes(value)) {
      throw new DecisionRefused(
        "media_bytes_in_note",
        `${label} carries what looks like image or video data. Guardian records a sha256 and the operator's own scanner verdict and never the bytes, and this note travels into a CyberTipline report. Describe the file instead.`,
      );
    }
    const findings = findAccusations(value);
    const first = findings[0];
    if (first) {
      throw new DecisionRefused(
        "accusatory_note",
        `${label} says "${first.match}", which ${first.why}. This note is copied into the report Guardian files under the provider's name, and Guardian never labels a person. Instead: ${first.instead}.`,
      );
    }
  }
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
    await assertSecondReviewerRead(session, pairId, input.concurrence);
    assertProposalIsOpen(data.reviews, pairId, input.concurrence);

    const priorTier = pair.queue.tier;
    const modelTier = pair.modelTier;
    assertNotOverwritingT3(priorTier, input.concurrence);
    const { tier: resultTier, state } = resolveResultTier(decision, priorTier, input.concurrence);
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
      priorTier,
      modelTier,
      resultTier,
      minutesSpent: input.minutesSpent ?? null,
      viewedExcerptCount: input.viewedExcerptCount ?? null,
      notes: {
        timeline: input.notes?.timeline ?? null,
        outsideContext: input.notes?.outsideContext ?? null,
        recommendation: input.notes?.recommendation ?? null,
      },
      state,
      parentReviewId: input.concurrence?.proposalReviewId ?? null,
      createdAt: new Date(),
      retentionDeadline: expiresAt(retentionForTier(resultTier)),
      auditSeq: null,
    };

    if (input.concurrence) {
      const proposal = data.reviews.find((r) => r.id === input.concurrence!.proposalReviewId);
      // assertProposalIsOpen already refused an answered one; this closes it.
      if (proposal) proposal.state = state;
    }
    if (state !== "proposed") {
      pair.queue.tier = resultTier;
      pair.queue.resolvedAt = new Date();
      pair.queue.proposal = null;
    } else {
      pair.queue.proposal = {
        reviewId: review.id,
        proposerReviewerId: session.reviewerId,
        proposerName: session.displayName,
        reasonLabel: reason.label,
        proposedAt: review.createdAt,
        mine: true,
      };
    }
    data.reviews.unshift(review);

    const { seq } = await appendAudit(session, {
      kind: "review.decision",
      payload: auditPayload(input, reason, priorTier, resultTier, state),
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
      modelTier: true,
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
  await assertSecondReviewerRead(session, pairId, input.concurrence);
  if (input.concurrence) {
    const proposal = await prisma.review.findFirst({
      where: { id: input.concurrence.proposalReviewId, pairId },
      select: { reviewerId: true, state: true },
    });
    if (!proposal) {
      throw new DecisionRefused("proposal_not_found", "That proposal is not on this case.");
    }
    if (proposal.reviewerId !== input.concurrence.proposerReviewerId) {
      throw new DecisionRefused(
        "proposal_proposer_mismatch",
        "The proposal names a different reviewer than the one this concurrence answers.",
      );
    }
  }

  const priorTier = pair.tier;
  const modelTier = pair.modelTier;
  assertNotOverwritingT3(priorTier, input.concurrence);
  const { tier: resultTier, state } = resolveResultTier(decision, priorTier, input.concurrence);
  assertT3Allowed(resultTier, decision, input.concurrence, session);

  const currentRetention = pair.retention;
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
        state,
        parentReviewId: input.concurrence?.proposalReviewId ?? null,
        reason: reason.code,
        priorTier,
        modelTier,
        resultTier,
        minutesSpent: input.minutesSpent ?? null,
        feedbackSource: "reviewer",
        viewedExcerptCount: input.viewedExcerptCount ?? null,
      },
    });
    if (input.concurrence) {
      /*
       * The proposal stops being open in the same transaction that answers it.
       * updateMany with state: proposed in the where clause is the lock: two
       * reviewers upholding the same proposal at once, and the second update
       * matches no row, so the transaction is rolled back rather than writing
       * two T3 answers to one proposal.
       */
      const closed = await tx.review.updateMany({
        where: { id: input.concurrence.proposalReviewId, pairId, state: "proposed" },
        data: { state },
      });
      if (closed.count !== 1) {
        throw new DecisionRefused(
          "proposal_not_open",
          "That proposal is no longer open. Somebody has already answered it, or it was withdrawn.",
        );
      }
    }
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
    const audit = await appendAuditInTransaction(session, tx, {
      kind: "review.decision",
      payload: {
        ...auditPayload(input, reason, priorTier, resultTier, state),
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
      priorTier,
      modelTier,
      resultTier,
      minutesSpent: createdRow.minutesSpent,
      viewedExcerptCount: createdRow.viewedExcerptCount,
      notes: {
        timeline: input.notes?.timeline ?? null,
        outsideContext: input.notes?.outsideContext ?? null,
        recommendation: input.notes?.recommendation ?? null,
      },
      state,
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

/**
 * A free-text field, as the chain holds it: whether there was one, how long it
 * was, and a digest of it. Never the text.
 *
 * The length is here because "was a note written" and "was it a sentence or a
 * page" are both questions a reader of the chain can reasonably have, and
 * neither needs the words.
 */
function sealed(value: string | null | undefined): {
  present: boolean;
  length: number;
  sha256: string | null;
} {
  const text = value?.trim() ?? "";
  if (text === "") return { present: false, length: 0, sha256: null };
  return {
    present: true,
    length: text.length,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

function auditPayload(
  input: RecordDecisionInput,
  reason: Reason,
  priorTier: Tier,
  resultTier: Tier,
  state: ReviewState,
): Record<string, unknown> {
  return {
    pairId: input.pairId,
    reviewerId: input.session.reviewerId,
    decision: input.decision,
    state,
    reasonCode: reason.code,
    // Structured, not prose: a record of which reason fields were set, so it
    // stays on the chain as it was.
    reasonDetail: input.reasonDetail ?? null,
    annotations: input.annotations ?? [],
    priorTier,
    resultTier,
    minutesSpent: input.minutesSpent ?? null,
    interrupted: input.interrupted ?? false,
    viewedExcerptCount: input.viewedExcerptCount ?? null,
    // Sealed, not stored. A reviewer's note describes the conversation and
    // often quotes it, and the chain is append-only: a note holding a child's
    // words is a row that outlives every retention class Guardian has, which is
    // rule 7 with no exception written for it. The digest keeps exactly what the
    // chain is for. A regulator checking that a stated reason was not rewritten
    // hashes the note off the review row and compares; nobody reading the chain
    // reads the child.
    notes: {
      timeline: sealed(input.notes?.timeline),
      outsideContext: sealed(input.notes?.outsideContext),
      recommendation: sealed(input.notes?.recommendation),
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
    assertUndoAllowed(review.priorTier, review.createdAt);
    const pair = data.pairs.find((p) => p.queue.pairId === review.pairId);
    if (pair) {
      pair.queue.tier = review.priorTier;
      pair.queue.resolvedAt = null;
    }
    const { seq } = await appendAudit(session, {
      kind: "review.decision",
      payload: {
        compensates: reviewId,
        pairId: review.pairId,
        restoredTier: review.priorTier,
      },
    });
    return { auditSeq: seq, restoredTier: review.priorTier };
  }

  const prisma = await getPrisma();
  const review = await prisma.review.findFirst({
    where: { id: reviewId, reviewerId: session.reviewerId, pair: { customerId: session.customerId } },
  });
  if (!review) throw new DecisionRefused("not_found", "That decision is not in your log.");
  const restoreTier = review.priorTier;
  assertUndoAllowed(restoreTier, review.createdAt);

  const { seq } = await prisma.$transaction(async (tx) => {
    await tx.pair.updateMany({
      where: { id: review.pairId, customerId: session.customerId },
      data: { tier: restoreTier, resolvedAt: null },
    });
    return appendAuditInTransaction(session, tx, {
      kind: "review.decision",
      payload: { compensates: reviewId, pairId: review.pairId, restoredTier: restoreTier },
    });
  });
  return { auditSeq: seq, restoredTier: restoreTier };
}

/**
 * A concurrence answers a proposal that is still open, made by somebody else.
 *
 * The database branch gets this from `updateMany` with `state: "proposed"` in
 * the where clause, which is also the lock against two reviewers answering the
 * same proposal at once. Fixtures have no transaction, so the same three
 * conditions are checked here.
 */
function assertProposalIsOpen(
  reviews: ReviewRecord[],
  pairId: string,
  concurrence: Concurrence | undefined,
): void {
  if (!concurrence) return;
  const proposal = reviews.find((r) => r.id === concurrence.proposalReviewId);
  if (!proposal || proposal.pairId !== pairId) {
    throw new DecisionRefused("proposal_not_found", "That proposal is not on this case.");
  }
  if (proposal.state !== "proposed") {
    throw new DecisionRefused(
      "proposal_not_open",
      "That proposal is no longer open. Somebody has already answered it, or it was withdrawn.",
    );
  }
  if (proposal.reviewerId !== concurrence.proposerReviewerId) {
    throw new DecisionRefused(
      "proposal_proposer_mismatch",
      "The proposal names a different reviewer than the one this concurrence answers.",
    );
  }
}

/**
 * The proposer takes their own proposal back.
 *
 * Not an undo. Undo compensates a decision that changed a tier and closes after
 * sixty seconds; a proposal changed no tier and stays open until somebody
 * answers it, which may be days. What it costs is the same either way: the case
 * returns to the queue as an ordinary T2 and no report exists.
 *
 * Only the proposer, and only while it is open. A second reviewer who disagrees
 * overturns it, which is a decision with a reason on the chain, rather than
 * making it disappear.
 */
export async function withdrawProposal(
  session: Session,
  reviewId: string,
): Promise<{ auditSeq: number; pairId: string }> {
  if (isMockMode()) {
    const data = await getMockData();
    const proposal = data.reviews.find((r) => r.id === reviewId);
    assertWithdrawAllowed(session, proposal);
    proposal!.state = "withdrawn";
    const pair = data.pairs.find((p) => p.queue.pairId === proposal!.pairId);
    if (pair) pair.queue.proposal = null;
    const { seq } = await appendAudit(session, {
      kind: "review.decision",
      payload: { withdraws: reviewId, pairId: proposal!.pairId, state: "withdrawn" },
    });
    return { auditSeq: seq, pairId: proposal!.pairId };
  }

  const prisma = await getPrisma();
  const proposal = await prisma.review.findFirst({
    where: { id: reviewId, pair: { customerId: session.customerId } },
    select: { id: true, pairId: true, reviewerId: true, state: true, decision: true },
  });
  assertWithdrawAllowed(session, proposal ?? undefined);
  const pairId = proposal!.pairId;

  const { seq } = await prisma.$transaction(async (tx) => {
    const closed = await tx.review.updateMany({
      where: { id: reviewId, state: "proposed" },
      data: { state: "withdrawn" },
    });
    if (closed.count !== 1) {
      throw new DecisionRefused(
        "proposal_not_open",
        "That proposal is no longer open. Somebody has already answered it.",
      );
    }
    return appendAuditInTransaction(session, tx, {
      kind: "review.decision",
      payload: { withdraws: reviewId, pairId, state: "withdrawn" },
    });
  });
  return { auditSeq: seq, pairId };
}

function assertWithdrawAllowed(
  session: Session,
  proposal: { reviewerId: string; state: string; decision?: string } | undefined,
): void {
  if (!proposal) {
    throw new DecisionRefused("not_found", "That proposal is not in your log.");
  }
  if (proposal.reviewerId !== session.reviewerId) {
    throw new DecisionRefused(
      "not_your_proposal",
      "Only the reviewer who proposed a report can withdraw it. A second reviewer who disagrees overturns it, which is a decision with a reason.",
    );
  }
  if (proposal.state !== "proposed") {
    throw new DecisionRefused(
      "proposal_not_open",
      "That proposal has already been answered. Withdrawing it would remove a record two people are on.",
    );
  }
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
