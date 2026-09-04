import { z } from "zod";
import { AGE_BANDS } from "./agebands.js";
import {
  ageBandConfidenceSchema,
  ageBandProvenanceSchema,
  channelVisibilitySchema,
  jurisdictionSchema,
  legalBasisSchema,
} from "./provenance.js";

/** Canonical enums. These mirror packages/schema/prisma/schema.prisma exactly. */

export const ageBandSchema = z.enum(AGE_BANDS);

export const TIERS = ["T0", "T1", "T2", "T3"] as const;
export type Tier = (typeof TIERS)[number];
export const tierSchema = z.enum(TIERS);

/** The model tops out at T2. Only a human reviewer produces T3 (CLAUDE.md rule 6). */
export const MODEL_MAX_TIER: Tier = "T2";

export const RETENTION_CLASSES = ["EPHEMERAL_24H", "WATCH_30D", "CASE_1Y", "LEGAL_HOLD"] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];
export const retentionClassSchema = z.enum(RETENTION_CLASSES);

/** Child Rescue Coalition's six steps plus "none" (DESIGN.md 3). */
export const STAGES = [
  "none",
  "contact",
  "trust",
  "probe",
  "migrate",
  "sexualize",
  "coerce",
] as const;
export type Stage = (typeof STAGES)[number];
export const stageSchema = z.enum(STAGES);

/** Stage index used by the progression term. "none" is not a rung on the ladder. */
export const STAGE_INDEX: Record<Stage, number> = {
  none: 0,
  contact: 1,
  trust: 2,
  probe: 3,
  migrate: 4,
  sexualize: 5,
  coerce: 6,
};

export const SIGNALS = [
  "supervision_probe",
  "off_platform_migration",
  "secrecy_instruction",
  "economic_bait",
  "age_relationship_framing",
  "image_solicitation",
  "threat_template",
  "payment_after_media",
  "coercion_nonfinancial",
  "meetup_logistics",
  "actor_fanout",
  "target_fanin",
  "new_account_burst",
  "alt_cluster",
  "skew_drift",
  "known_csam_hash",
] as const;
export type SignalKind = (typeof SIGNALS)[number];
export const signalKindSchema = z.enum(SIGNALS);

/**
 * Critical signals force tier >= T2 regardless of the fused score
 * (CLAUDE.md "Tiers", DESIGN.md 6.2 crit_override).
 */
export const CRITICAL_SIGNALS: readonly SignalKind[] = [
  "threat_template",
  "payment_after_media",
  "coercion_nonfinancial",
  "meetup_logistics",
  "known_csam_hash",
];

export function isCriticalSignal(kind: SignalKind): boolean {
  return CRITICAL_SIGNALS.includes(kind);
}

/**
 * Which Guardian surface an event arrived on. Named here rather than inline so
 * the evidence timeline can record it per excerpt: a report reader asking
 * where one line came from should not have to infer it from the bundle-level
 * provenance list, which holds the union of every source in the window.
 */
export const SURFACES = ["discord", "platform_sdk", "parent_app", "investigator"] as const;
export type Surface = (typeof SURFACES)[number];
export const surfaceSchema = z.enum(SURFACES);

/** Where an event came from. Provenance travels with the evidence bundle. */
export const provenanceSchema = z.object({
  surface: surfaceSchema,
  /** Opaque to Guardian. The customer's own server/guild/app identifier. */
  sourceId: z.string().min(1).max(128),
  /** Set by the ingest edge, not the customer. */
  receivedAt: z.coerce.date().optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * Media is hash-only (CLAUDE.md rule 1). This schema carries a digest and the
 * operator's own verdict. There is no field for bytes, and ingest rejects any
 * request that tries to smuggle them in.
 */
export const mediaRefSchema = z
  .object({
    /** Lowercase hex. sha256 of the media, computed on the customer's side. */
    sha256: z.string().regex(/^[a-f0-9]{64}$/, "sha256 must be 64 lowercase hex characters"),
    /** PhotoDNA / Safer / Content Safety API verdict, produced by the operator. */
    knownCsamVerdict: z.enum(["match", "no_match", "not_run"]).default("not_run"),
    kind: z.enum(["image", "video", "unknown"]).default("unknown"),
  })
  .strict();
export type MediaRef = z.infer<typeof mediaRefSchema>;

/** Identifiers the customer can supply for alt-account clustering. Hashed at the edge. */
export const deviceHintsSchema = z
  .object({
    deviceIdHash: z.string().max(128).optional(),
    ipHash: z.string().max(128).optional(),
  })
  .strict();

/**
 * How far ahead of the receiving clock an event timestamp may sit. A customer
 * clock is never exactly ours, but an unbounded future ts poisons the pair
 * window and, before retention was moved to receipt time, produced rows that
 * no sweep could ever reach. Backdated events are allowed: a backfill is a
 * legitimate use, and retention is stamped from receipt regardless.
 */
export const MAX_EVENT_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * The canonical Event, as submitted by a customer. Uids here are the customer's
 * own user ids; ingest replaces them with per-customer salted hashes before
 * anything is stored or queued (CLAUDE.md rule 8).
 */
export const inboundEventSchema = z
  .object({
    /** Customer's message id. Used for idempotency. */
    externalId: z.string().min(1).max(128),
    actorUid: z.string().min(1).max(256),
    targetUid: z.string().min(1).max(256).nullish(),
    channel: z.string().min(1).max(128),
    ts: z.coerce
      .date()
      .refine((value) => value.getTime() <= Date.now() + MAX_EVENT_CLOCK_SKEW_MS, {
        message: `ts is more than ${MAX_EVENT_CLOCK_SKEW_MS / 60_000} minutes in the future`,
      }),
    text: z.string().max(8000).nullish(),
    media: mediaRefSchema.nullish(),
    actorBand: ageBandSchema.default("UNKNOWN"),
    targetBand: ageBandSchema.default("UNKNOWN"),
    /**
     * How the band was arrived at, and how sure the source was. Six bands is a
     * moving target: Roblox regrouped accounts into three tiers in June 2026,
     * the Texas and California statutory signals are four brackets, and the EU
     * derogation turns on age difference. The band stays; these two fields are
     * what make it auditable later. Both are optional on the wire so an
     * existing customer integration keeps working, and both land on a stored
     * row with a value (`unknown`, and null for a confidence nobody published).
     */
    actorBandConfidence: ageBandConfidenceSchema.nullish(),
    actorBandProvenance: ageBandProvenanceSchema.nullish(),
    targetBandConfidence: ageBandConfidenceSchema.nullish(),
    targetBandProvenance: ageBandProvenanceSchema.nullish(),
    /**
     * Public, private or group. Absent is read as private by
     * `treatAsPrivateMessaging`, so the stricter rule applies by default.
     */
    channelVisibility: channelVisibilitySchema.nullish(),
    /** Customer-declared trusted role, e.g. a teacher or a paid moderator. */
    actorRole: z.enum(["member", "moderator", "trusted_adult", "unknown"]).default("unknown"),
    actorAccountAgeHours: z.number().nonnegative().nullish(),
    deviceHints: deviceHintsSchema.nullish(),
    provenance: provenanceSchema,
  })
  .strict();
export type InboundEvent = z.infer<typeof inboundEventSchema>;

/** The stored form. Uids are hashed, retention is assigned, provenance is stamped. */
export const eventSchema = inboundEventSchema
  .omit({ actorUid: true, targetUid: true })
  .extend({
    customerId: z.string().min(1),
    actorUid: z.string().min(1),
    targetUid: z.string().min(1).nullable(),
    retention: retentionClassSchema,
    expiresAt: z.coerce.date(),
  })
  .strict();
export type Event = z.infer<typeof eventSchema>;

export const signalHitSchema = z.object({
  kind: signalKindSchema,
  stage: stageSchema,
  weight: z.number(),
  /** Short quoted span from the message. Never the whole message. */
  excerpt: z.string().max(280).optional(),
  /** Which lexicon entry or rule fired, for the reviewer and the audit trail. */
  matched: z.string().max(280).optional(),
  eventExternalId: z.string().optional(),
  /**
   * Set only by a reviewer action, never by the kernel. Report quality and the
   * private-search question both turn on whether a person actually read the
   * material, so the answer is recorded per hit rather than inferred from the
   * fact that a case was opened. A hit written by a scorer is false, and a hit
   * read back from a row written before this field existed parses as false.
   */
  viewedByHuman: z.boolean().default(false),
  ts: z.coerce.date(),
});
export type SignalHit = z.infer<typeof signalHitSchema>;

export const stageProbsSchema = z.record(stageSchema, z.number().min(0).max(1));
export type StageProbs = Partial<Record<Stage, number>>;

/** Version triple recorded on every score row (CLAUDE.md conventions). */
export const versionsSchema = z.object({
  modelVersion: z.string(),
  lexiconVersion: z.string(),
  fusionVersion: z.string(),
});
export type Versions = z.infer<typeof versionsSchema>;

export const pairScoreSchema = z.object({
  customerId: z.string(),
  actorUid: z.string(),
  targetUid: z.string(),
  score: z.number(),
  components: z.object({
    progression: z.number(),
    velocity: z.number(),
    asymmetry: z.number(),
    ageGap: z.number(),
    economic: z.number(),
  }),
  stagesHit: z.array(stageSchema),
  criticalSignals: z.array(signalKindSchema),
  signals: z.array(signalHitSchema),
  windowStart: z.coerce.date(),
  windowEnd: z.coerce.date(),
});
export type PairScore = z.infer<typeof pairScoreSchema>;

export const actorScoreSchema = z.object({
  customerId: z.string(),
  actorUid: z.string(),
  skew: z.number().min(0).max(1),
  fanOut7d: z.number().int().nonnegative(),
  minorFanOut7d: z.number().int().nonnegative(),
  accountAgeHours: z.number().nullable(),
  altClusterSize: z.number().int().nonnegative(),
  score: z.number(),
});
export type ActorScore = z.infer<typeof actorScoreSchema>;

/**
 * Enforcement or support. The account a tier describes is sometimes the one
 * being coerced: Patchin and Hinduja (n=5,568) found perpetrators are
 * disproportionately former victims, and Thorn 2025 found 54 percent of
 * known-contact sextortion perpetrators are themselves minors. The posture
 * routes the action; it is never a statement about a person.
 */
export const SUGGESTED_POSTURES = ["enforcement", "support"] as const;
export type SuggestedPosture = (typeof SUGGESTED_POSTURES)[number];
export const suggestedPostureSchema = z.enum(SUGGESTED_POSTURES);

/** Which of the two escalation windows carried the velocity term (ROADMAP S2). */
export const VELOCITY_WINDOWS = ["fast", "slow", "standard"] as const;
export type VelocityWindow = (typeof VELOCITY_WINDOWS)[number];
export const velocityWindowSchema = z.enum(VELOCITY_WINDOWS);

/**
 * Fan-IN as fusion applied it (ROADMAP S1). A multiplier on the pair term, so
 * a pair with no behavioural signal multiplies to nothing and a popular
 * account is not tiered for being popular.
 */
export const fanInSummarySchema = z.object({
  distinctSources: z.number().int().min(0),
  convergingSources: z.number().int().min(0),
  converging: z.boolean(),
  multiplier: z.number(),
});
export type FanInSummary = z.infer<typeof fanInSummarySchema>;

/**
 * The kernel's output. A tier and the reasons for it. Never a label about a
 * person (CLAUDE.md rule 5): `rationale` describes behaviour in the traffic.
 */
export const tierResultSchema = z.object({
  tier: tierSchema,
  fusedScore: z.number(),
  rationale: z.array(z.string()),
  criticalSignals: z.array(signalKindSchema),
  pair: pairScoreSchema,
  actor: actorScoreSchema,
  versions: versionsSchema,
  producedBy: z.enum(["model", "reviewer"]),
  /**
   * Whether the per-actor score alone stood behind this output, with no
   * conversational fact on the pair. Article 5(1)(d) of Regulation (EU)
   * 2024/1689 prohibits assessing the likelihood of a person offending on the
   * basis of profiling alone; the carve-out is support for human assessment
   * grounded in objective and verifiable facts tied to the conversation. That
   * makes the answer a property of each row, not something to reconstruct from
   * the fusion code a year later. Compute it with `isActorScoreSoleBasis`.
   */
  soleAutomatedBasis: z.boolean().default(false),
  /**
   * What the operator should do with this, before the tier is read as an
   * instruction to enforce (ROADMAP S4). Guardian's fan-out and threat
   * detectors will tier accounts that are themselves in a minor band, and
   * timing a child out is the wrong action. Optional because a row written
   * before fusion emitted it has no honest value to fill in; absent is not
   * "enforcement".
   */
  suggestedPosture: suggestedPostureSchema.optional(),
  /** Referral text shown with the support posture. Null under enforcement. */
  supportReferral: z.string().nullish(),
  /**
   * Which escalation window carried the velocity term, so a reviewer can tell
   * a four hour sprint from a two week campaign (ROADMAP S2).
   */
  velocityWindow: velocityWindowSchema.nullish(),
  /** Convergence on the receiving account as fusion applied it (ROADMAP S1). */
  fanIn: fanInSummarySchema.optional(),
  scoredAt: z.coerce.date(),
});
export type TierResult = z.infer<typeof tierResultSchema>;

/**
 * True when the output rests on the actor score alone: a tier above T0 with no
 * signal recorded on the pair and no critical signal. One definition, used by
 * every surface, so the field means the same thing in every row.
 */
export function isActorScoreSoleBasis(input: {
  tier: Tier;
  pairSignals: readonly SignalHit[];
  criticalSignals: readonly SignalKind[];
}): boolean {
  if (input.tier === "T0") return false;
  return input.pairSignals.length === 0 && input.criticalSignals.length === 0;
}

export const REVIEW_DECISIONS = ["dismiss", "watch", "confirm", "report"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const reviewDecisionSchema = z.enum(REVIEW_DECISIONS);

/* -------------------------------------------------------------------------- */
/* Evidence bundle                                                            */
/*                                                                            */
/* The bundle is a superset of what a CyberTipline report needs, so export is  */
/* a projection rather than a rewrite (RESEARCH.md gap A6, ROADMAP phase 3).   */
/* Every field added for that reason names its consumer. The consumer is       */
/* packages/report unless the comment says otherwise.                          */
/* -------------------------------------------------------------------------- */

/**
 * An age band as it was claimed at event time, with how the claim was made and
 * how sure the source was. Bands, never birthdates (rule 9).
 *
 * Consumer: packages/report. The report asks for the child's age, and a band
 * read off a Discord role is a weaker claim than one from a government ID.
 * Carrying provenance beside the band is what lets the report state which of
 * the two it had instead of presenting both as the same fact.
 */
export const bandClaimSchema = z.object({
  band: ageBandSchema,
  /** Absent means the source published no calibrated number, not a low one. */
  confidence: ageBandConfidenceSchema.nullish(),
  provenance: ageBandProvenanceSchema.default("unknown"),
});
export type BandClaim = z.infer<typeof bandClaimSchema>;

/** One row of the evidence timeline. Text only. No media bytes, ever. */
export const evidenceTimelineRowSchema = z.object({
  ts: z.coerce.date(),
  channel: z.string(),
  direction: z.enum(["actor_to_target", "target_to_actor"]),
  excerpt: z.string().max(2000).nullable(),
  mediaSha256: z.string().nullable(),
  knownCsamVerdict: z.enum(["match", "no_match", "not_run"]).nullable(),
  stage: stageSchema.nullable(),
  signals: z.array(signalKindSchema),
  /**
   * Whether a person actually read this excerpt. False when the bundle is
   * generated, and set only by a reviewer action. A report that says a human
   * reviewed the material has to be able to say which rows, and the
   * private-search question turns on the same fact.
   */
  viewedByHuman: z.boolean().default(false),
  /** Which channel this row came from, for the private messaging rule. */
  channelVisibility: channelVisibilitySchema.nullish(),
  /**
   * This instant in the bundle's timezone, ISO 8601 with the offset that was
   * in force at `ts` (2026-09-02T08:05:00-04:00). Consumer: packages/report.
   * The incident fields are asked in local time, and an offset computed when
   * the report is filed gets the wrong answer for anything on the other side
   * of a daylight-saving boundary. `ts` stays the UTC instant, so ordering and
   * arithmetic are untouched.
   */
  tsLocal: z.string().nullish(),
  /** Minutes east of UTC at `ts`. Consumer: packages/report and any reader rebuilding the timeline. */
  tsOffsetMinutes: z.number().int().nullish(),
  /**
   * Which surface this excerpt arrived on. Consumer: packages/report. The
   * bundle-level provenance list is the union of every source in the window,
   * so it cannot answer the per-line question.
   */
  surface: surfaceSchema.nullish(),
  /**
   * Bands as claimed at event time for the two accounts on this pair.
   * Consumer: packages/report, which needs the child's age and the age gap.
   * Null where the surface stated no band, which is different from a band of
   * unknown provenance.
   */
  actorAge: bandClaimSchema.nullish(),
  targetAge: bandClaimSchema.nullish(),
});
export type EvidenceTimelineRow = z.infer<typeof evidenceTimelineRowSchema>;

/**
 * Who files, and under whose name. The customer is the electronic service
 * provider and the reporter of record under 18 USC 2258A; Guardian is their
 * agent and files as their agent, never on its own account (DESIGN.md 9.2).
 *
 * Consumer: packages/report, which puts this in the reporting-provider section
 * and needs to know whether it is submitting through the customer's ESP
 * credentials or drafting a bundle the customer submits themselves.
 */
export const REPORT_FILING_MODES = ["guardian_as_agent", "customer_direct"] as const;
export type ReportFilingMode = (typeof REPORT_FILING_MODES)[number];
export const reportFilingModeSchema = z.enum(REPORT_FILING_MODES);

export const reporterOfRecordSchema = z.object({
  /** The reporter of record. Always the customer, never Guardian. */
  customerId: z.string(),
  /** The provider's name as registered with NCMEC. Null until registration. */
  providerName: z.string().max(200).nullish(),
  /** The customer's NCMEC ESP identifier, once they have one. */
  espId: z.string().max(128).nullish(),
  /**
   * Defaults to the customer filing directly, because that is the only mode
   * that works with no ESP registration behind it. Agent filing is set only
   * where the customer has one and has asked Guardian to use it.
   */
  filingMode: reportFilingModeSchema.default("customer_direct"),
  /**
   * Whether the customer has a named point of contact on file for reports.
   * Guardian holds the flag, not the contact details.
   */
  contactOnFile: z.boolean().default(false),
});
export type ReporterOfRecord = z.infer<typeof reporterOfRecordSchema>;

/**
 * The reviewer decision this bundle rests on. Present only once a person has
 * decided; a bundle the kernel generated carries null, which is the honest
 * answer and the one that keeps rule 6 checkable from the bundle alone.
 *
 * Consumer: packages/report, which may build a report only from a
 * reviewer-confirmed T3, and apps/review, which shows the same context back.
 */
export const reviewerContextSchema = z.object({
  /** Salted-hashed reviewer id, on the same scheme as every other uid. */
  reviewerId: z.string(),
  reviewId: z.string().nullish(),
  decision: reviewDecisionSchema,
  /** The tier the model had reached when the reviewer opened the case. */
  modelTier: tierSchema,
  /** The tier the decision produced. Only a human ever puts T3 here. */
  resultTier: tierSchema,
  decidedAt: z.coerce.date(),
  /** Local time of the decision, with the offset in force. See `tsLocal`. */
  decidedAtLocal: z.string().nullish(),
  decidedAtOffsetMinutes: z.number().int().nullish(),
  reasonCode: z.string().max(120).nullish(),
  /** What the reviewer wrote, verbatim. The recommendation reaches the report. */
  notes: z
    .object({
      timeline: z.string().nullish(),
      outsideContext: z.string().nullish(),
      recommendation: z.string().nullish(),
    })
    .nullish(),
  /**
   * How many excerpts this reviewer marked as read. A count of what a person
   * actually opened, which is the private-search question, and never a pace
   * measure for the reviewer.
   */
  viewedExcerptCount: z.number().int().min(0).nullish(),
  /** The second reviewer on a concurrence. T3 exists only where there is one. */
  concurringReviewerId: z.string().nullish(),
});
export type ReviewerContext = z.infer<typeof reviewerContextSchema>;

/**
 * The fields a CyberTipline report needs, in the vocabulary the bundle can
 * answer. Over a tenth of industry reports in 2025 lacked enough data to
 * determine jurisdiction, and NCMEC now names the companies that file them, so
 * the gap is computed when the bundle is generated and shown to the reviewer
 * before filing rather than discovered after.
 *
 * Consumer: packages/report and the reviewer console.
 */
export const REPORT_FIELDS = [
  "reporter_identity",
  "reporter_contact",
  "reporter_jurisdiction",
  "legal_basis",
  "incident_timezone",
  "incident_time_range",
  "reported_account_identifier",
  "reported_account_ip_capture",
  "child_account_identifier",
  "child_age_band",
  "chat_excerpts",
  "media_hash",
  "media_scanner_verdict",
  "human_review_confirmation",
  "reviewer_narrative",
  "audit_chain_anchor",
  "model_versions",
] as const;
export type ReportField = (typeof REPORT_FIELDS)[number];
export const reportFieldSchema = z.enum(REPORT_FIELDS);

/**
 * filled: the bundle can answer it.
 * empty: the report needs it and the bundle cannot answer it.
 * not_applicable: this bundle has nothing the field applies to, such as a
 *   media hash on a conversation with no media event. Kept distinct from empty
 *   so a text-only case does not read as an incomplete one.
 */
export const REPORT_FIELD_STATUSES = ["filled", "empty", "not_applicable"] as const;
export type ReportFieldStatus = (typeof REPORT_FIELD_STATUSES)[number];
export const reportFieldStatusSchema = z.enum(REPORT_FIELD_STATUSES);

export const reportFieldCompletenessSchema = z.object({
  field: reportFieldSchema,
  status: reportFieldStatusSchema,
  /** What is missing, or what the filer still has to supply. Never about a person. */
  note: z.string().max(280).nullish(),
});
export type ReportFieldCompleteness = z.infer<typeof reportFieldCompletenessSchema>;

export const reportCompletenessSchema = z.object({
  fields: z.array(reportFieldCompletenessSchema),
  /** The subset with status empty, so a caller does not have to filter. */
  missing: z.array(reportFieldSchema),
  /** True when nothing the report needs is empty. */
  complete: z.boolean(),
});
export type ReportCompleteness = z.infer<typeof reportCompletenessSchema>;

export const evidenceBundleSchema = z.object({
  bundleId: z.string(),
  customerId: z.string(),
  actorUid: z.string(),
  targetUid: z.string(),
  tier: tierSchema,
  /** Ordered, timestamped excerpts. Text only. No media bytes, ever. */
  timeline: z.array(evidenceTimelineRowSchema),
  signals: z.array(signalHitSchema),
  versions: versionsSchema,
  provenance: z.array(provenanceSchema),
  /**
   * Copied from the customer at generation time. Over a tenth of industry
   * CyberTipline reports in 2025 lacked enough data to determine jurisdiction,
   * and a bundle that carries its own answer cannot lose it in transit.
   */
  jurisdiction: jurisdictionSchema.nullish(),
  legalBasis: legalBasisSchema.nullish(),
  /**
   * Who files and under whose name. Consumer: packages/report.
   */
  reporter: reporterOfRecordSchema,
  /**
   * The IANA zone every `tsLocal` in this bundle was rendered in. Consumer:
   * packages/report, which asks for local time, and any reader rebuilding the
   * timeline. Named on the bundle so one zone governs the whole document.
   */
  timezone: z.string().min(1).default("UTC"),
  /**
   * Whether the zone above came from the customer or is Guardian's fallback.
   * A bundle rendered in UTC because nobody said otherwise is not the same
   * claim as one rendered in the customer's own zone, and the completeness
   * block reports the difference rather than hiding it.
   */
  timezoneSource: z.enum(["customer", "default_utc"]).default("default_utc"),
  generatedAt: z.coerce.date(),
  /** `generatedAt` in `timezone`, ISO 8601 with the offset in force. */
  generatedAtLocal: z.string().nullish(),
  generatedAtOffsetMinutes: z.number().int().nullish(),
  /**
   * The reviewer decision behind this bundle, or null where the kernel
   * generated it and nobody has decided yet. Consumer: packages/report, which
   * may build a report only from a reviewer-confirmed T3 (rule 6).
   */
  reviewer: reviewerContextSchema.nullish(),
  /**
   * Which report-required fields this bundle can fill and which it cannot,
   * computed at generation time. Consumer: packages/report and the reviewer
   * console, so the gap is visible before filing rather than after.
   */
  completeness: reportCompletenessSchema,
  retention: retentionClassSchema,
  /** Hash chain head at generation time, so the bundle is anchored to the log. */
  auditHead: z.string(),
});
export type EvidenceBundle = z.infer<typeof evidenceBundleSchema>;

/** What the customer receives on their webhook. */
export const webhookPayloadSchema = z.object({
  event: z.literal("tier.assigned"),
  customerId: z.string(),
  actorUid: z.string(),
  targetUid: z.string(),
  tier: tierSchema,
  rationale: z.array(z.string()),
  criticalSignals: z.array(signalKindSchema),
  versions: versionsSchema,
  scoredAt: z.coerce.date(),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
