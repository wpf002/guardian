"use client";

import { useEffect, useState } from "react";
import { UNDO_WINDOW_MS } from "@/lib/reasons";
import type { OpenProposal, Tier, TimelineState } from "@/lib/data/types";
import type {
  ConcurInput,
  DecisionOutcome,
  SubmitDecisionInput,
  UndoInput,
  WithdrawInput,
} from "@/app/cases/[id]/actions";
import type { FilingReadiness } from "./filing";
import type { NcmecIncidentType } from "./incident-types";
import { ConcurrencePanel } from "./ConcurrencePanel";
import { ConsequenceCopy } from "./ConsequenceCopy";
import { DecisionPanel } from "./DecisionPanel";
import { ReopenPanel } from "./ReopenPanel";
import { ReportDraft } from "./ReportDraft";
import { TimelinePanel } from "./TimelinePanel";
import styles from "./Decision.module.css";

export interface CaseConsoleProps {
  pairId: string;
  timeline: TimelineState;
  /** Set when the timeline fetch threw rather than returning a state. */
  timelineError?: string;
  initialReadCount: number;
  totalExcerpts: number;
  missing: string[];
  modelTier: Tier;
  soleAutomatedBasis: boolean;
  resolvedAt: Date | null;
  retentionDeadline: Date | null;
  /** Null for anyone who is not an owner on this partition. */
  draft: string | null;
  /** The incident type the recorded signals derived, and whether they derived it. */
  derivedIncidentType: NcmecIncidentType;
  incidentTypeDerived: boolean;
  /** What would stop this report being routed. Null for anyone but an owner. */
  readiness: FilingReadiness | null;
  /** Both accounts on the pair, so a reviewer can designate one as the subject. */
  accounts: { actorUid: string; targetUid: string };
  actorBandLabel: string;
  targetBandLabel: string;
  reportedSubjectUid: string | null;
  onDesignateSubject: (pairId: string, uid: string) => Promise<{ draft: string }>;
  /** An unanswered proposal for report on this pair, if there is one. */
  proposal: OpenProposal | null;
  /** False when this partition has one reviewer seat, so no proposal can complete. */
  secondSeat: boolean;
  /** Set when somebody else holds the claim. The view is read only then. */
  claimedBy?: { who: string; sinceMinutes: number } | null;
  leaveHref: string;
  onSubmit: (input: SubmitDecisionInput) => Promise<DecisionOutcome>;
  onUndo: (input: UndoInput) => Promise<DecisionOutcome>;
  onConcur: (input: ConcurInput) => Promise<DecisionOutcome>;
  onWithdraw: (input: WithdrawInput) => Promise<DecisionOutcome>;
  onExcerptsViewed: (pairId: string, excerptIds: string[]) => Promise<string[]>;
  onExportDraft: (pairId: string, method: "copy" | "download") => Promise<{ ok: boolean }>;
  /** Rebuilds the draft under a chosen incident type, on the server. */
  onIncidentType: (pairId: string, incidentType: NcmecIncidentType) => Promise<{ draft: string }>;
}

/**
 * The interactive half of the case: the evidence, the report draft and the
 * decision.
 *
 * It exists so the read count has one owner. The timeline writes viewedByHuman
 * and the decision panel reads the count, and a reviewer who has read nothing
 * cannot confirm or propose.
 */
export function CaseConsole({
  pairId,
  timeline,
  timelineError,
  initialReadCount,
  totalExcerpts,
  missing,
  modelTier,
  soleAutomatedBasis,
  resolvedAt,
  retentionDeadline,
  draft,
  derivedIncidentType,
  incidentTypeDerived,
  readiness,
  accounts,
  actorBandLabel,
  targetBandLabel,
  reportedSubjectUid,
  onDesignateSubject,
  proposal,
  secondSeat,
  claimedBy = null,
  leaveHref,
  onSubmit,
  onUndo,
  onConcur,
  onWithdraw,
  onExcerptsViewed,
  onExportDraft,
  onIncidentType,
}: CaseConsoleProps) {
  const [readCount, setReadCount] = useState(initialReadCount);
  const [reopened, setReopened] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [decidedAt, setDecidedAt] = useState<number | null>(null);

  /**
   * Recording a decision revalidates the route, which comes back with
   * resolvedAt set. Swapping straight to the resolved view on that render took
   * the confirmation and the undo bar off the screen seconds into a sixty
   * second window, which is the opposite of what DESIGN-UI 12 asks for. The
   * decision panel is held until the window closes or the reviewer reverses it.
   */
  useEffect(() => {
    if (decidedAt === null) return;
    const remaining = Math.max(0, UNDO_WINDOW_MS - (Date.now() - decidedAt));
    const timer = setTimeout(() => setDecidedAt(null), remaining);
    return () => clearTimeout(timer);
  }, [decidedAt]);

  const resolved = resolvedAt !== null && !reopened && decidedAt === null;

  return (
    <>
      <TimelinePanel
        pairId={pairId}
        timeline={timeline}
        error={timelineError}
        readCount={readCount}
        onReadCountChange={setReadCount}
        onExcerptsViewed={onExcerptsViewed}
      />

      {draft !== null && readiness !== null ? (
        <ReportDraft
          pairId={pairId}
          draft={draft}
          derivedIncidentType={derivedIncidentType}
          incidentTypeDerived={incidentTypeDerived}
          readiness={readiness}
          accounts={accounts}
          actorBandLabel={actorBandLabel}
          targetBandLabel={targetBandLabel}
          reportedSubjectUid={reportedSubjectUid}
          onExport={onExportDraft}
          onDesignateSubject={onDesignateSubject}
          onIncidentType={onIncidentType}
        />
      ) : null}

      {/*
        An unanswered proposal replaces the decision panel entirely, and it
        comes before the claim check.
        
        A second reviewer's job on this case is to answer the proposal, not to
        make a fresh decision: recordDecision refuses a plain dismiss or watch
        that would overwrite a pair two people are mid-way through. And the
        claim is the stale fact once a proposal exists, because the proposer has
        finished with the case. Answering it is not taking it from them.
      */}
      {proposal ? (
        <ConcurrencePanel
          pairId={pairId}
          proposal={proposal}
          timelineAvailable={timelineError === undefined && timeline.state === "ready"}
          readCount={readCount}
          onConcur={onConcur}
          onWithdraw={onWithdraw}
          leaveHref={leaveHref}
        />
      ) : claimedBy ? (
        <section className={styles.panel} aria-label="Read only">
          <h2 className={styles.title}>You are reading a case somebody else claimed</h2>
          <p className={styles.lead}>
            Claimed by {claimedBy.who}, {claimedBy.sinceMinutes} minutes ago. You can read it and
            you cannot decide it. Ask them for a handoff if you need to take it.
          </p>
          <ConsequenceCopy context="readonly" />
        </section>
      ) : resolved ? (
        <ReopenPanel
          resolvedTier={modelTier}
          resolvedAt={resolvedAt}
          excerptsExpired={timeline.state === "expired"}
          retentionDeadline={retentionDeadline}
          onReopen={() => setReopened(true)}
        />
      ) : (
        <DecisionPanel
          pairId={pairId}
          modelTier={modelTier}
          secondSeat={secondSeat}
          soleAutomatedBasis={soleAutomatedBasis}
          timelineAvailable={timelineError === undefined && timeline.state === "ready"}
          readCount={readCount}
          totalExcerpts={totalExcerpts}
          missing={missing}
          openedAt={openedAt}
          onSubmit={onSubmit}
          onUndo={onUndo}
          onDecisionRecorded={() => setDecidedAt(Date.now())}
          onDecisionReversed={() => setDecidedAt(null)}
          leaveHref={leaveHref}
        />
      )}
    </>
  );
}
