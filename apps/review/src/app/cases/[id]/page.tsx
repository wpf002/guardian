import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, roleAllows } from "@/lib/auth";
import { getCase, getTimeline } from "@/lib/data/cases";
import { getReportTrail } from "@/lib/data/reports";
import { getCustomerSettings } from "@/lib/data/settings";
import { bandWord } from "@/lib/mock/fixtures";
import type { CustomerSettings, TimelineState } from "@/lib/data/types";
import {
  ActorPanel,
  buildReportDraft,
  buildSignalList,
  derivedIncident,
  filingReadiness,
  ReportTrail,
  type FilingReadiness,
  CaseConsole,
  excerptTotal,
  PolicyPanel,
  ProvenanceLine,
  readExcerptCount,
  SeverityStrip,
  SignalList,
  WhyPanel,
} from "@/components/case";
import { StagePath } from "@/components";
import { Card } from "@/components";
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
  return { title: `Pair ${id.slice(-4)}` };
}

const TIMELINE_FAILED =
  "The evidence timeline could not be loaded. You can defer this case or reload. Do not decide on the strip alone when the timeline is unavailable.";

function slaWords(minutes: number | null): string {
  if (minutes === null) return "no SLA (watch)";
  if (minutes <= 0) return "past the queue target";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m left` : `${rest}m left`;
}

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

  const signals = buildSignalList(detail, timeline);
  const totalExcerpts = excerptTotal(timeline);
  const initialReadCount = readExcerptCount(timeline);

  const rows = timeline.state === "ready" ? timeline.rows : [];
  const unflaggedMedia = rows.filter(
    (row) => row.media !== null && !row.media.viewedByOperatorHuman,
  ).length;
  const missing: string[] = [];
  if (unflaggedMedia > 0) {
    missing.push(
      `the operator's human-viewed flag on ${unflaggedMedia} media hash${
        unflaggedMedia === 1 ? "" : "es"
      }`,
    );
  }
  if (timelineError) missing.push("the excerpts, because the timeline did not load");

  const isOwner = roleAllows(session.role, "owner");
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
    readiness = filingReadiness({ detail, timeline, settings, incident });
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
      <div className={styles.head}>
        <Link className={styles.back} href="/cases">
          Back to cases
        </Link>
        <span className={styles.sla}>{slaWords(detail.queue.slaRemainingMinutes)}</span>
      </div>

      {/*
        The heading is what happened, not the row's primary key. A reviewer
        arrives here from a queue card that said "Stage 3 to 4 in 19h" and the
        page used to answer with a hex id, so the one useful sentence was
        demoted to the inside of a card and the identifier was promoted to
        display size. The id is still here, in the line underneath, where an
        identifier belongs.
      */}
      <div className={styles.identity}>
        <h1 className={styles.headline}>{detail.queue.patternClause}</h1>
        <p className={styles.where}>
          <span className={`${styles.pairId} mono`}>Pair {detail.queue.shortId}</span>
          <span>
            {detail.queue.customerName}
            {detail.queue.channel ? ` · ${detail.queue.channel}` : ""}
          </span>
        </p>
      </div>

      <SeverityStrip queue={detail.queue} />

      <WhyPanel sentence={detail.whySentence} features={detail.features} />

      <SignalList signals={signals} lexiconVersion={detail.versions.lexiconVersion} />

      <div className={styles.columns}>
        <Card title="This pair" density="padded">
          <StagePath
            path={detail.stagePath}
            velocityWindow={detail.velocityWindow}
            soleAutomatedBasis={detail.queue.soleAutomatedBasis}
          />
          {detail.velocityWindow === null && !detail.queue.soleAutomatedBasis ? (
            <p className={styles.note}>
              No velocity window is recorded on this pair row, so none is named here.
            </p>
          ) : null}
        </Card>
        <ActorPanel actor={detail.actor} priorCases={detail.priorCases} />
      </div>

      <PolicyPanel policy={detail.policy} />

      {trail ? <ReportTrail trail={trail} /> : null}

      <ProvenanceLine
        versions={detail.versions}
        scoredAt={detail.scoredAt}
        auditSeq={detail.auditSeq}
      />

      <CaseConsole
        pairId={detail.queue.pairId}
        timeline={timeline}
        timelineError={timelineError}
        initialReadCount={initialReadCount}
        totalExcerpts={totalExcerpts}
        missing={missing}
        modelTier={detail.queue.tier}
        soleAutomatedBasis={detail.queue.soleAutomatedBasis}
        resolvedAt={detail.queue.resolvedAt}
        retentionDeadline={null}
        draft={draft}
        derivedIncidentType={incident.incidentType}
        incidentTypeDerived={incident.source === "signals"}
        readiness={readiness}
        accounts={detail.accounts}
        actorBandLabel={bandWord(detail.queue.actorBand.band)}
        targetBandLabel={bandWord(detail.queue.targetBand.band)}
        reportedSubjectUid={detail.reportedSubjectUid}
        onDesignateSubject={designateReportSubjectAction}
        proposal={detail.proposal}
        claimedBy={claimedBy}
        leaveHref="/cases"
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
