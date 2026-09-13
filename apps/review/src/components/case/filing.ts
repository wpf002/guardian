/**
 * What would stop this report being useful, in the words the filer needs.
 *
 * ROADMAP P-6 asked whether the console shows the bundle-side completeness
 * scorer, the report-side one, or both. The answer here is the report side, and
 * the reason is what each one is for. The bundle scorer says whether the
 * evidence record is complete, which is a question about the archive and is
 * answered where the archive is read: it travels inside the bundle and inside
 * the audit export. The report scorer says whether a filing would be accepted,
 * routed and acted on, which is a question about the thing the person in front
 * of the screen is about to do. Two scores on one card would make a reviewer
 * decide which one to believe, and the one they should act on is this one.
 *
 * It is not scoreReportCompleteness itself. That scorer takes a built envelope,
 * which needs the whole bundle, and the console holds a view model. What it
 * takes is that scorer's severity vocabulary and its rule that a fallback
 * incident type blocks, applied to what the console actually knows. Where the
 * two could disagree the console is the more cautious one: it never reports
 * ready when the report scorer would block.
 */

import type { CaseDetail, CustomerSettings, TimelineState } from "@/lib/data/types";
import type { IncidentChoice } from "./incident-types";

export type FilingSeverity = "blocking" | "degrading" | "enriching";

export interface FilingGap {
  severity: FilingSeverity;
  /** What is missing, as a short noun phrase. */
  what: string;
  /** What to go and do about it. Imperative, and about the operator's own setup. */
  gather: string;
}

export interface FilingReadiness {
  gaps: FilingGap[];
  /** Nothing blocking and nothing degrading. */
  readyToFile: boolean;
  /** The count that goes on the card's aside. */
  blockingCount: number;
}

export interface FilingReadinessInput {
  detail: CaseDetail;
  timeline: TimelineState;
  settings: CustomerSettings | null;
  incident: IncidentChoice;
  /**
   * Whether this partition has a second reviewer seat at all.
   *
   * A T3 needs two people, and a 40-person server has one moderator, which is
   * the segment this product is for. Telling that operator to have a second
   * reviewer uphold it names a person who does not exist. What is true for them
   * is that the drafted bundle is the end of the path and they file it
   * themselves on the public form (ROADMAP D-3).
   */
  secondSeat?: boolean;
}

export function filingReadiness(input: FilingReadinessInput): FilingReadiness {
  const { detail, timeline, settings, incident, secondSeat = true } = input;
  const gaps: FilingGap[] = [];

  // Jurisdiction is the one number NCMEC publishes about report quality, and
  // over a tenth of industry reports in 2025 lacked enough data to determine it.
  if (!settings?.jurisdictionCountry) {
    gaps.push({
      severity: "blocking",
      what: "Your country isn't set",
      gather: "Add it in Settings, under Reporting Details. NCMEC uses it to decide who handles this.",
    });
  }

  // Rule 6. Only a human reviewer produces T3, and only a T3 becomes a filing.
  // humanViewedAt is not a substitute: it says somebody opened an excerpt, not
  // that anybody decided anything.
  if (!detail.reviewerConfirmedT3) {
    gaps.push({
      severity: "blocking",
      what: "Two people haven't agreed to report this",
      gather: secondSeat
        ? "Pick Report It, and someone else on your team has to agree. Guardian can't decide this on its own."
        : "You're the only person on your team, so this can't be marked for reporting. Send it yourself at report.cybertip.org. Guardian can't decide this on its own.",
    });
  }

  // NCMEC displays the reported account as the suspect. Guardian never picks
  // it, and a filing sent before somebody does is a filing where a model's
  // choice about which side of a pair to score became a suspect designation
  // (CLAUDE.md rule 5).
  if (detail.reportedSubjectUid === null) {
    gaps.push({
      severity: "blocking",
      what: "No account is picked",
      gather:
        "Pick the account you're reporting. Guardian doesn't choose, because the account that set this off is sometimes the child.",
    });
  }

  if (incident.source === "default") {
    gaps.push({
      severity: "blocking",
      what: "The kind of report isn't picked",
      gather: "Pick the kind that fits what happened. NCMEC uses it to decide how urgent this is.",
    });
  }

  // Rule 6 and the private-search claim both rest on a person having read the
  // material. A report that says a human reviewed it has to name which rows.
  if (detail.humanViewedAt === null) {
    gaps.push({
      severity: "blocking",
      what: "Nobody has read the messages",
      gather: "Read the conversation before you send this. The report says which messages a person read.",
    });
  }

  if (timeline.state !== "ready" || timeline.rows.length === 0) {
    gaps.push({
      severity: "blocking",
      what: "The messages were deleted",
      gather: "Guardian deleted them on schedule. Use the messages on your own server instead.",
    });
  }

  if (!settings?.ncmecProviderName) {
    gaps.push({
      severity: "degrading",
      what: "Your organization's name isn't set",
      gather: "Add it in Settings, under Reporting Details. The report goes out under your name.",
    });
  }

  if (!settings?.contactOnFile) {
    gaps.push({
      severity: "degrading",
      what: "There's no contact person",
      gather: "Add who NCMEC should contact, in Settings, under Reporting Details.",
    });
  }

  if (!settings?.timezone) {
    gaps.push({
      severity: "degrading",
      what: "Your time zone isn't set",
      gather: "Add it in Settings, under Reporting Details, so the times in the report are right.",
    });
  }

  /*
   * Two gaps are no longer listed: "No legal basis recorded" and "No ESP
   * identifier". Neither is something a Discord server owner can act on. A
   * server owner files at NCMEC's public form, which needs no registration
   * (docs/V1.md section 4), and there is no field anywhere in the console for
   * either one. A gap nobody can close is noise on the card that matters.
   */

  const blockingCount = gaps.filter((gap) => gap.severity === "blocking").length;
  return {
    gaps,
    blockingCount,
    readyToFile: gaps.every((gap) => gap.severity === "enriching"),
  };
}

/** One sentence for the card, whatever the state. */
export function filingHeadline(readiness: FilingReadiness): string {
  if (readiness.readyToFile) {
    return "Ready to send.";
  }
  if (readiness.blockingCount > 0) {
    return readiness.blockingCount === 1
      ? "One thing to fix before you send this."
      : `${readiness.blockingCount} things to fix before you send this.`;
  }
  return "You can send this. Filling in the rest helps NCMEC act on it sooner.";
}
