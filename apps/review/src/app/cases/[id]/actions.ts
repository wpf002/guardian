"use server";

import { revalidatePath } from "next/cache";
import { requireRole, requireSession } from "@/lib/auth";
import { markExcerptsViewed } from "@/lib/data/cases";
import { appendAudit } from "@/lib/data/audit";
import {
  DecisionRefused,
  recordDecision,
  undoDecision,
  type ProposeAnnotation,
  type ReviewState,
} from "@/lib/decisions";
import type { ReviewDecision, Tier } from "@/lib/data/types";

/**
 * Every write on the case detail goes through this module.
 *
 * Each action takes the session from requireSession rather than from its
 * arguments, so a client cannot decide who it is, and each one hands the write
 * to the data layer rather than reaching a table itself. Nothing here can
 * produce tier T3: recordDecision owns that branch and refuses it without a
 * second reviewer's concurrence.
 */

export interface DecisionOutcome {
  ok: boolean;
  /** Named, and preserved in the form so nothing typed is lost. */
  error?: string;
  summary?: string;
  reviewId?: string;
  state?: ReviewState;
  resultTier?: Tier;
  auditSeq?: number;
}

export interface SubmitDecisionInput {
  pairId: string;
  decision: ReviewDecision;
  reasonCode: string;
  reasonDetail?: Record<string, unknown>;
  notes?: {
    timeline?: string;
    outsideContext?: string;
    recommendation?: string;
  };
  minutesSpent?: number;
  interrupted?: boolean;
  viewedExcerptCount?: number;
  annotations?: ProposeAnnotation[];
  lawEnforcementRequested?: boolean;
}

export async function submitDecisionAction(
  input: SubmitDecisionInput,
): Promise<DecisionOutcome> {
  const session = await requireSession();
  try {
    const result = await recordDecision({
      session,
      pairId: input.pairId,
      decision: input.decision,
      reasonCode: input.reasonCode,
      reasonDetail: input.reasonDetail,
      notes: input.notes,
      minutesSpent: input.minutesSpent,
      interrupted: input.interrupted,
      viewedExcerptCount: input.viewedExcerptCount,
      annotations: input.annotations,
      lawEnforcementRequested: input.lawEnforcementRequested,
    });
    revalidatePath(`/cases/${input.pairId}`);
    return {
      ok: true,
      summary: result.summary,
      reviewId: result.review.id,
      state: result.state,
      resultTier: result.resultTier,
      auditSeq: result.auditSeq,
    };
  } catch (error) {
    if (error instanceof DecisionRefused) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error:
        "The decision was not recorded. Nothing changed, and what you typed is still here.",
    };
  }
}

export interface UndoInput {
  pairId: string;
  reviewId: string;
  /** The tier the model had left the pair at, before the decision. */
  restoreTier: Tier;
}

export async function undoDecisionAction(input: UndoInput): Promise<DecisionOutcome> {
  const session = await requireSession();
  try {
    const { auditSeq } = await undoDecision(session, input.reviewId, input.restoreTier);
    revalidatePath(`/cases/${input.pairId}`);
    return { ok: true, auditSeq, summary: "The decision was reversed. The earlier row is unchanged, and a compensating entry is on the chain." };
  } catch (error) {
    if (error instanceof DecisionRefused) return { ok: false, error: error.message };
    return { ok: false, error: "The reversal was not recorded. The decision still stands." };
  }
}

/**
 * The viewedByHuman write path. Called when an excerpt becomes legibly rendered
 * to this reviewer, and on nothing else: not on case open, and not by scrolling
 * past a collapsed span. It is a claim about a private search rather than an
 * engagement metric, so it has to be honest enough to survive a motion.
 */
export async function markExcerptsViewedAction(
  pairId: string,
  excerptIds: string[],
): Promise<number> {
  const session = await requireSession();
  return markExcerptsViewed(session, pairId, excerptIds);
}

/**
 * An owner took the drafted bundle out of the app. That is an export, and every
 * export goes on the chain. Guardian still submits nothing: the operator files
 * the report themselves.
 */
export async function recordDraftExportAction(
  pairId: string,
  method: "copy" | "download",
): Promise<{ ok: boolean; auditSeq?: number }> {
  const session = await requireRole("owner");
  try {
    const { seq } = await appendAudit(session, {
      kind: "bundle.exported",
      payload: {
        pairId,
        method,
        reviewerId: session.reviewerId,
        destination: "operator, for filing at report.cybertip.org",
        submittedByGuardian: false,
      },
    });
    return { ok: true, auditSeq: seq };
  } catch {
    return { ok: false };
  }
}
