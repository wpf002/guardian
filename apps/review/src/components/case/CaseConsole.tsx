"use client";

import { useEffect, useState } from "react";
import { UNDO_WINDOW_MS } from "@/lib/reasons";
import type { Tier, TimelineState } from "@/lib/data/types";
import type {
  DecisionOutcome,
  SubmitDecisionInput,
  UndoInput,
} from "@/app/cases/[id]/actions";
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
  /** Set when somebody else holds the claim. The view is read only then. */
  claimedBy?: { who: string; sinceMinutes: number } | null;
  leaveHref: string;
  onSubmit: (input: SubmitDecisionInput) => Promise<DecisionOutcome>;
  onUndo: (input: UndoInput) => Promise<DecisionOutcome>;
  onExcerptsViewed: (pairId: string, excerptIds: string[]) => Promise<string[]>;
  onExportDraft: (pairId: string, method: "copy" | "download") => Promise<{ ok: boolean }>;
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
  claimedBy = null,
  leaveHref,
  onSubmit,
  onUndo,
  onExcerptsViewed,
  onExportDraft,
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

      {draft !== null ? (
        <ReportDraft pairId={pairId} draft={draft} onExport={onExportDraft} />
      ) : null}

      {claimedBy ? (
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
