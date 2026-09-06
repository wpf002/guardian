/**
 * What happened to a report after it left.
 *
 * Stanford's 2024 study found CyberTipline reports are often incomplete or
 * duplicative and that the ones most likely to rescue a child are not
 * sufficiently investigated. The reporter's side of that is worse: a filing
 * goes out and nothing comes back, which was the core Schlep grievance and is
 * why civilian hunters ended up publishing instead of reporting. Australia's
 * eSafety undertaking of August 2026 makes outcome notification binding for
 * Roblox, and every operator running Guardian will be asked the same question
 * by their own counsel.
 *
 * Guardian cannot supply an NCMEC outcome, because NCMEC does not publish one
 * to the reporter. What it can supply is the part it holds: when the bundle was
 * built, when a person took it out of the app, whether a report row exists,
 * whether it was submitted and under what id, and when preservation lifts.
 * Everything here comes from the report row and the hash chain, so a trail
 * cannot say something happened that the chain does not record.
 */

import { getPrisma, isMockMode } from "../db";
import { getMockData } from "../mock/fixtures";
import type { Session } from "../session";
import { listAuditEntries } from "./audit";

export type ReportStage =
  | "bundle_built"
  | "draft_exported"
  | "report_created"
  | "submitted"
  | "preserved_until";

export interface ReportEvent {
  stage: ReportStage;
  at: Date;
  /** One sentence, in the words an operator would use. */
  what: string;
  /** The chain entry behind it, where one exists. Null for a row-derived step. */
  auditSeq: number | null;
}

export interface ReportTrail {
  pairId: string;
  events: ReportEvent[];
  /** The NCMEC id, once a submission recorded one. */
  ncmecReportId: string | null;
  /** When the one-year preservation duty lifts, if a report was submitted. */
  preserveUntil: Date | null;
  /**
   * What is true right now, in one sentence. Says nothing was filed when
   * nothing was, rather than leaving a reader to infer it from an empty list.
   */
  headline: string;
}

const STAGE_WORDS: Record<ReportStage, string> = {
  bundle_built: "Evidence bundle built and anchored to the audit chain.",
  draft_exported: "An owner took the drafted report out of the console.",
  report_created: "A report record was created for this case.",
  submitted: "Submitted to the CyberTipline.",
  preserved_until: "Records preserved under 18 USC 2258A until this date.",
};

/**
 * The trail for one case.
 *
 * Guardian submits nothing itself on the Discord surface: the operator files
 * at the public form, so the honest end of the trail there is the export. A
 * platform customer filing through their own ESP credentials gets the two
 * further steps, and the difference is visible rather than papered over.
 */
export async function getReportTrail(session: Session, pairId: string): Promise<ReportTrail> {
  const events: ReportEvent[] = [];
  let ncmecReportId: string | null = null;
  let preserveUntil: Date | null = null;

  // The chain first: it is the record that cannot be edited, and both of the
  // steps a Discord owner ever reaches are on it.
  const [exports, filings] = await Promise.all([
    listAuditEntries(session, { kind: "bundle.exported", limit: 200 }),
    listAuditEntries(session, { kind: "report.filed", limit: 200 }),
  ]);

  for (const entry of exports) {
    if (entry.payload.pairId !== pairId) continue;
    events.push({
      stage: "draft_exported",
      at: entry.ts,
      what: STAGE_WORDS.draft_exported,
      auditSeq: entry.seq,
    });
  }
  for (const entry of filings) {
    if (entry.payload.pairId !== pairId) continue;
    events.push({
      stage: "report_created",
      at: entry.ts,
      what: STAGE_WORDS.report_created,
      auditSeq: entry.seq,
    });
  }

  if (!isMockMode()) {
    const prisma = await getPrisma();
    const bundles = await prisma.evidenceBundle.findMany({
      where: { pairId, customerId: session.customerId },
      orderBy: { generatedAt: "asc" },
      select: { bundleId: true, generatedAt: true },
    });
    for (const bundle of bundles) {
      events.push({
        stage: "bundle_built",
        at: bundle.generatedAt,
        what: STAGE_WORDS.bundle_built,
        auditSeq: null,
      });
    }

    const bundleIds = bundles.map((b) => b.bundleId);
    if (bundleIds.length > 0) {
      const reports = await prisma.cyberTiplineReport.findMany({
        where: { bundleId: { in: bundleIds }, customerId: session.customerId },
        orderBy: { createdAt: "asc" },
      });
      for (const report of reports) {
        if (report.submittedAt) {
          events.push({
            stage: "submitted",
            at: report.submittedAt,
            what: report.ncmecReportId
              ? `${STAGE_WORDS.submitted} NCMEC report ${report.ncmecReportId}.`
              : `${STAGE_WORDS.submitted} No NCMEC id was returned.`,
            auditSeq: null,
          });
          ncmecReportId = report.ncmecReportId ?? ncmecReportId;
        }
        if (report.preserveUntil) {
          preserveUntil = report.preserveUntil;
          events.push({
            stage: "preserved_until",
            at: report.preserveUntil,
            what: STAGE_WORDS.preserved_until,
            auditSeq: null,
          });
        }
      }
    }
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return { pairId, events, ncmecReportId, preserveUntil, headline: headlineFor(events) };
}

function headlineFor(events: ReportEvent[]): string {
  const has = (stage: ReportStage): boolean => events.some((e) => e.stage === stage);
  if (has("submitted")) {
    return "This case was reported to the CyberTipline. NCMEC does not publish an outcome back to the reporter, so what follows is not visible here.";
  }
  if (has("report_created")) {
    return "A report record exists for this case and no submission has been recorded against it.";
  }
  if (has("draft_exported")) {
    return "The draft has left the console. Guardian does not know whether it was filed: the operator files at the public form, and NCMEC reports nothing back to Guardian.";
  }
  return "Nothing has been filed for this case, and nothing has left the console.";
}

/**
 * Reports by status across the partition, for the operator dashboard. Counts
 * only, and never a list of cases: this answers whether the reporting pipeline
 * is moving, not who is in it.
 */
export interface ReportRollup {
  drafted: number;
  submitted: number;
  /** Reports whose one-year preservation is still running. */
  underPreservation: number;
  /** Bundles taken out of the console, from the chain. */
  draftsExported: number;
}

export async function getReportRollup(session: Session): Promise<ReportRollup> {
  const exported = await listAuditEntries(session, { kind: "bundle.exported", limit: 500 });

  if (isMockMode()) {
    await getMockData();
    return {
      drafted: 0,
      submitted: 0,
      underPreservation: 0,
      draftsExported: exported.length,
    };
  }

  const prisma = await getPrisma();
  const now = new Date();
  const [drafted, submitted, underPreservation] = await Promise.all([
    prisma.cyberTiplineReport.count({
      where: { customerId: session.customerId, submittedAt: null },
    }),
    prisma.cyberTiplineReport.count({
      where: { customerId: session.customerId, submittedAt: { not: null } },
    }),
    prisma.cyberTiplineReport.count({
      where: { customerId: session.customerId, preserveUntil: { gt: now } },
    }),
  ]);

  return { drafted, submitted, underPreservation, draftsExported: exported.length };
}
