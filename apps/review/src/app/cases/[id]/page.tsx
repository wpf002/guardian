import { notFound } from "next/navigation";
import { requireSession, roleAllows } from "@/lib/auth";
import { getCase, getTimeline } from "@/lib/data/cases";
import { getReportTrail } from "@/lib/data/reports";
import { getCustomerSettings, hasSecondSeat } from "@/lib/data/settings";
import { bandWord } from "@/lib/mock/fixtures";
import { accountLabel } from "@/components/queue/words";
import type { CustomerSettings, TimelineState } from "@/lib/data/types";
import {
  buildReportDraft,
  CaseConsole,
  CaseSummary,
  derivedIncident,
  excerptTotal,
  filingReadiness,
  readExcerptCount,
  ReportTrail,
  type FilingReadiness,
} from "@/components/case";
import {
  concurAction,
  markExcerptsViewedAction,
  designateReportSubjectAction,
  recordDraftExportAction,
  redraftForIncidentTypeAction,
  submitDecisionAction,
  undoDecisionAction,
  withdrawProposalAction,
} from "./actions";
import styles from "@/components/case/Case.module.css";

/**
 * One case.
 *
 * Data is read here, on the server, with the session in every where clause. The
 * pattern goes above the fold and the raw text below it, because the reviewer's
 * question is whether a pattern is present, not what was said. Everything
 * interactive lives in CaseConsole, and every write goes through a server
 * action in ./actions.
 */

/**
 * Two cases open in two tabs have to be tellable apart, and a screen reader
 * speaks the title on arrival. The short id is what the whole app calls a pair,
 * and it names no person.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<{ title: string }> {
  const { id } = await params;
  // What happened, rather than "Pair 91c7". A tab has to be told apart from
  // the next one, and the headline does that in words.
  const session = await requireSession();
  const detail = await getCase(session, id);
  return { title: detail?.queue.patternClause ?? "Conversation" };
}

const TIMELINE_FAILED = "The conversation couldn't be loaded. Reload the page before you decide anything.";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const detail = await getCase(session, id);
  if (!detail) notFound();

  let timeline: TimelineState = { state: "empty" };
  let timelineError: string | undefined;
  try {
    timeline = await getTimeline(session, id);
  } catch {
    timelineError = TIMELINE_FAILED;
  }

  const totalExcerpts = excerptTotal(timeline);
  const initialReadCount = readExcerptCount(timeline);

  const rows = timeline.state === "ready" ? timeline.rows : [];
  const unflaggedMedia = rows.filter(
    (row) => row.media !== null && !row.media.viewedByOperatorHuman,
  ).length;
  const missing: string[] = [];
  if (unflaggedMedia > 0) {
    missing.push(
      `whether anyone on your team has looked at ${unflaggedMedia === 1 ? "an image" : `${unflaggedMedia} images`}`,
    );
  }
  if (timelineError) missing.push("the messages, because they didn't load");

  const isOwner = roleAllows(session.role, "owner");
  /*
   * A T3 needs two people, and a 40-person server has one moderator. Below two
   * seats no proposal on this partition can ever be upheld, so the console says
   * that where the decision is made rather than letting it be discovered at the
   * proposal (ROADMAP D-3).
   */
  const secondSeat = hasSecondSeat(session);
  // Rule 6, at the one place it decides something. The tier is not the test:
  // the model assigns T2 by itself, so a case at T2 has had no decision at all.
  // This used to be `tier === "T2" || tier === "T3"`, which drafted a federal
  // report from a tier the model produced.
  const draftable = detail.reviewerConfirmedT3;
  // Derived before the draft, because the draft prints it. The reviewer can
  // change it, and the redraft action rebuilds the text under their choice.
  const incident = derivedIncident(detail, timeline);
  let draft: string | null = null;
  let readiness: FilingReadiness | null = null;
  let trail: Awaited<ReturnType<typeof getReportTrail>> | null = null;
  if (isOwner && draftable) {
    let settings: CustomerSettings | null = null;
    let jurisdiction: string | null = null;
    try {
      settings = await getCustomerSettings(session);
      jurisdiction = settings
        ? [settings.jurisdictionCountry, settings.jurisdictionSubdivision]
            .filter(Boolean)
            .join(" ") || null
        : null;
    } catch {
      jurisdiction = null;
    }
    // The report side: what a recipient needs to route and act on the filing.
    // A settings read that failed reads as nothing on file, which overstates
    // the gaps and never understates them.
    readiness = filingReadiness({ detail, timeline, settings, incident, secondSeat });
    // What happened after the draft left, as far as Guardian holds it.
    trail = await getReportTrail(session, detail.queue.pairId);
    draft = buildReportDraft({
      detail,
      timeline,
      reviewerName: session.displayName,
      jurisdiction,
      generatedAt: new Date(),
      incident,
    });
  }

  const claimedBy =
    detail.queue.claim.state === "other"
      ? { who: detail.queue.claim.who, sinceMinutes: detail.queue.claim.sinceMinutes }
      : null;

  return (
    <div className={`container ${styles.page}`}>
      {/*
        One summary in place of seven panels: a severity strip, a fusion-weight
        chart, the lexicon hits, the stage ladder, account statistics, the
        written tier policy and a version triple. Every score is still kept in
        the Evidence Log. None of it helped a person read the conversation.
        So is the countdown that sat opposite the back link, which was the
        queue's deadline following a reviewer into the case.
      */}
      <CaseSummary detail={detail} />

      {trail ? <ReportTrail trail={trail} /> : null}

      <CaseConsole
        pairId={detail.queue.pairId}
        timeline={timeline}
        timelineError={timelineError}
        initialReadCount={initialReadCount}
        totalExcerpts={totalExcerpts}
        missing={missing}
        currentTier={detail.queue.tier}
        kernelTier={detail.modelTier}
        soleAutomatedBasis={detail.queue.soleAutomatedBasis}
        resolvedAt={detail.queue.resolvedAt}
        retentionDeadline={null}
        draft={draft}
        derivedIncidentType={incident.incidentType}
        incidentTypeDerived={incident.source === "signals"}
        readiness={readiness}
        accounts={detail.accounts}
        names={{ actor: accountLabel(detail.queue.actorUid), target: accountLabel(detail.queue.targetUid) }}
        actorBandLabel={bandWord(detail.queue.actorBand.band)}
        targetBandLabel={bandWord(detail.queue.targetBand.band)}
        reportedSubjectUid={detail.reportedSubjectUid}
        onDesignateSubject={designateReportSubjectAction}
        proposal={detail.proposal}
        secondSeat={secondSeat}
        claimedBy={claimedBy}
        leaveHref="/queue"
        onSubmit={submitDecisionAction}
        onUndo={undoDecisionAction}
        onConcur={concurAction}
        onWithdraw={withdrawProposalAction}
        onIncidentType={redraftForIncidentTypeAction}
        onExcerptsViewed={markExcerptsViewedAction}
        onExportDraft={recordDraftExportAction}
      />
    </div>
  );
}
