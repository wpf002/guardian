/**
 * Report completeness.
 *
 * This is the differentiator, not a nicety. NCMEC's 2025 numbers: 21.3 million
 * reports, and more than 10 percent of industry reports lacked enough data to
 * determine where the offense occurred, worse than the more than 8 percent in
 * 2024, with NCMEC now naming the companies that file them (RESEARCH.md gap
 * B6). The Stanford Internet Observatory's 2024 ecosystem report, built on 66
 * interviews, found near-identical reports producing opposite outcomes, and
 * named what makes a report useless: missing location data, missing context,
 * duplicates, and no indication of whether a human reviewed it.
 *
 * So this module checks the specific things those two sources call out, not a
 * generic required-field pass:
 *
 * - Jurisdiction determinability. An IP capture with a timestamp, or an
 *   estimated location, or the provider's own jurisdiction. Without one of
 *   these the report cannot be routed and joins the 10 percent.
 * - Timezone-explicit timestamps. Stanford named inconsistent IPs and
 *   timezones. A bare local time is not a time.
 * - An account identifier the recipient can serve process on.
 * - Whether a human reviewed it, per excerpt rather than once.
 * - Excerpt sufficiency. NCMEC names arbitrary limits on enticement chat
 *   excerpts as a top complaint, so a report with one line of context is
 *   flagged even though the API would accept it.
 * - The reviewer's free-text judgment about why this case is not like the
 *   other thousand, which is the field investigators most want and which no
 *   schema field captures.
 * - Model, lexicon and fusion versions plus the audit chain anchor, so two
 *   near-identical reports can be told apart.
 * - Whether the incident type came from anything. NCMEC routes on it, and a
 *   type nothing supports is a routing decision made by a fallback.
 * - The legal basis for the processing, which stops at the bundle boundary
 *   otherwise.
 *
 * Everything it returns names a field or a gap. It never characterises a
 * person (rule 5).
 */

import type { CyberTiplineReport } from "./schema.js";

/**
 * blocking: the report is not filable in a useful state without it.
 * degrading: it will be accepted and it will triage worse.
 * enriching: it makes the report better and its absence is normal.
 */
export const COMPLETENESS_SEVERITIES = ["blocking", "degrading", "enriching"] as const;
export type CompletenessSeverity = (typeof COMPLETENESS_SEVERITIES)[number];

export interface MissingField {
  /** Dotted path into the envelope, so a caller can point the reviewer at it. */
  field: string;
  severity: CompletenessSeverity;
  /** Why this one matters, in one sentence, sourced where there is a source. */
  why: string;
  /** What the filer should go and get. Imperative and concrete. */
  gather: string;
}

export interface CompletenessResult {
  /** 0 to 100. A weighted pass, not a count of fields. */
  score: number;
  /**
   * Whether a recipient could determine where the offense occurred. The single
   * number NCMEC publishes about report quality, so it is its own boolean and
   * not buried in a list.
   */
  jurisdictionDeterminable: boolean;
  /** How jurisdiction was determinable, or why it was not. */
  jurisdictionBasis:
    | "ip_capture_with_timestamp"
    | "estimated_location"
    | "provider_jurisdiction_only"
    | "none";
  missing: MissingField[];
  /** The blocking subset, in the order a reviewer should work through it. */
  blocking: MissingField[];
  /** Short imperative list for the reviewer console. At most six lines. */
  gatherList: string[];
  /** True when nothing blocking and nothing degrading is missing. */
  readyToFile: boolean;
}

const WEIGHT: Record<CompletenessSeverity, number> = {
  blocking: 12,
  degrading: 5,
  enriching: 2,
};

/**
 * An ISO 8601 instant with an explicit offset or a trailing Z. A bare
 * "2026-09-04T11:00:00" is a local time nobody can place, which is exactly the
 * inconsistency Stanford found across platforms.
 */
function hasExplicitOffset(value: string | undefined): boolean {
  if (!value) return false;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim());
}

function looksLikeHashOnly(identifier: string | undefined): boolean {
  if (!identifier) return false;
  return /^[a-f0-9]{32,128}$/i.test(identifier.trim());
}

export function scoreReportCompleteness(report: CyberTiplineReport): CompletenessResult {
  const missing: MissingField[] = [];
  const add = (f: MissingField) => missing.push(f);

  /* ---------------------------------------------------------------------- */
  /* Jurisdiction. The one number NCMEC publishes about report quality.      */
  /* ---------------------------------------------------------------------- */

  const reportedIps = report.personOrUserReported.ipCaptureEvent;
  const victimIps = report.victim?.ipCaptureEvent ?? [];
  const anyIpWithTime = [...reportedIps, ...victimIps].some(
    (e) => e.ipAddress.length > 0 && hasExplicitOffset(e.dateTime),
  );
  const anyIpWithoutTime = [...reportedIps, ...victimIps].some((e) => !hasExplicitOffset(e.dateTime));
  const anyLocation =
    report.personOrUserReported.estimatedLocation?.countryCode !== undefined ||
    report.victim?.estimatedLocation?.countryCode !== undefined;
  const providerJurisdiction = report.jurisdiction?.country !== undefined;

  let jurisdictionBasis: CompletenessResult["jurisdictionBasis"] = "none";
  if (anyIpWithTime) jurisdictionBasis = "ip_capture_with_timestamp";
  else if (anyLocation) jurisdictionBasis = "estimated_location";
  else if (providerJurisdiction) jurisdictionBasis = "provider_jurisdiction_only";

  // The provider's own jurisdiction says where the company is, not where the
  // offense occurred. It is better than nothing and it is not a determination,
  // so it does not make the report routable on its own.
  const jurisdictionDeterminable =
    jurisdictionBasis === "ip_capture_with_timestamp" ||
    jurisdictionBasis === "estimated_location";

  if (!jurisdictionDeterminable) {
    add({
      field: "personOrUserReported.ipCaptureEvent",
      severity: "blocking",
      why: "Nothing in this report says where the offense occurred. More than 10 percent of industry reports in 2025 arrived this way and could not be routed to a jurisdiction.",
      gather:
        "Add at least one IP capture with an ISO 8601 timestamp carrying an explicit offset, or an estimated location with a country code.",
    });
  }
  if (anyIpWithTime && anyIpWithoutTime) {
    add({
      field: "ipCaptureEvent.dateTime",
      severity: "degrading",
      why: "An IP with no timestamp cannot be resolved to a subscriber, because carrier assignments change.",
      gather: "Put an explicit ISO 8601 timestamp with an offset on every IP capture, not just one.",
    });
  }
  if (!providerJurisdiction) {
    add({
      field: "jurisdiction",
      severity: "degrading",
      why: "The provider's own jurisdiction is what tells the recipient which legal process reaches this provider.",
      gather: "Set the provider's ISO 3166-1 country, plus the subdivision where a state rule applies.",
    });
  }
  if (!report.legalBasis) {
    add({
      field: "legalBasis",
      severity: "degrading",
      why: "Under whose authority the traffic was processed is what a defense motion asks first, and the bundle's own pre-flight lists it as required.",
      gather:
        "Record the customer's legal basis on the bundle before building the report. It is a customer relationship fact, not something the kernel can infer.",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Identifiers. Something the recipient can serve process on.             */
  /* ---------------------------------------------------------------------- */

  const reportedId = report.personOrUserReported.espIdentifier;
  if (!reportedId) {
    add({
      field: "personOrUserReported.espIdentifier",
      severity: "blocking",
      why: "A report with no identifier for the reported account gives the recipient nothing to serve legal process on.",
      gather: "Supply the provider's own account identifier for the reported account.",
    });
  } else if (looksLikeHashOnly(reportedId)) {
    add({
      field: "personOrUserReported.espIdentifier",
      severity: "blocking",
      why: "The identifier is a salted hash. It is unique but the recipient cannot resolve it, so it works like no identifier at all.",
      gather:
        "Map the hashed identifier back to the provider's own account id before submitting. Guardian holds only the hash by design.",
    });
  }
  if (
    !report.personOrUserReported.screenName &&
    !report.personOrUserReported.displayName &&
    !report.personOrUserReported.profileUrl
  ) {
    add({
      field: "personOrUserReported.screenName",
      severity: "degrading",
      why: "A screen name is what lets a recipient link this report to another report about the same account.",
      gather: "Add the screen name, display name or profile URL for the reported account.",
    });
  }
  if (!report.victim?.espIdentifier || looksLikeHashOnly(report.victim.espIdentifier)) {
    add({
      field: "victim.espIdentifier",
      severity: "degrading",
      why: "Without a resolvable identifier for the child's account, the recipient cannot reach the person the report exists to protect.",
      gather: "Supply the provider's own account identifier for the receiving account.",
    });
  }
  if (report.victim?.person?.age === undefined && report.victim?.person?.dateOfBirth === undefined) {
    add({
      field: "victim.person.age",
      severity: "degrading",
      why: "Age determines which statute applies and how the report is prioritized.",
      gather:
        "Supply the age the provider holds, or state the age band and how it was established. Guardian stores bands, never birthdates.",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Timestamps. Stanford named inconsistent timezones by name.             */
  /* ---------------------------------------------------------------------- */

  if (!hasExplicitOffset(report.incidentSummary.incidentDateTime)) {
    add({
      field: "incidentSummary.incidentDateTime",
      severity: "blocking",
      why: "A timestamp with no offset is a local time nobody can place, and inconsistent timezones are one of the named reasons reports fail.",
      gather: "Render the incident time as ISO 8601 with an explicit offset or a trailing Z.",
    });
  }
  /* ---------------------------------------------------------------------- */
  /* Incident type. NCMEC routes and prioritises on it.                     */
  /* ---------------------------------------------------------------------- */

  if (report.guardian.incidentTypeSource === "default") {
    add({
      field: "incidentSummary.incidentType",
      severity: "blocking",
      why: "No recorded signal maps to an incident type and no reviewer chose one, so the type on this report is a fallback with nothing behind it. NCMEC routes and prioritises on incidentType, so the report would be categorised by a default rather than by the traffic or by a person.",
      gather:
        "Have the reviewer select the incident type from what they know. Five of the eight types are reachable only that way, because nothing Guardian observes establishes them.",
    });
  }

  const badExcerptTimes = report.excerpts.filter((e) => !hasExplicitOffset(e.ts)).length;
  if (badExcerptTimes > 0) {
    add({
      field: "excerpts[].ts",
      severity: "degrading",
      why: `${badExcerptTimes} excerpt timestamps carry no explicit offset, so the order of events cannot be reconciled against other evidence.`,
      gather: "Render every excerpt timestamp as ISO 8601 with an explicit offset.",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Context. The reason two identical-looking reports diverge.             */
  /* ---------------------------------------------------------------------- */

  const withText = report.excerpts.filter((e) => e.text !== null && e.text.trim().length > 0);
  if (withText.length === 0) {
    add({
      field: "excerpts",
      severity: "blocking",
      why: "A report with no conversation excerpts is a report the recipient cannot assess. Hash-only submissions are one of the named failure modes.",
      gather: "Include the retained conversation excerpts that support the decision.",
    });
  } else if (withText.length < 5) {
    add({
      field: "excerpts",
      severity: "degrading",
      why: "NCMEC names arbitrary limits on enticement chat excerpts as a top complaint. A handful of lines does not show a progression.",
      gather:
        "Include the full retained conversation rather than a truncated window, up to what retention allows.",
    });
  }
  if (report.narrative.trim().length < 200) {
    add({
      field: "narrative",
      severity: "degrading",
      why: "The narrative is what a triaging officer reads first, and its absence is why near-identical reports get opposite outcomes.",
      gather: "Write a narrative describing the observed pattern, the window and the review that happened.",
    });
  }
  if (!report.guardian.reviewerContext) {
    add({
      field: "guardian.reviewerContext",
      severity: "degrading",
      why: "The reviewer's judgment about why this case is not like the other thousand is the field investigators most want and the one no schema captures.",
      gather: "Ask the reviewer for the recommendation note before filing. It is a required field for Guardian, not for NCMEC.",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Human review. The private-search question and the EU derogation.       */
  /* ---------------------------------------------------------------------- */

  if (report.guardian.excerptsViewedByHuman === 0) {
    add({
      field: "guardian.excerptsViewedByHuman",
      severity: "blocking",
      why: "Nothing in this report records that a person read any of it. Regulation (EU) 2026/1881 requires human confirmation before a report, and whether a provider employee viewed the material is the private-search question.",
      gather: "Have the reviewer open the excerpts before filing. The flag is set by that action and by nothing else.",
    });
  } else if (report.guardian.excerptsViewedByHuman < report.guardian.excerptsTotal) {
    add({
      field: "excerpts[].viewedByHuman",
      severity: "enriching",
      why: `${report.guardian.excerptsViewedByHuman} of ${report.guardian.excerptsTotal} excerpts were read by a person. The per-excerpt flags are what let the recipient see exactly which lines that covers.`,
      gather: "No action required. The per-excerpt flags already state which lines a person read.",
    });
  }
  if (!report.guardian.concurringReviewerId) {
    add({
      field: "guardian.concurringReviewerId",
      severity: "degrading",
      why: "The reported tier exists only where a second reviewer concurred, and the report should name both people.",
      gather: "Record the concurring reviewer's id on the decision.",
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Media. Hash plus the operator's verdict, and nothing else.             */
  /* ---------------------------------------------------------------------- */

  for (const [i, m] of report.mediaHashes.entries()) {
    if (m.operatorVerdict === "not_run") {
      add({
        field: `mediaHashes[${i}].operatorVerdict`,
        severity: "degrading",
        why: "A hash with no scanner verdict beside it tells the recipient a file existed and nothing about it.",
        gather:
          "Run the provider's own scanner over the file and record the verdict. Guardian never opens a file and cannot produce this.",
      });
    }
    if (!m.uploadedToEspTimestamp) {
      add({
        field: `mediaHashes[${i}].uploadedToEspTimestamp`,
        severity: "enriching",
        why: "When the file reached the provider bounds the window for a preservation request.",
        gather: "Add the timestamp the file arrived on the provider's systems.",
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Provenance. So two near-identical reports can be told apart.           */
  /* ---------------------------------------------------------------------- */

  if (!report.guardian.auditHead) {
    add({
      field: "guardian.auditHead",
      severity: "degrading",
      why: "The audit chain anchor is what shows the evidence predates any later edit, which is what survives a defense motion.",
      gather: "Anchor the bundle to the audit chain head before building the report.",
    });
  }
  const versionsMissing = [
    report.guardian.modelVersion,
    report.guardian.lexiconVersion,
    report.guardian.fusionVersion,
  ].filter((v) => !v || v.trim().length === 0).length;
  if (versionsMissing > 0) {
    add({
      field: "guardian.modelVersion",
      severity: "degrading",
      why: "Without the version triple, a report cannot be reassessed when a threshold changes, and two reports from different configurations look identical.",
      gather: "Record the model, lexicon and fusion versions on every score row.",
    });
  }
  if (!report.reporter.reportingPerson.email && !report.reporter.reportingPerson.phone) {
    add({
      field: "reporter.reportingPerson.email",
      severity: "blocking",
      why: "The recipient has to be able to reach the reporting provider for follow-up, and an unreachable reporter is a dead report.",
      gather: "Supply an email or phone for the reporting person at the provider.",
    });
  }

  /* ---------------------------------------------------------------------- */

  const penalty = missing.reduce((sum, m) => sum + WEIGHT[m.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const blocking = missing.filter((m) => m.severity === "blocking");
  const degrading = missing.filter((m) => m.severity === "degrading");

  return {
    score,
    jurisdictionDeterminable,
    jurisdictionBasis,
    missing,
    blocking,
    gatherList: [...blocking, ...degrading].slice(0, 6).map((m) => m.gather),
    readyToFile: blocking.length === 0 && degrading.length === 0,
  };
}
