import { z } from "zod";
import { AGE_BANDS } from "./agebands.js";

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
  "meetup_logistics",
  "actor_fanout",
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
  "meetup_logistics",
  "known_csam_hash",
];

export function isCriticalSignal(kind: SignalKind): boolean {
  return CRITICAL_SIGNALS.includes(kind);
}

/** Where an event came from. Provenance travels with the evidence bundle. */
export const provenanceSchema = z.object({
  surface: z.enum(["discord", "platform_sdk", "parent_app", "investigator"]),
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
  scoredAt: z.coerce.date(),
});
export type TierResult = z.infer<typeof tierResultSchema>;

export const REVIEW_DECISIONS = ["dismiss", "watch", "confirm", "report"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const reviewDecisionSchema = z.enum(REVIEW_DECISIONS);

export const evidenceBundleSchema = z.object({
  bundleId: z.string(),
  customerId: z.string(),
  actorUid: z.string(),
  targetUid: z.string(),
  tier: tierSchema,
  /** Ordered, timestamped excerpts. Text only. No media bytes, ever. */
  timeline: z.array(
    z.object({
      ts: z.coerce.date(),
      channel: z.string(),
      direction: z.enum(["actor_to_target", "target_to_actor"]),
      excerpt: z.string().max(2000).nullable(),
      mediaSha256: z.string().nullable(),
      knownCsamVerdict: z.enum(["match", "no_match", "not_run"]).nullable(),
      stage: stageSchema.nullable(),
      signals: z.array(signalKindSchema),
    }),
  ),
  signals: z.array(signalHitSchema),
  versions: versionsSchema,
  provenance: z.array(provenanceSchema),
  generatedAt: z.coerce.date(),
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
