import {
  escalateRetention,
  expiresAt as expiryFor,
  retentionForTier,
  stageSchema,
  textRetainedForTier,
  type AgeBand,
  type AgeBandProvenance,
  type ChannelVisibility,
  type Event,
  type RetentionClass,
  type SignalKind,
  type Stage,
  type TierResult,
} from "@guardian/schema";
import type { Detection } from "./detectors/index.js";
import type { ScoredEvent } from "./kernel.js";

/**
 * Persist one scored event. Writes the events row for (customerId, externalId)
 * and then records the tier on the pair through the kernel store.
 *
 * Rule 7 shapes the events row. Every row carries customerId and a retention
 * class. T0 keeps features only: the text column is written only when
 * textRetainedForTier says the tier keeps it, and the retention class is the
 * higher of what the row already holds and the class for this tier, so a
 * replayed T0 cannot shorten a row an earlier T1 or a reviewer escalated.
 *
 * Media arrives as a sha256 and the operator's verdict and is stored as
 * exactly that (rule 1). Features are the detections with their excerpts
 * capped, never the whole message.
 */

/** Excerpt and matched spans are capped to the same length signalHitSchema allows. */
export const EXCERPT_MAX_CHARS = 280;

export interface EventKey {
  customerId: string;
  externalId: string;
}

/** A detection as it sits in the events.features json column. */
export type StoredDetection = {
  kind: SignalKind;
  stage: Stage;
  weight: number;
  matched: string;
  excerpt: string;
  meta?: JsonObject;
};

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

/** The columns this module reads back before a write. */
export interface EventRow {
  retention: RetentionClass;
  expiresAt: Date;
}

type EventColumns = {
  actorUid: string;
  targetUid: string | null;
  channel: string;
  ts: Date;
  text: string | null;
  mediaSha256: string | null;
  knownCsamVerdict: string | null;
  actorBand: AgeBand;
  targetBand: AgeBand;
  /**
   * The band as captured at event time, with where it came from and how sure
   * the source was (ROADMAP R3). The surface adapter fills these: a Discord
   * band read off a guild role is server_role, one from the guild default is
   * platform_default. An event that states neither is recorded as unknown,
   * which is the honest answer, and a confidence nobody published stays null
   * rather than becoming a zero somebody could read as low.
   */
  actorBandConfidence: number | null;
  actorBandProvenance: AgeBandProvenance;
  targetBandConfidence: number | null;
  targetBandProvenance: AgeBandProvenance;
  /**
   * Null means the customer did not say. Nothing may read that as public:
   * treatAsPrivateMessaging() is the one place that decision is made, and it
   * returns true for null so the stricter Regulation (EU) 2026/1881 rule
   * applies by default.
   */
  channelVisibility: ChannelVisibility | null;
  actorRole: Event["actorRole"];
  features: StoredDetection[];
  stage: Stage | null;
  surface: Event["provenance"]["surface"];
  sourceId: string;
  modelVersion: string;
  lexiconVersion: string;
  fusionVersion: string;
};

type RetentionColumns = {
  retention?: RetentionClass;
  expiresAt?: Date;
};

export type EventCreate = EventKey & EventColumns & { retention: RetentionClass; expiresAt: Date };
export type EventUpdate = Partial<EventColumns> & RetentionColumns;

/**
 * Minimal slice of the generated client this module uses, so tests can pass a
 * fake and the scorer does not depend on the generated types to build.
 */
export interface EventDelegate {
  findUnique(args: {
    where: { customerId_externalId: EventKey };
    select: { retention: true; expiresAt: true };
  }): Promise<EventRow | null>;
  upsert(args: {
    where: { customerId_externalId: EventKey };
    create: EventCreate;
    update: EventUpdate;
  }): Promise<unknown>;
}

export interface EventPersistClient {
  event: EventDelegate;
}

/** The one method of the kernel store this module needs. */
export interface TierRecorder {
  recordTier(customerId: string, actorUid: string, targetUid: string, result: TierResult): Promise<void>;
}

export interface PersistOptions {
  /** Clock, overridable for tests. Drives expiresAt. */
  now?: () => Date;
}

export async function persistScoredEvent(
  db: EventPersistClient,
  store: TierRecorder,
  event: Event,
  scored: ScoredEvent,
  opts: PersistOptions = {},
): Promise<void> {
  const now = opts.now?.() ?? new Date();
  const { result } = scored;
  const key: EventKey = { customerId: event.customerId, externalId: event.externalId };

  const existing = await db.event.findUnique({
    where: { customerId_externalId: key },
    select: { retention: true, expiresAt: true },
  });
  const kept = keepRetention(existing, event, retentionForTier(result.tier), now);

  const columns: Omit<EventColumns, "text"> = {
    actorUid: event.actorUid,
    targetUid: event.targetUid,
    channel: event.channel,
    ts: event.ts,
    mediaSha256: event.media?.sha256 ?? null,
    knownCsamVerdict: event.media?.knownCsamVerdict ?? null,
    actorBand: event.actorBand,
    targetBand: event.targetBand,
    actorBandConfidence: event.actorBandConfidence ?? null,
    actorBandProvenance: event.actorBandProvenance ?? "unknown",
    targetBandConfidence: event.targetBandConfidence ?? null,
    targetBandProvenance: event.targetBandProvenance ?? "unknown",
    channelVisibility: event.channelVisibility ?? null,
    actorRole: event.actorRole,
    features: scored.detections.map(storedDetection),
    stage: stageColumn(scored.stage),
    surface: event.provenance.surface,
    sourceId: event.provenance.sourceId,
    modelVersion: result.versions.modelVersion,
    lexiconVersion: result.versions.lexiconVersion,
    fusionVersion: result.versions.fusionVersion,
  };

  // Text follows the tier on a fresh row. On an existing row that a higher
  // class already protects, a T0 rescore leaves the column alone rather than
  // stripping evidence the ratchet kept.
  const keepText = textRetainedForTier(result.tier);
  const text = keepText ? (event.text ?? null) : null;
  const existingKeepsText = existing !== null && existing.retention !== "EPHEMERAL_24H";
  const textPatch: Pick<EventUpdate, "text"> = keepText || !existingKeepsText ? { text } : {};

  await db.event.upsert({
    where: { customerId_externalId: key },
    create: { ...key, ...columns, text, retention: kept.retention, expiresAt: kept.expiresAt },
    update: { ...columns, ...textPatch, ...kept.patch },
  });

  await store.recordTier(event.customerId, result.pair.actorUid, result.pair.targetUid, result);
}

/**
 * Retention for the write. The class is the higher of what the row holds (or
 * what ingest stamped on the event, for a fresh row) and the floor for this
 * tier. The expiry is the later of the row's current expiry and the one the
 * class implies. events.expiresAt is not nullable, so an open ended class
 * keeps whichever expiry the row or the event already carries; the sweep
 * never deletes a LEGAL_HOLD row whatever the column says. The class is only
 * included in the update patch when it changes, so a concurrent escalation by
 * another writer is not overwritten with a stale value.
 */
function keepRetention(
  existing: EventRow | null,
  event: Event,
  floor: RetentionClass,
  now: Date,
): { retention: RetentionClass; expiresAt: Date; patch: RetentionColumns } {
  const retention = escalateRetention(existing?.retention ?? event.retention, floor);
  const computed = expiryFor(retention, now);
  const current = existing?.expiresAt ?? event.expiresAt;
  const expiresAt =
    computed === null ? current : current.getTime() > computed.getTime() ? current : computed;
  const patch: RetentionColumns = { expiresAt };
  if (!existing || existing.retention !== retention) patch.retention = retention;
  return { retention, expiresAt, patch };
}

function storedDetection(d: Detection): StoredDetection {
  const out: StoredDetection = {
    kind: d.kind,
    stage: d.stage,
    weight: d.weight,
    matched: cap(d.matched),
    excerpt: cap(d.excerpt),
  };
  if (d.meta !== undefined) out.meta = toJsonObject(d.meta);
  return out;
}

function cap(text: string): string {
  return text.length > EXCERPT_MAX_CHARS ? text.slice(0, EXCERPT_MAX_CHARS) : text;
}

/** Only a real stage goes in the column. Anything else reads back as null. */
function stageColumn(stage: string): Stage | null {
  const parsed = stageSchema.safeParse(stage);
  return parsed.success ? parsed.data : null;
}

/** A json round trip drops undefined keys and turns Dates into ISO strings. */
function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
