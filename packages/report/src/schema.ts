/**
 * NCMEC CyberTipline ESP API report envelope.
 *
 * Source of the field names and the enumerations: the public CyberTipline
 * Reporting API technical documentation at
 * https://report.cybertip.org/ispws/documentation. Everything named here that
 * carries an `ncmecVerified: true` note in REPORT_FIELD_PROVENANCE below was
 * read off that page. Everything else is Guardian's own shape and is marked so,
 * because a field nobody verified must not be presented as certain.
 *
 * The API is XML. This module models the envelope as typed data and serializes
 * to XML at the edge (see toReportXml). Modelling it as data first is what lets
 * the completeness scorer reason about it, and what lets the reviewer console
 * show a pre-filled form rather than a blank one.
 *
 * One thing the envelope deliberately cannot express: a file attachment. The
 * API's /upload endpoint takes bytes. Guardian never has bytes (CLAUDE.md rule
 * 1), so a Guardian-built report carries the sha256 and the operator's own
 * scanner verdict in the narrative and in mediaHashes, and the submit sequence
 * skips /upload and /fileinfo entirely.
 */

import { legalBasisSchema } from "@guardian/schema";
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* Incident type taxonomy                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The eight incident types the CyberTipline accepts. Read verbatim off the
 * public API documentation's incidentType enumeration. These strings are the
 * wire values, so they are not reworded here even where Guardian's own copy
 * uses different language.
 */
export const NCMEC_INCIDENT_TYPES = [
  "Child Pornography (possession, manufacture, and distribution)",
  "Child Sex Trafficking",
  "Child Sex Tourism",
  "Child Sexual Molestation",
  "Misleading Domain Name",
  "Misleading Words or Digital Images on the Internet",
  "Online Enticement of Children for Sexual Acts",
  "Unsolicited Obscene Material Sent to a Child",
] as const;
export type NcmecIncidentType = (typeof NCMEC_INCIDENT_TYPES)[number];
export const ncmecIncidentTypeSchema = z.enum(NCMEC_INCIDENT_TYPES);

/**
 * Report-level annotations. Read off the public documentation's
 * reportAnnotations element. Sextortion is an annotation, not an incident type:
 * a sextortion case is reported as online enticement with the sextortion
 * annotation set, which is the answer to "where does sextortion go".
 */
export const NCMEC_REPORT_ANNOTATIONS = [
  "sextortion",
  "csamSolicitation",
  "minorToMinorInteraction",
  "spam",
  "sadisticOnlineExploitation",
  "informational",
  "potentialAggravatingFactors",
  "instrumentalUse",
] as const;
export type NcmecReportAnnotation = (typeof NCMEC_REPORT_ANNOTATIONS)[number];
export const ncmecReportAnnotationSchema = z.enum(NCMEC_REPORT_ANNOTATIONS);

/**
 * The internetDetails variants. Read off the public documentation. Guardian's
 * two shipping surfaces are chat and gaming, so those are the ones the builder
 * ever picks; the rest are here so the envelope is a superset rather than a
 * subset of what the API takes.
 */
export const NCMEC_INCIDENT_CHANNELS = [
  "webPageIncident",
  "emailIncident",
  "newsgroupIncident",
  "chatImIncident",
  "onlineGamingIncident",
  "cellPhoneIncident",
  "nonInternetIncident",
  "peer2peerIncident",
] as const;
export type NcmecIncidentChannel = (typeof NCMEC_INCIDENT_CHANNELS)[number];
export const ncmecIncidentChannelSchema = z.enum(NCMEC_INCIDENT_CHANNELS);

/**
 * Map Guardian's signal kinds onto the taxonomy.
 *
 * The mapping is deliberately narrow, and the reason is worth stating because
 * it looks like an omission otherwise. Guardian's kernel observes text patterns
 * in a conversation. Almost everything it can observe is the enticement shape,
 * and the shapes it cannot observe are left unmapped rather than approximated:
 *
 * - Child Sexual Molestation is a report of abuse that happened. Guardian sees
 *   a plan being discussed, which is enticement, not a contact offense it can
 *   assert occurred.
 * - Child Sex Tourism needs travel across a border for that purpose. No signal
 *   in the catalog establishes travel.
 * - Misleading Domain Name and Misleading Words are about the deceptive naming
 *   of content, which Guardian's lexicon does not evaluate.
 * - Unsolicited Obscene Material Sent to a Child needs the content of what was
 *   sent, and Guardian never holds it.
 * - The CSAM type is reachable only from the operator's own scanner verdict,
 *   never from a signal, because Guardian never opens a file and has no basis
 *   for that assertion.
 *
 * All five stay in the enumeration because a reviewer may select one from facts
 * Guardian does not hold. They are simply not derivable from signals, and
 * deriving them anyway would be Guardian making a claim it cannot support
 * (rule 5). Signal names are the SIGNALS enum in packages/schema.
 */
const SIGNAL_TO_INCIDENT: Partial<Record<string, NcmecIncidentType>> = {
  supervision_probe: "Online Enticement of Children for Sexual Acts",
  off_platform_migration: "Online Enticement of Children for Sexual Acts",
  secrecy_instruction: "Online Enticement of Children for Sexual Acts",
  age_relationship_framing: "Online Enticement of Children for Sexual Acts",
  image_solicitation: "Online Enticement of Children for Sexual Acts",
  threat_template: "Online Enticement of Children for Sexual Acts",
  payment_after_media: "Online Enticement of Children for Sexual Acts",
  coercion_nonfinancial: "Online Enticement of Children for Sexual Acts",
  meetup_logistics: "Online Enticement of Children for Sexual Acts",
  economic_bait: "Online Enticement of Children for Sexual Acts",
};

/**
 * The one combination that is not enticement. An offer of money or goods and a
 * concrete meetup plan together are the commercial shape the trafficking type
 * exists for. Either alone is not: a Robux giveaway is bait, and a meetup ask
 * is enticement, and calling either trafficking on its own would overstate what
 * the traffic shows.
 */
const TRAFFICKING_PAIR = ["economic_bait", "meetup_logistics"] as const;

/**
 * Precedence when several types are candidates. NCMEC takes one incidentType
 * per report, so a report has to choose. The operator-established CSAM verdict
 * outranks everything Guardian inferred, and trafficking outranks enticement
 * because it routes differently inside NCMEC.
 */
const INCIDENT_PRECEDENCE: NcmecIncidentType[] = [
  "Child Pornography (possession, manufacture, and distribution)",
  "Child Sex Trafficking",
  "Child Sex Tourism",
  "Child Sexual Molestation",
  "Online Enticement of Children for Sexual Acts",
  "Unsolicited Obscene Material Sent to a Child",
  "Misleading Domain Name",
  "Misleading Words or Digital Images on the Internet",
];

export interface SignalsToIncidentInput {
  /** Signal kinds recorded on the bundle. */
  signals: readonly string[];
  /**
   * The operator's own scanner verdicts on media hashes in the bundle. Only a
   * match established by the operator can reach the CSAM incident type;
   * Guardian never opens a file and never forms that view itself.
   */
  knownCsamVerdicts?: readonly ("match" | "no_match" | "not_run" | null)[];
  /** Whether both accounts are in a minor band, for the annotation. */
  minorToMinor?: boolean;
}

export interface SignalsToIncidentResult {
  incidentType: NcmecIncidentType;
  annotations: NcmecReportAnnotation[];
  /** Which signal drove the choice, so a reviewer can see why. */
  drivenBy: string[];
  /**
   * False when nothing matched and the incident type is the fallback below.
   * The five unmapped types stay unmapped because deriving them would be
   * Guardian asserting something it cannot support (rule 5), and a defaulted
   * sixth is the same assertion with the same nothing behind it. The fallback
   * still happens, because filing with no type is worse, but it is marked so
   * the completeness scorer can block on it and a reviewer can choose instead.
   */
  derived: boolean;
}

/**
 * Guardian's signals to one incident type plus the annotations that qualify it.
 *
 * Defaults to online enticement rather than to nothing. A T3 bundle that
 * matched no mapped signal still describes a conversation a human confirmed,
 * and filing it with no type is the failure mode this whole package exists to
 * avoid. The default is reported as `derived: false` rather than passed off as
 * a finding: NCMEC routes and prioritises on incidentType, so a report
 * categorised by a fallback has to say that somewhere a filer can see it.
 */
export function signalsToIncidentType(
  input: SignalsToIncidentInput,
): SignalsToIncidentResult {
  const drivenBy: string[] = [];
  const candidates = new Set<NcmecIncidentType>();
  const signalSet = new Set(input.signals);

  for (const signal of input.signals) {
    const mapped = SIGNAL_TO_INCIDENT[signal];
    if (!mapped) continue;
    candidates.add(mapped);
    drivenBy.push(signal);
  }

  if (TRAFFICKING_PAIR.every((s) => signalSet.has(s))) {
    candidates.add("Child Sex Trafficking");
    drivenBy.push(...TRAFFICKING_PAIR);
  }

  const operatorMatch = (input.knownCsamVerdicts ?? []).some((v) => v === "match");
  if (operatorMatch) {
    candidates.add("Child Pornography (possession, manufacture, and distribution)");
    drivenBy.push("operator_known_csam_match");
  }

  const matched = INCIDENT_PRECEDENCE.find((t) => candidates.has(t));
  const incidentType = matched ?? "Online Enticement of Children for Sexual Acts";

  const annotations: NcmecReportAnnotation[] = [];
  // The documented sextortion shape: a demand attached to material already
  // solicited. Both halves are needed, because a demand with no solicitation
  // behind it is a different pattern.
  const demand =
    signalSet.has("threat_template") ||
    signalSet.has("payment_after_media") ||
    signalSet.has("coercion_nonfinancial");
  const solicitation = signalSet.has("image_solicitation");
  if (demand && solicitation) annotations.push("sextortion");
  if (solicitation) annotations.push("csamSolicitation");
  if (input.minorToMinor) annotations.push("minorToMinorInteraction");
  // The non-financial coercion class is the self-harm and marking pattern, not
  // a payment demand. That is what this annotation names.
  if (signalSet.has("coercion_nonfinancial")) annotations.push("sadisticOnlineExploitation");

  return {
    incidentType,
    annotations: [...new Set(annotations)],
    drivenBy,
    derived: matched !== undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* Envelope pieces                                                             */
/* -------------------------------------------------------------------------- */

/**
 * NCMEC's person type. Element names read off the public documentation:
 * firstName, lastName, phone, email, address, age, ageAssertionDiscrepancy,
 * dateOfBirth. Every one is optional here, and Guardian populates none of them
 * from its own state: it stores age bands rather than birthdates (rule 9) and
 * salted hashes rather than names (rule 8). The customer fills these in if they
 * hold them.
 */
export const ncmecPersonSchema = z
  .object({
    firstName: z.string().max(255).optional(),
    lastName: z.string().max(255).optional(),
    phone: z.string().max(255).optional(),
    email: z.string().max(255).optional(),
    address: z.string().max(1000).optional(),
    age: z.number().int().min(0).max(120).optional(),
    /** True when the account's asserted age conflicts with other evidence. */
    ageAssertionDiscrepancy: z.boolean().optional(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "dateOfBirth must be YYYY-MM-DD")
      .optional(),
  })
  .strict();
export type NcmecPerson = z.infer<typeof ncmecPersonSchema>;

/** estimatedLocation. Documented children: city, region, countryCode. */
export const estimatedLocationSchema = z
  .object({
    city: z.string().max(255).optional(),
    /** US state abbreviation when countryCode is US, per the documentation. */
    region: z.string().max(255).optional(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/, "countryCode must be an ISO 3166-1 alpha-2 code")
      .optional(),
  })
  .strict();
export type EstimatedLocation = z.infer<typeof estimatedLocationSchema>;

/**
 * ipCaptureEvent. Documented children: ipAddress, eventName, dateTime,
 * possibleProxy, port. This is the single most load-bearing optional field in
 * the whole schema: it is what makes a report routable to a jurisdiction, and
 * its absence is most of the reason over a tenth of 2025 industry reports could
 * not be routed at all.
 *
 * Guardian does not capture IPs. The customer holds them, and the builder takes
 * them as an input the customer supplies rather than inventing them.
 */
export const ipCaptureEventSchema = z
  .object({
    ipAddress: z.string().min(3).max(255),
    /** What the IP was captured from: "Login", "Upload", "Message Sent". */
    eventName: z.string().max(255).optional(),
    /** ISO 8601 with an explicit offset. A bare local time is not routable. */
    dateTime: z.string().optional(),
    possibleProxy: z.boolean().optional(),
    port: z.number().int().min(0).max(65535).optional(),
  })
  .strict();
export type IpCaptureEvent = z.infer<typeof ipCaptureEventSchema>;

/** Guardian populates espIdentifier, screenName, ipCaptureEvent and the flags. */
export const reportedAccountSchema = z
  .object({
    /**
     * The provider's own identifier for the account. Required in practice:
     * a report with no identifier gives the recipient nothing to serve legal
     * process on. Guardian supplies the salted hash and the customer maps it
     * back to their own id before submission, because a hash NCMEC cannot
     * resolve is the same as no identifier at all.
     */
    espIdentifier: z.string().max(1000).optional(),
    /** Which of the customer's services the account is on. */
    espService: z.string().max(255).optional(),
    screenName: z.string().max(255).optional(),
    displayName: z.string().max(255).optional(),
    profileUrl: z.string().max(1000).optional(),
    profileBio: z.string().max(4000).optional(),
    person: ncmecPersonSchema.optional(),
    ipCaptureEvent: z.array(ipCaptureEventSchema).default([]),
    deviceId: z.array(z.string().max(255)).default([]),
    estimatedLocation: estimatedLocationSchema.optional(),
    compromisedAccount: z.boolean().optional(),
    accountTemporarilyDisabled: z.boolean().optional(),
    accountPermanentlyDisabled: z.boolean().optional(),
    priorCTReports: z.array(z.string().max(255)).default([]),
    additionalInfo: z.string().max(20000).optional(),
  })
  .strict();
export type ReportedAccount = z.infer<typeof reportedAccountSchema>;

/**
 * A media hash and the operator's verdict on it. This is Guardian's whole media
 * story and there is no other one.
 *
 * The API's own file path is /upload, which takes bytes, then /fileinfo, which
 * describes what was uploaded. Guardian calls neither. It never possesses,
 * fetches or transits image or video bytes (CLAUDE.md rule 1, 18 USC 2252A),
 * so a Guardian-built report names the file by hash and says what the
 * operator's scanner said about it, and the operator uploads the bytes
 * themselves from their own systems if they choose to.
 *
 * hashType: the documentation names MD5 and SHA1 as examples with a 64
 * character validation limit on the attribute. SHA256 as a literal accepted
 * value is Guardian's inference, not a verified enumeration, which is why the
 * field is a free string rather than an enum.
 */
export const mediaHashSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/, "sha256 must be 64 lowercase hex characters"),
    hashType: z.string().max(64).default("SHA256"),
    /** The operator's own scanner said this, not Guardian. */
    operatorVerdict: z.enum(["match", "no_match", "not_run"]),
    /** Which scanner produced the verdict, named honestly or left unset. */
    operatorScanner: z.string().max(255).optional(),
    /**
     * fileViewedByEsp in the API. The private-search question turns on this
     * exact fact (US v. Wilson, 9th Cir. 2021, and the circuit split behind
     * it), so it is never set optimistically. Guardian itself never views a
     * file, so this is only ever true when the operator says so.
     */
    fileViewedByEsp: z.boolean().default(false),
    exifViewedByEsp: z.boolean().default(false),
    /** When the file reached the operator's servers, ISO 8601 with an offset. */
    uploadedToEspTimestamp: z.string().optional(),
    publiclyAvailable: z.boolean().optional(),
    /**
     * True when the operator holds the bytes and can upload them themselves.
     * Guardian sets this from what the customer told it and never from its own
     * state, because Guardian's state can only ever say "no bytes here".
     */
    bytesHeldByOperator: z.boolean().default(false),
  })
  .strict();
export type MediaHash = z.infer<typeof mediaHashSchema>;

/** One excerpt as it appears in the report narrative. */
export const reportExcerptSchema = z
  .object({
    /** ISO 8601 with an explicit UTC offset. Never a bare local time. */
    ts: z.string(),
    channel: z.string().max(255),
    direction: z.enum(["actor_to_target", "target_to_actor"]),
    text: z.string().max(4000).nullable(),
    stage: z.string().max(64).nullable(),
    signals: z.array(z.string().max(64)).default([]),
    /**
     * Whether a person on the operator's side actually read this line. Copied
     * from the bundle's per-row flag and never widened. NCMEC and the Stanford
     * 2024 critique both ask whether a human reviewed the material; a report
     * that answers per excerpt answers it better than one that answers once.
     */
    viewedByHuman: z.boolean().default(false),
    mediaSha256: z.string().nullable().default(null),
  })
  .strict();
export type ReportExcerpt = z.infer<typeof reportExcerptSchema>;

/**
 * Guardian's provenance block. None of this is an NCMEC field: it rides in
 * additionalInfo, and it is the part of the report that is the product.
 * Stanford's 2024 finding was that near-identical reports produce opposite
 * outcomes because nothing in a report says how it was reached.
 */
export const guardianProvenanceSchema = z
  .object({
    bundleId: z.string(),
    /** Hash chain head at bundle generation, anchoring the report to the log. */
    auditHead: z.string(),
    modelVersion: z.string(),
    lexiconVersion: z.string(),
    fusionVersion: z.string(),
    /** Reviewer-confirmed tier. Always T3 on a submittable report (rule 6). */
    tier: z.literal("T3"),
    reviewerId: z.string(),
    /** The second reviewer whose concurrence produced T3. */
    concurringReviewerId: z.string().optional(),
    decidedAt: z.string(),
    decision: z.enum(["confirm", "report"]),
    /** The reviewer's free-text note on why this case is not like the others. */
    reviewerContext: z.string().max(4000).optional(),
    excerptsViewedByHuman: z.number().int().min(0),
    excerptsTotal: z.number().int().min(0),
    /**
     * Where the incident type came from. "signals" means a mapped signal drove
     * it, "reviewer" means a person chose it from facts Guardian does not hold,
     * and "default" means nothing matched and the fallback was used. NCMEC
     * routes on incidentType, so a defaulted one is a claim resting on nothing
     * and the completeness scorer blocks on it.
     */
    incidentTypeSource: z.enum(["signals", "reviewer", "default"]).default("default"),
    /** The signals behind the type, empty on a reviewer choice or a default. */
    incidentTypeDrivenBy: z.array(z.string()).default([]),
    /**
     * Whether the output rested on the per-actor score alone. Article 5(1)(d)
     * of Regulation (EU) 2024/1689 turns on it, so it travels with the report.
     */
    soleAutomatedBasis: z.boolean().default(false),
    /**
     * Recorded on every report: this case did not originate with a law
     * enforcement request. US v. Rosenow (9th Cir. 2022) is the reason.
     */
    lawEnforcementRequested: z.boolean().default(false),
  })
  .strict();
export type GuardianProvenance = z.infer<typeof guardianProvenanceSchema>;

/**
 * reporter. Documented children: reportingPerson, contactPerson,
 * companyTemplate, termsOfService, legalURL.
 *
 * The customer is the ESP and the reporter of record under 18 USC 2258A.
 * Guardian files as their agent on their own NCMEC credentials and never on an
 * account of its own, so every field in this block is the customer's.
 */
export const reporterSchema = z
  .object({
    /** The customer's registered ESP name at NCMEC. */
    companyName: z.string().min(1).max(255),
    /** NCMEC-assigned company template name, when the customer has one. */
    companyTemplate: z.string().max(255).optional(),
    reportingPerson: ncmecPersonSchema,
    contactPerson: ncmecPersonSchema.optional(),
    termsOfService: z.string().max(4000).optional(),
    legalURL: z.string().max(1000).optional(),
    /**
     * Guardian's own line in the report. Not an NCMEC field; it rides in
     * additionalInfo so the recipient can tell an agent-filed report from a
     * hand-filed one without guessing.
     */
    filedByAgent: z.string().max(255).default("Guardian, as agent for the reporting provider"),
  })
  .strict();
export type Reporter = z.infer<typeof reporterSchema>;

/** incidentSummary. Documented children, plus Guardian's narrative. */
export const incidentSummarySchema = z
  .object({
    incidentType: ncmecIncidentTypeSchema,
    /** The customer's service name, as NCMEC's platform element. */
    platform: z.string().max(255).optional(),
    /**
     * Documented as escalateToHighPriority. Guardian sets it only on an
     * explicit reviewer escalation with a reason, never from a score.
     */
    escalateToHighPriority: z.boolean().default(false),
    escalationReason: z.string().max(4000).optional(),
    reportAnnotations: z.array(ncmecReportAnnotationSchema).default([]),
    /**
     * ISO 8601 with an explicit offset. The documentation's own minimum, and
     * the field a report cannot be triaged without.
     */
    incidentDateTime: z.string(),
    incidentDateTimeDescription: z.string().max(1000).optional(),
  })
  .strict();
export type IncidentSummary = z.infer<typeof incidentSummarySchema>;

/**
 * The full envelope. NCMEC's own required set is small; Guardian's is larger,
 * because the optional fields are the ones whose absence kills a report.
 * Anything Guardian can populate from a bundle is populated by the builder;
 * anything only the customer holds is optional here and surfaced by the
 * completeness scorer instead of quietly omitted.
 */
export const cyberTiplineReportSchema = z
  .object({
    /** Guardian's own id for the draft, before NCMEC assigns a reportId. */
    draftId: z.string(),
    /**
     * Which customer this report belongs to. Not an NCMEC field and not on the
     * wire: it is here so the reporter of record is bound to the evidence
     * rather than paired with it by argument order. The builder refuses a
     * bundle and a customer that disagree, and the client refuses to submit a
     * report on another customer's credentials (CLAUDE.md rule 8,
     * DESIGN.md 9.2).
     */
    customerId: z.string().min(1),
    /** Which environment this draft is built for. Never defaults to prod. */
    environment: z.enum(["test", "production"]).default("test"),
    reporter: reporterSchema,
    incidentSummary: incidentSummarySchema,
    /** Which internetDetails variant the traffic came from. */
    incidentChannel: ncmecIncidentChannelSchema.default("chatImIncident"),
    /** The account the report is about. Never described as a person. */
    personOrUserReported: reportedAccountSchema,
    /** The account on the receiving side, where the customer identifies one. */
    victim: reportedAccountSchema.optional(),
    /**
     * The narrative NCMEC's analysts and the receiving ICAC unit actually read.
     * Guardian writes it from the bundle and it describes traffic, never a
     * person (CLAUDE.md rule 5).
     */
    narrative: z.string().max(40000),
    excerpts: z.array(reportExcerptSchema).default([]),
    /** Hash plus operator verdict. No bytes, no attachment path. */
    mediaHashes: z.array(mediaHashSchema).default([]),
    guardian: guardianProvenanceSchema,
    /**
     * Copied from the customer, so it cannot be lost in transit. It has no
     * NCMEC element, so it is written into additionalInfo with an explicit
     * label saying it is the provider's own jurisdiction and not the reported
     * account's location.
     */
    jurisdiction: z
      .object({
        country: z.string().regex(/^[A-Z]{2}$/),
        subdivision: z.string().regex(/^[A-Z0-9]{1,3}$/).nullish(),
      })
      .optional(),
    /**
     * Under whose authority the traffic behind this report was processed. The
     * bundle carries it and the bundle's own pre-flight lists it as required,
     * so it travels to the filing rather than stopping at the bundle boundary.
     * No NCMEC element either; it rides in additionalInfo.
     */
    legalBasis: legalBasisSchema.optional(),
    builtAt: z.string(),
  })
  .strict();
export type CyberTiplineReport = z.infer<typeof cyberTiplineReportSchema>;

/* -------------------------------------------------------------------------- */
/* Responses                                                                   */
/* -------------------------------------------------------------------------- */

/** reportResponse. Documented children: responseCode, responseDescription,
 * reportId, fileId, hash. */
export const reportResponseSchema = z
  .object({
    responseCode: z.number().int(),
    responseDescription: z.string().optional(),
    reportId: z.string().optional(),
    fileId: z.string().optional(),
    hash: z.string().optional(),
  })
  .strict();
export type ReportResponse = z.infer<typeof reportResponseSchema>;

/** reportDoneResponse. Documented children: responseCode, reportId, files. */
export const reportDoneResponseSchema = z
  .object({
    responseCode: z.number().int(),
    reportId: z.string().optional(),
    files: z.array(z.string()).default([]),
  })
  .strict();
export type ReportDoneResponse = z.infer<typeof reportDoneResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Provenance of the schema itself                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which parts of this file came off a public source and which are Guardian's.
 * Kept as data rather than prose so a reviewer, or the next owner, can read it
 * without trusting a comment.
 */
export interface FieldProvenance {
  field: string;
  ncmecVerified: boolean;
  note: string;
}

export const REPORT_FIELD_PROVENANCE: readonly FieldProvenance[] = [
  {
    field: "incidentType enumeration",
    ncmecVerified: true,
    note: "Eight values read off the public API documentation's incidentType element.",
  },
  {
    field: "reportAnnotations enumeration",
    ncmecVerified: true,
    note: "Read off the documentation. Sextortion is an annotation, not an incident type.",
  },
  {
    field: "incidentSummary children",
    ncmecVerified: true,
    note: "incidentType, platform, escalateToHighPriority, reportAnnotations, incidentDateTime, incidentDateTimeDescription.",
  },
  {
    field: "reporter children",
    ncmecVerified: true,
    note: "reportingPerson, contactPerson, companyTemplate, termsOfService, legalURL.",
  },
  {
    field: "personOrUserReported children",
    ncmecVerified: true,
    note: "espIdentifier, espService, screenName, displayName, profileUrl, profileBio, ipCaptureEvent, deviceId, estimatedLocation, compromisedAccount, accountTemporarilyDisabled, accountPermanentlyDisabled, priorCTReports, additionalInfo.",
  },
  {
    field: "ipCaptureEvent children",
    ncmecVerified: true,
    note: "ipAddress, eventName, dateTime, possibleProxy, port.",
  },
  {
    field: "estimatedLocation children",
    ncmecVerified: true,
    note: "city, region, countryCode. Region is a US state abbreviation when the country is US.",
  },
  {
    field: "internetDetails variants",
    ncmecVerified: true,
    note: "webPageIncident, emailIncident, newsgroupIncident, chatImIncident, onlineGamingIncident, cellPhoneIncident, nonInternetIncident, peer2peerIncident.",
  },
  {
    field: "response envelopes",
    ncmecVerified: true,
    note: "reportResponse with responseCode, responseDescription, reportId, fileId, hash; reportDoneResponse with responseCode, reportId, files.",
  },
  {
    field: "hashType SHA256",
    ncmecVerified: false,
    note: "Inferred. The documentation names MD5 and SHA1 as examples with a 64 character attribute limit and does not enumerate accepted values, so hashType is a free string here and the default is a guess to be confirmed against the XSD at registration.",
  },
  {
    field: "mediaHashes without an upload",
    ncmecVerified: false,
    note: "Guardian's own shape. The documented file path is /upload with multipart bytes; the documentation describes no hash-only file route, so hashes ride in the narrative and additionalInfo instead. Confirm with NCMEC at registration whether a hash-only fileDetails record is accepted.",
  },
  {
    field: "guardian provenance block",
    ncmecVerified: false,
    note: "Guardian's own. Not an NCMEC element; serialized into additionalInfo. This is the report-quality differentiator, not an API requirement.",
  },
  {
    field: "narrative and excerpts",
    ncmecVerified: false,
    note: "Guardian's own shape. The API carries free text; the structure of what goes in it is a Guardian decision.",
  },
  {
    field: "jurisdiction and legalBasis in additionalInfo",
    ncmecVerified: false,
    note: "Guardian's own. Neither has an NCMEC element, so both are written into additionalInfo under an explicit label. additionalInfo is a child of personOrUserReported, so the jurisdiction line says in words that it is the reporting provider's own jurisdiction and not the reported account's location. If the XSD at GET /xsd turns out to carry a reporter-level element for either, move them there.",
  },
  {
    field: "customerId on the envelope",
    ncmecVerified: false,
    note: "Guardian's own and never on the wire. It binds the evidence to the reporter of record so a report cannot be built from one customer's bundle against another customer's provider identity, or submitted on another customer's credentials (rule 8).",
  },
  {
    field: "XSD cardinality and element ordering",
    ncmecVerified: false,
    note: "Not verified. The XSD at GET /xsd is authoritative and must be read against this module before the first production submission.",
  },
] as const;
