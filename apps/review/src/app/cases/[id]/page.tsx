import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession, roleAllows } from "@/lib/auth";
import { getCase, getTimeline } from "@/lib/data/cases";
import { getCustomerSettings } from "@/lib/data/settings";
import type { TimelineState } from "@/lib/data/types";
import {
  ActorPanel,
  buildReportDraft,
  buildSignalList,
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
  markExcerptsViewedAction,
  recordDraftExportAction,
  submitDecisionAction,
  undoDecisionAction,
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
  const draftable = detail.queue.tier === "T2" || detail.queue.tier === "T3";
  let draft: string | null = null;
  if (isOwner && draftable) {
    let jurisdiction: string | null = null;
    try {
      const settings = await getCustomerSettings(session);
      jurisdiction = settings
        ? [settings.jurisdictionCountry, settings.jurisdictionSubdivision]
            .filter(Boolean)
            .join(" ") || null
        : null;
    } catch {
      jurisdiction = null;
    }
    draft = buildReportDraft({
      detail,
      timeline,
      reviewerName: session.displayName,
      jurisdiction,
      generatedAt: new Date(),
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

      <div className={styles.identity}>
        <h1 className={styles.pairId}>Pair {detail.queue.shortId}</h1>
        <span className={styles.where}>
          {detail.queue.customerName}
          {detail.queue.channel ? ` · ${detail.queue.channel}` : ""}
        </span>
      </div>

      <SeverityStrip queue={detail.queue} deferHref="/cases" />

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
        claimedBy={claimedBy}
        leaveHref="/cases"
        onSubmit={submitDecisionAction}
        onUndo={undoDecisionAction}
        onExcerptsViewed={markExcerptsViewedAction}
        onExportDraft={recordDraftExportAction}
      />
    </div>
  );
}
