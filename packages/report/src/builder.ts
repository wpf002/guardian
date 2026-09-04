/**
 * Build a CyberTipline report envelope from an evidence bundle.
 *
 * Five refusals are the point of this module, and all of them throw rather than
 * returning a degraded report, because a report is a legal filing and a
 * half-built one is worse than none.
 *
 * 1. Rule 6. A report may be built only from a reviewer-confirmed T3. The model
 *    tops out at T2, and T3 comes from exactly one code path,
 *    apps/review/src/lib/decisions.ts. This module checks the tier and the
 *    reviewer decision behind it and refuses anything else.
 * 2. Rule 1. Media is hash-only. A timeline row that carries media with no
 *    sha256 is a row Guardian cannot describe honestly, so the build refuses
 *    rather than filing a report with a gap where the file identifier goes.
 * 3. Rule 8 and the reporter of record. The bundle and the customer are two
 *    arguments, and if they name different customers the filing takes its
 *    evidence from one provider and its identity, credentials and contact
 *    person from another. That is a cross-customer join at the one point that
 *    produces a federal filing, so the ids have to agree (DESIGN.md 9.2).
 * 4. Rule 1 again, over free text. Reviewer notes never cross the ingest edge,
 *    so nothing else scans them. A data URI or a long base64 run in a note
 *    would be copied into the narrative and POSTed to the CyberTipline, which
 *    is Guardian transiting bytes.
 * 5. Rule 5. The reviewer's own words go into the narrative verbatim. The
 *    Discord mod alert is guarded and this is the higher-stakes surface, so the
 *    same guard runs here. The reviewer console refuses the note at write time;
 *    this is the backstop, and it names the field rather than the report.
 *
 * There is no attachment path here and no upload step, on purpose. The
 * CyberTipline API's file route is POST /upload with multipart bytes, then
 * /fileinfo. Guardian never possesses, fetches, stores or transits image or
 * video bytes (CLAUDE.md rule 1; 18 USC 2252A has no detection exception), so
 * it cannot call /upload and does not. A Guardian-built report names each file
 * by its sha256 and carries the operator's own scanner verdict beside it. If
 * the operator holds the bytes and wants them in the report, they upload them
 * from their own systems under their own credentials; Guardian's envelope
 * records that choice in bytesHeldByOperator and never acts on it.
 *
 * Everything this module writes describes traffic, a field or a gap. Nothing it
 * writes characterises a person (rule 5).
 */

import {
  findAccusations,
  findMediaBytesInText,
  type EvidenceBundle,
  type ReviewerContext,
} from "@guardian/schema";
import {
  cyberTiplineReportSchema,
  signalsToIncidentType,
  type CyberTiplineReport,
  type MediaHash,
  type NcmecIncidentChannel,
  type NcmecIncidentType,
  type ReportExcerpt,
  type ReportedAccount,
  type Reporter,
} from "./schema.js";

/**
 * A refusal to build. Carries a code so a caller can branch without matching on
 * message text, and a message a reviewer can read.
 */
export class ReportRefused extends Error {
  constructor(
    readonly code:
      | "not_t3"
      | "no_reviewer_decision"
      | "wrong_decision"
      | "reviewer_mismatch"
      | "media_row_without_hash"
      | "no_reporter_identity"
      | "customer_mismatch"
      | "media_bytes_in_text"
      | "accusatory_language",
    message: string,
  ) {
    super(message);
    this.name = "ReportRefused";
  }
}

/**
 * What the customer supplies. Guardian holds none of it in its own state: the
 * customer is the electronic service provider and the reporter of record under
 * 18 USC 2258A, and Guardian files as their agent on their credentials or
 * drafts a bundle they file themselves.
 */
export interface ReportCustomer {
  customerId: string;
  /** The provider name as registered with NCMEC. */
  providerName: string;
  companyTemplate?: string;
  /** The person at the customer who is the reporter of record. */
  reportingPerson: Reporter["reportingPerson"];
  contactPerson?: Reporter["contactPerson"];
  termsOfService?: string;
  legalURL?: string;
  /** The customer's service name, for the platform element. */
  platform?: string;
  /** Which internetDetails variant the traffic came from. */
  incidentChannel?: NcmecIncidentChannel;
  /**
   * Identifiers and IP captures the customer holds and Guardian does not.
   * Guardian stores salted hashes (rule 8) and no IP addresses at all, so the
   * routable identifiers can only come from here.
   */
  reportedAccount?: Partial<ReportedAccount>;
  victimAccount?: Partial<ReportedAccount>;
  /** Which scanner produced the operator's media verdicts, where named. */
  mediaScanner?: string;
  /** True where the operator holds the bytes and can upload them themselves. */
  bytesHeldByOperator?: boolean;
  /** Test unless the caller says otherwise, everywhere in this package. */
  environment?: "test" | "production";
}

export interface BuildReportOptions {
  now?: Date;
  /**
   * The incident type a reviewer selected. Set only from an explicit human
   * choice, never from a score: five of the eight types are not derivable from
   * anything Guardian observes, and a reviewer holding facts Guardian does not
   * is the only route to them. When this is absent and no signal maps either,
   * the envelope records the type as defaulted and the completeness scorer
   * blocks the filing until somebody chooses.
   */
  incidentType?: NcmecIncidentType;
  /** Set only on an explicit reviewer escalation, never from a score. */
  escalateToHighPriority?: boolean;
  escalationReason?: string;
  /** Excerpt cap in the report. Higher than the bundle's, on purpose: NCMEC
   * names arbitrary truncation of enticement chat as a top complaint. */
  maxExcerpt?: number;
}

/** ISO 8601 with an explicit offset. A bare local time is not triageable. */
function iso(d: Date): string {
  return d.toISOString();
}

/**
 * A report may be built only from a reviewer-confirmed T3 (rule 6). Confirm and
 * report are the two decisions that mean a person looked and agreed; dismiss
 * and watch are not, and neither is the absence of a decision.
 */
function assertReviewerConfirmedT3(
  bundle: EvidenceBundle,
  reviewerDecision: ReviewerContext,
): void {
  if (bundle.tier !== "T3") {
    throw new ReportRefused(
      "not_t3",
      `Report refused: the bundle is at tier ${bundle.tier}. A CyberTipline report is built only from a reviewer-confirmed T3, and the model tops out at T2 (CLAUDE.md rule 6).`,
    );
  }
  if (reviewerDecision.resultTier !== "T3") {
    throw new ReportRefused(
      "not_t3",
      `Report refused: the reviewer decision produced tier ${reviewerDecision.resultTier}, not T3. Only a second reviewer's concurrence produces T3.`,
    );
  }
  if (reviewerDecision.decision !== "confirm" && reviewerDecision.decision !== "report") {
    throw new ReportRefused(
      "wrong_decision",
      `Report refused: the reviewer decision was "${reviewerDecision.decision}". Only confirm or report may become a filing.`,
    );
  }
  // A bundle that carries its own reviewer block and disagrees with the one
  // handed in is two different accounts of the same decision. Refuse rather
  // than picking one, because the report asserts which person decided.
  const onBundle = bundle.reviewer;
  if (onBundle && onBundle.reviewerId !== reviewerDecision.reviewerId) {
    throw new ReportRefused(
      "reviewer_mismatch",
      "Report refused: the bundle records a different reviewer than the decision handed in. The report has to name one, so it names neither.",
    );
  }
}

/**
 * Rule 1 as a build-time check. A row that carries media has to carry the hash
 * that identifies it, because the hash is the only thing Guardian ever has and
 * a report that mentions a file it cannot name is not usable.
 */
function assertEveryMediaRowHashed(bundle: EvidenceBundle): void {
  bundle.timeline.forEach((row, index) => {
    // Three ways a row can say it carried media: a scanner verdict, the
    // known-CSAM signal, or the hash itself. The first two without the third
    // are the case this refuses, because a row can announce a media event and
    // still arrive with no identifier for it.
    const carriesMedia =
      row.knownCsamVerdict !== null || row.signals.includes("known_csam_hash");
    if (carriesMedia && !row.mediaSha256) {
      throw new ReportRefused(
        "media_row_without_hash",
        `Report refused: timeline row ${index} at ${iso(row.ts)} carries a media event with no sha256. Media is hash-only (CLAUDE.md rule 1) and a report cannot name a file it has no hash for.`,
      );
    }
  });
}

/**
 * The bundle and the customer are handed in separately, so the build has to
 * check they are the same customer. Everything identifying in the filing comes
 * off the customer argument (the registered provider name, the reporting person
 * who is the 2258A reporter of record, the ESP identifiers, the IP captures)
 * while the excerpts, the hashes and the audit anchor come off the bundle. A
 * transposed argument or a console holding several customers would otherwise
 * file one provider's traffic under another provider's name, on their
 * credentials, with their contact named as the reporter.
 *
 * The comparison keys on customerId rather than on the provider name, because
 * the bundle's reporter block carries the name only where a customer row holds
 * one and it is nullish in the schema.
 */
function assertOneCustomer(bundle: EvidenceBundle, customer: ReportCustomer): void {
  if (customer.customerId !== bundle.customerId) {
    throw new ReportRefused(
      "customer_mismatch",
      `Report refused: the evidence bundle belongs to customer ${bundle.customerId} and the reporter of record given is customer ${customer.customerId}. A report names one provider, and the provider it names has to be the one whose service the traffic was on (CLAUDE.md rule 8, DESIGN.md 9.2).`,
    );
  }
  if (bundle.reporter.customerId !== bundle.customerId) {
    throw new ReportRefused(
      "customer_mismatch",
      `Report refused: the bundle's reporter of record is customer ${bundle.reporter.customerId} and the bundle itself belongs to customer ${bundle.customerId}. The bundle disagrees with itself about who files, so nothing here can be filed.`,
    );
  }
}

/**
 * Rule 1 over free text, which the ingest edge never sees.
 *
 * apps/ingest/src/media-guard.ts scans customer-submitted events. Reviewer
 * notes are typed into the console and stored as free text, and the customer's
 * own profileBio and additionalInfo arrive as arguments here. Every one of them
 * is copied into the narrative, into additionalInfo and into the POST body. So
 * the whole assembled envelope is scanned rather than a hand-picked list of
 * fields, and the refusal names the path.
 */
function assertNoMediaBytes(report: unknown): void {
  const found = findMediaBytesInText(report);
  if (found.length === 0) return;
  const first = found[0]!;
  throw new ReportRefused(
    "media_bytes_in_text",
    `Report refused: ${first.at} ${first.detail}. Guardian never accepts, stores or transits image or video bytes, and a report it submits cannot carry them either (CLAUDE.md rule 1; 18 USC 2252A has no detection exception). A report names a file by its sha256 and the operator's own scanner verdict.`,
  );
}

/**
 * Rule 5 over the strings a person wrote.
 *
 * The narrative and additionalInfo are assembled from templates plus reviewer
 * free text. The templates are covered by the source scan in
 * packages/schema/test/language.test.ts, which reads quoted literals and cannot
 * see anything typed at runtime. apps/discord-bot guards its mod-channel embed
 * this way; the federal filing is the higher-stakes surface and gets the same
 * guard. Named per field, so a refusal tells the reviewer which note to reword
 * rather than discarding the filing with no explanation.
 */
function assertNoAccusationIn(value: string | null | undefined, field: string): void {
  if (!value) return;
  const findings = findAccusations(value);
  if (findings.length === 0) return;
  const first = findings[0]!;
  throw new ReportRefused(
    "accusatory_language",
    `Report refused: ${field} contains "${first.match}", which ${first.why}. Guardian emits a risk tier and an evidence bundle and never labels a person (CLAUDE.md rule 5). Instead: ${first.instead}. Reword the note in the reviewer console; the decision itself stands.`,
  );
}

function toExcerpts(bundle: EvidenceBundle, maxExcerpt: number): ReportExcerpt[] {
  return bundle.timeline.map((row) => ({
    ts: iso(row.ts),
    channel: row.channel,
    direction: row.direction,
    text: row.excerpt === null ? null : row.excerpt.slice(0, maxExcerpt),
    stage: row.stage ?? null,
    signals: [...row.signals],
    // Copied per row and never widened. A report that says a human reviewed
    // the material has to be able to say which lines.
    viewedByHuman: row.viewedByHuman === true,
    mediaSha256: row.mediaSha256 ?? null,
  }));
}

function toMediaHashes(bundle: EvidenceBundle, customer: ReportCustomer): MediaHash[] {
  const seen = new Map<string, MediaHash>();
  for (const row of bundle.timeline) {
    if (!row.mediaSha256) continue;
    const sha256 = row.mediaSha256.toLowerCase();
    if (seen.has(sha256)) continue;
    seen.set(sha256, {
      sha256,
      hashType: "SHA256",
      operatorVerdict: row.knownCsamVerdict ?? "not_run",
      ...(customer.mediaScanner ? { operatorScanner: customer.mediaScanner } : {}),
      // Guardian never opens a file, so this is only ever true where the
      // operator said so. It is never set from Guardian's own state.
      fileViewedByEsp: false,
      exifViewedByEsp: false,
      bytesHeldByOperator: customer.bytesHeldByOperator === true,
    });
  }
  return [...seen.values()];
}

function account(
  hashedUid: string,
  supplied: Partial<ReportedAccount> | undefined,
): ReportedAccount {
  return {
    // Guardian's identifier is a per-customer salted hash (rule 8). It is here
    // so the report is never empty of an identifier, and the customer's own
    // espIdentifier overrides it, because a hash NCMEC cannot resolve is the
    // same as no identifier at all.
    espIdentifier: supplied?.espIdentifier ?? hashedUid,
    ipCaptureEvent: supplied?.ipCaptureEvent ?? [],
    deviceId: supplied?.deviceId ?? [],
    priorCTReports: supplied?.priorCTReports ?? [],
    ...(supplied?.espService ? { espService: supplied.espService } : {}),
    ...(supplied?.screenName ? { screenName: supplied.screenName } : {}),
    ...(supplied?.displayName ? { displayName: supplied.displayName } : {}),
    ...(supplied?.profileUrl ? { profileUrl: supplied.profileUrl } : {}),
    ...(supplied?.profileBio ? { profileBio: supplied.profileBio } : {}),
    ...(supplied?.person ? { person: supplied.person } : {}),
    ...(supplied?.estimatedLocation ? { estimatedLocation: supplied.estimatedLocation } : {}),
    ...(supplied?.compromisedAccount !== undefined
      ? { compromisedAccount: supplied.compromisedAccount }
      : {}),
    ...(supplied?.accountTemporarilyDisabled !== undefined
      ? { accountTemporarilyDisabled: supplied.accountTemporarilyDisabled }
      : {}),
    ...(supplied?.accountPermanentlyDisabled !== undefined
      ? { accountPermanentlyDisabled: supplied.accountPermanentlyDisabled }
      : {}),
    ...(supplied?.additionalInfo ? { additionalInfo: supplied.additionalInfo } : {}),
  };
}

/**
 * The narrative NCMEC's analysts and the receiving ICAC unit read. Written from
 * the bundle, describing traffic and never a person (rule 5).
 */
function narrative(
  bundle: EvidenceBundle,
  reviewerDecision: ReviewerContext,
  media: MediaHash[],
): string {
  const first = bundle.timeline[0];
  const last = bundle.timeline[bundle.timeline.length - 1];
  const window =
    first && last ? `${iso(first.ts)} to ${iso(last.ts)}` : "no messages retained in this bundle";
  const viewed = bundle.timeline.filter((r) => r.viewedByHuman === true).length;
  const signalKinds = [...new Set(bundle.signals.map((s) => s.kind))];

  const lines: string[] = [
    "Summary of the reported conversation.",
    "",
    `Observation window (UTC): ${window}. Messages retained in this bundle: ${bundle.timeline.length}. Timestamps in this report are ISO 8601 with an explicit offset; the bundle's local rendering zone is ${bundle.timezone} (${bundle.timezoneSource === "customer" ? "the provider's own zone" : "UTC, because the provider stated no zone"}).`,
    "",
    `Patterns recorded in the traffic: ${signalKinds.length > 0 ? signalKinds.join(", ") : "none recorded"}.`,
    "",
    `Human review: a reviewer employed by or acting for the reporting provider read ${viewed} of ${bundle.timeline.length} retained excerpts and recorded a decision of "${reviewerDecision.decision}" on ${iso(reviewerDecision.decidedAt)}. The reported tier was produced by that person, not by a model: the automated kernel that surfaced this conversation cannot produce the reported tier at all.`,
  ];

  const recommendation = reviewerDecision.notes?.recommendation;
  if (recommendation) {
    lines.push("", `Reviewer's contextual note: ${recommendation}`);
  }
  const timelineNote = reviewerDecision.notes?.timeline;
  if (timelineNote) {
    lines.push("", `What in the timeline supports this: ${timelineNote}`);
  }

  if (media.length > 0) {
    lines.push(
      "",
      `Media: ${media.length} file ${media.length === 1 ? "hash is" : "hashes are"} listed. The reporting system that produced this report does not accept, store, fetch or transit image or video bytes, so each file is identified by its SHA-256 digest and by the verdict the reporting provider's own scanner returned. No file content accompanies this report from that system. Where the reporting provider holds the bytes, they may supply them separately under their own credentials.`,
    );
  } else {
    lines.push("", "Media: no media event appears in this conversation.");
  }

  lines.push(
    "",
    `Provenance: model ${bundle.versions.modelVersion}, lexicon ${bundle.versions.lexiconVersion}, fusion ${bundle.versions.fusionVersion}. Audit chain head at bundle generation: ${bundle.auditHead}. Bundle id: ${bundle.bundleId}.`,
    "",
    "This report describes patterns observed in traffic on the reporting provider's service and a human reviewer's decision about them. It is not a determination about any person.",
  );

  return lines.join("\n");
}

/**
 * Build the envelope. Throws ReportRefused rather than returning a partial
 * report; a caller that wants to know what is missing before it commits should
 * call scoreReportCompleteness on the result.
 */
export function buildReport(
  bundle: EvidenceBundle,
  customer: ReportCustomer,
  reviewerDecision: ReviewerContext,
  options: BuildReportOptions = {},
): CyberTiplineReport {
  assertReviewerConfirmedT3(bundle, reviewerDecision);
  assertOneCustomer(bundle, customer);
  assertEveryMediaRowHashed(bundle);

  // Before the strings are assembled, so the refusal names the field a person
  // wrote rather than a position inside a narrative they never see.
  assertNoAccusationIn(reviewerDecision.notes?.recommendation, "the reviewer's recommendation note");
  assertNoAccusationIn(reviewerDecision.notes?.timeline, "the reviewer's timeline note");
  assertNoAccusationIn(reviewerDecision.notes?.outsideContext, "the reviewer's outside-context note");
  assertNoAccusationIn(options.escalationReason, "the escalation reason");

  if (!customer.providerName.trim()) {
    throw new ReportRefused(
      "no_reporter_identity",
      "Report refused: no provider name. The customer is the reporter of record under 18 USC 2258A and the report cannot be filed anonymously by their agent.",
    );
  }

  const now = options.now ?? new Date();
  const maxExcerpt = options.maxExcerpt ?? 4000;
  const media = toMediaHashes(bundle, customer);

  const minorToMinor =
    bundle.timeline.some((r) => r.actorAge?.band !== undefined && isMinorBand(r.actorAge.band)) &&
    bundle.timeline.some((r) => r.targetAge?.band !== undefined && isMinorBand(r.targetAge.band));

  const derivedIncident = signalsToIncidentType({
    signals: bundle.signals.map((s) => s.kind),
    knownCsamVerdicts: media.map((m) => m.operatorVerdict),
    minorToMinor,
  });

  // A reviewer may select a type from facts Guardian does not hold, which is
  // the only route to the five that stay unmapped. Their choice outranks the
  // derivation; the fallback outranks nothing and says so.
  const incidentType: NcmecIncidentType = options.incidentType ?? derivedIncident.incidentType;
  const incidentTypeSource = options.incidentType
    ? "reviewer"
    : derivedIncident.derived
      ? "signals"
      : "default";

  const first = bundle.timeline[0];

  const report: CyberTiplineReport = {
    draftId: `rpt_${bundle.bundleId}`,
    customerId: bundle.customerId,
    // Test unless the caller is explicit. Nothing in this package reaches
    // production by omission.
    environment: customer.environment ?? "test",
    reporter: {
      companyName: customer.providerName,
      ...(customer.companyTemplate ? { companyTemplate: customer.companyTemplate } : {}),
      reportingPerson: customer.reportingPerson,
      ...(customer.contactPerson ? { contactPerson: customer.contactPerson } : {}),
      ...(customer.termsOfService ? { termsOfService: customer.termsOfService } : {}),
      ...(customer.legalURL ? { legalURL: customer.legalURL } : {}),
      filedByAgent:
        bundle.reporter.filingMode === "guardian_as_agent"
          ? "Filed by the provider's reporting agent on the provider's credentials"
          : "Prepared for the provider to file directly",
    },
    incidentSummary: {
      incidentType,
      ...(customer.platform ? { platform: customer.platform } : {}),
      escalateToHighPriority: options.escalateToHighPriority === true,
      ...(options.escalationReason ? { escalationReason: options.escalationReason } : {}),
      reportAnnotations: derivedIncident.annotations,
      incidentDateTime: first ? iso(first.ts) : iso(bundle.generatedAt),
      incidentDateTimeDescription: first
        ? "First retained message in the reported conversation."
        : "No messages retained; the timestamp is the bundle generation time.",
    },
    incidentChannel: customer.incidentChannel ?? "chatImIncident",
    personOrUserReported: account(bundle.actorUid, customer.reportedAccount),
    victim: account(bundle.targetUid, customer.victimAccount),
    narrative: narrative(bundle, reviewerDecision, media),
    excerpts: toExcerpts(bundle, maxExcerpt),
    mediaHashes: media,
    guardian: {
      bundleId: bundle.bundleId,
      auditHead: bundle.auditHead,
      modelVersion: bundle.versions.modelVersion,
      lexiconVersion: bundle.versions.lexiconVersion,
      fusionVersion: bundle.versions.fusionVersion,
      tier: "T3",
      reviewerId: reviewerDecision.reviewerId,
      ...(reviewerDecision.concurringReviewerId
        ? { concurringReviewerId: reviewerDecision.concurringReviewerId }
        : {}),
      decidedAt: iso(reviewerDecision.decidedAt),
      decision: reviewerDecision.decision === "report" ? "report" : "confirm",
      ...(reviewerDecision.notes?.recommendation
        ? { reviewerContext: reviewerDecision.notes.recommendation }
        : {}),
      excerptsViewedByHuman: bundle.timeline.filter((r) => r.viewedByHuman === true).length,
      excerptsTotal: bundle.timeline.length,
      incidentTypeSource,
      incidentTypeDrivenBy: incidentTypeSource === "signals" ? [...new Set(derivedIncident.drivenBy)] : [],
      soleAutomatedBasis: false,
      lawEnforcementRequested: false,
    },
    ...(bundle.jurisdiction
      ? {
          jurisdiction: {
            country: bundle.jurisdiction.country,
            subdivision: bundle.jurisdiction.subdivision ?? null,
          },
        }
      : {}),
    ...(bundle.legalBasis ? { legalBasis: bundle.legalBasis } : {}),
    builtAt: iso(now),
  };

  // Over the assembled envelope rather than a list of fields, so a byte-shaped
  // string is caught wherever the customer or the reviewer put it.
  assertNoMediaBytes(report);

  // Validate the envelope against its own schema before it leaves the builder,
  // so a shape error surfaces here rather than at the API boundary.
  return cyberTiplineReportSchema.parse(report);
}

/**
 * The bands that are under 18. Bands, never birthdates (rule 9). UNKNOWN is not
 * a minor band: an unstated age is not a claim, and reading it as one would put
 * a minorToMinorInteraction annotation on a report nobody established.
 */
const MINOR_BANDS = new Set(["UNDER_9", "A9_12", "A13_15", "A16_17"]);

function isMinorBand(band: string): boolean {
  return MINOR_BANDS.has(band);
}
