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
}

export function filingReadiness(input: FilingReadinessInput): FilingReadiness {
  const { detail, timeline, settings, incident } = input;
  const gaps: FilingGap[] = [];

  // Jurisdiction is the one number NCMEC publishes about report quality, and
  // over a tenth of industry reports in 2025 lacked enough data to determine it.
  if (!settings?.jurisdictionCountry) {
    gaps.push({
      severity: "blocking",
      what: "No jurisdiction on the customer record",
      gather:
        "Set the country, and the state or province where a rule applies, in settings. A report a recipient cannot place is a report nobody can route.",
    });
  }

  // Rule 6. Only a human reviewer produces T3, and only a T3 becomes a filing.
  // humanViewedAt is not a substitute: it says somebody opened an excerpt, not
  // that anybody decided anything.
  if (!detail.reviewerConfirmedT3) {
    gaps.push({
      severity: "blocking",
      what: "No reviewer decision has produced tier T3 on this case",
      gather:
        "A report is built from a reviewer-confirmed T3 and nothing else. Propose it, and a second reviewer has to uphold it. The model tops out at T2 and cannot make this decision.",
    });
  }

  // NCMEC displays the reported account as the suspect. Guardian never picks
  // it, and a filing sent before somebody does is a filing where a model's
  // choice about which side of a pair to score became a suspect designation
  // (CLAUDE.md rule 5).
  if (detail.reportedSubjectUid === null) {
    gaps.push({
      severity: "blocking",
      what: "Nobody has said which account this report is about",
      gather:
        "Name the account from the conversation. Guardian scored one side of this pair and that is not a designation: the detectors fire on accounts in a younger band on purpose, so the account it scored is sometimes the child.",
    });
  }

  if (incident.source === "default") {
    gaps.push({
      severity: "blocking",
      what: "The incident type is a fallback",
      gather:
        "Choose the type this conversation shows. NCMEC routes and prioritises on it, and nothing downstream can tell a default from a finding.",
    });
  }

  // Rule 6 and the private-search claim both rest on a person having read the
  // material. A report that says a human reviewed it has to name which rows.
  if (detail.humanViewedAt === null) {
    gaps.push({
      severity: "blocking",
      what: "No excerpt has been read by a person",
      gather:
        "Open the timeline and read the excerpts before filing. A report that says a human reviewed the material has to be able to say which rows.",
    });
  }

  if (timeline.state !== "ready" || timeline.rows.length === 0) {
    gaps.push({
      severity: "blocking",
      what: "No excerpts to attach",
      gather:
        "The excerpts for this case are gone under the retention rule. File from your own records, which you still hold.",
    });
  }

  if (!settings?.ncmecProviderName) {
    gaps.push({
      severity: "degrading",
      what: "No provider name as registered with NCMEC",
      gather:
        "Add the name you registered under, in settings. The report is filed under your name, not Guardian's.",
    });
  }

  if (!settings?.contactOnFile) {
    gaps.push({
      severity: "degrading",
      what: "No named point of contact",
      gather:
        "Add the person NCMEC should contact about a report, in settings. Guardian is the agent and is never the contact.",
    });
  }

  if (!settings?.timezone) {
    gaps.push({
      severity: "degrading",
      what: "No timezone on the customer record",
      gather:
        "Set your operating timezone in settings. The incident fields are asked in local time, and this draft reports UTC without one.",
    });
  }

  if (!settings?.legalBasis) {
    gaps.push({
      severity: "enriching",
      what: "No legal basis recorded",
      gather: "Record the basis your counsel settled on, in settings.",
    });
  }

  if (!settings?.ncmecEspId) {
    gaps.push({
      severity: "enriching",
      what: "No ESP identifier",
      gather:
        "Register with NCMEC to get one. Without it a report is drafted for you to file at the public form, which is what this card is.",
    });
  }

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
    return "Nothing is missing that would stop this report being routed and acted on.";
  }
  if (readiness.blockingCount > 0) {
    return readiness.blockingCount === 1
      ? "One thing has to be fixed before this is worth filing."
      : `${readiness.blockingCount} things have to be fixed before this is worth filing.`;
  }
  return "This can be filed. It will triage worse than it needs to.";
}
