import {
  escalateRetention,
  expiresAt as expiryFor,
  retentionForTier,
  signalHitSchema,
  textRetainedForTier,
  type AgeBand,
  type RetentionClass,
  type SignalHit,
  type SignalKind,
  type Stage,
  type SuggestedPosture,
  type Tier,
  type TierResult,
} from "@guardian/schema";
import type { PrismaClient } from "@guardian/schema/db";
import type { ActorState, InboundContact } from "./actor.js";
import type { PairState } from "./pair.js";
import type { KernelStore } from "./store.js";

/**
 * Postgres-backed kernel store over the pairs and actors tables.
 *
 * PairState to the pairs table:
 *   actorBand, targetBand, actorMessages, targetMessages,
 *   actorQuestions, knownCsamMatch,
 *   recentExternalIds                   -> messageCounts (json)
 *   firstStageAt                        -> firstStageAt (json, stage to ISO time)
 *   signals                             -> signals (json, ts held as an ISO string)
 *   lastInboundMediaAt                  -> lastInboundMediaAt
 *   firstSeenAt, lastSeenAt             -> windowStart, windowEnd
 *
 * ActorState to the actors table:
 *   actorBand                           -> ageBand
 *   role, accountAgeHours, hints        -> same names
 *   firstSeenAt, lastSeenAt             -> firstSeen, lastSeen (null leaves the column default)
 *   daily, contactsByDay, minorContactsByDay,
 *   recentOutboundTs, outboundBurstMax1h,
 *   inbound                              -> graphState (json)
 *
 * Every write sets customerId and a retention class (CLAUDE.md rule 7). State
 * writes use WATCH_30D with an expiry 30 days from the write. Retention only
 * ratchets up: a row that already holds a higher class keeps it, and its
 * expiry is never moved earlier.
 *
 * The first write of a pair also creates a stub actor row for any side not yet
 * observed, so the target's age band is on record even if the target never
 * sends a message. There is no foreign key from pairs to actors (an actor row
 * expires on its own clock and must not take a pair with it), so the stub is a
 * convenience rather than a requirement. A stub has no graphState and reads
 * back as null from getActor until putActor fills it in. The customer row must
 * already exist; this store does not create it.
 */

export interface PairKey {
  customerId: string;
  actorUid: string;
  targetUid: string;
}

export interface ActorKey {
  customerId: string;
  hashedUid: string;
}

/** Shape of the pairs.messageCounts json column. */
export type MessageCounts = {
  actorMessages: number;
  targetMessages: number;
  actorQuestions: number;
  knownCsamMatch: boolean;
  actorBand: AgeBand;
  targetBand: AgeBand;
  /** Replay window. Absent on rows written before it existed. */
  recentExternalIds?: string[];
};

/** SignalHit as it sits in the pairs.signals json column: ts is an ISO string. */
export type StoredSignal = {
  kind: SignalKind;
  stage: Stage;
  weight: number;
  excerpt?: string;
  matched?: string;
  eventExternalId?: string;
  ts: string;
  /**
   * Set only by a reviewer action. Absent on a row written before the field
   * existed, and signalHitSchema fills those back as false, which is the
   * honest answer: nobody is on record as having read it.
   */
  viewedByHuman?: boolean;
};

/** Shape of the actors.graphState json column. */
export type GraphState = {
  daily: Record<string, { messages: number; flagged: number }>;
  contactsByDay: Record<string, string[]>;
  minorContactsByDay: Record<string, string[]>;
  recentOutboundTs: string[];
  outboundBurstMax1h: number;
  /**
   * The inbound half of the graph (ROADMAP S1). Absent on a row written before
   * the field existed, which hydrates as an empty list.
   */
  inbound?: InboundContact[];
};

/** The columns this store reads back from pairs. */
export interface PairRow {
  customerId: string;
  actorUid: string;
  targetUid: string;
  /** Last tier recorded on this pair. Absent on a row written before it existed. */
  tier?: Tier | null;
  firstStageAt: unknown;
  signals: unknown;
  messageCounts: unknown;
  lastInboundMediaAt: Date | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  retention: RetentionClass;
  expiresAt: Date | null;
}

/** The columns this store reads back from actors. */
export interface ActorRow {
  customerId: string;
  hashedUid: string;
  ageBand: AgeBand;
  role: ActorState["role"];
  accountAgeHours: number | null;
  firstSeen: Date;
  lastSeen: Date;
  graphState: unknown;
  hints: string[];
  actionedAt: Date | null;
  retention: RetentionClass;
  expiresAt: Date | null;
}

type PairStateColumns = {
  firstStageAt: Partial<Record<Stage, string>>;
  signals: StoredSignal[];
  messageCounts?: MessageCounts;
  lastInboundMediaAt?: Date | null;
  windowStart?: Date | null;
  windowEnd?: Date | null;
};

type PairScoreColumns = {
  pairScore?: number;
  actorScore?: number;
  fusedScore?: number;
  tier?: Tier;
  criticalSignals?: SignalKind[];
  /** Article 5(1)(d) evidence, computed by isActorScoreSoleBasis in fusion. */
  soleAutomatedBasis?: boolean;
  /** Enforcement or support, as fusion emitted it (ROADMAP S4). */
  suggestedPosture?: SuggestedPosture | null;
  modelVersion?: string;
  lexiconVersion?: string;
  fusionVersion?: string;
};

type RetentionColumns = {
  retention?: RetentionClass;
  expiresAt?: Date | null;
};

export type PairCreate = PairKey &
  PairStateColumns &
  PairScoreColumns & { retention: RetentionClass; expiresAt: Date | null };
export type PairUpdate = Partial<PairStateColumns> & PairScoreColumns & RetentionColumns;

type ActorStateColumns = {
  ageBand: AgeBand;
  role: ActorState["role"];
  accountAgeHours: number | null;
  firstSeen?: Date;
  lastSeen?: Date;
  graphState: GraphState;
  hints: string[];
};

export type ActorCreate = ActorKey &
  Partial<ActorStateColumns> & { ageBand: AgeBand; retention: RetentionClass; expiresAt: Date | null };
export type ActorUpdate = Partial<ActorStateColumns> & RetentionColumns;

/** Per-actor score columns, refreshed by recordTier. */
export type ActorScoreColumns = {
  skewScore: number;
  fanOut7d: number;
  minorFanOut7d: number;
};

/**
 * Minimal slice of the generated client this store uses, so tests can pass a
 * fake and the scorer does not depend on the generated types to build.
 */
export interface PairDelegate {
  findUnique(args: { where: { customerId_actorUid_targetUid: PairKey } }): Promise<PairRow | null>;
  upsert(args: {
    where: { customerId_actorUid_targetUid: PairKey };
    create: PairCreate;
    update: PairUpdate;
  }): Promise<unknown>;
}

export interface ActorDelegate {
  findUnique(args: { where: { customerId_hashedUid: ActorKey } }): Promise<ActorRow | null>;
  upsert(args: {
    where: { customerId_hashedUid: ActorKey };
    create: ActorCreate;
    update: ActorUpdate;
  }): Promise<unknown>;
  findMany(args: {
    where: { customerId: string; actionedAt: { not: null } };
    select: { hints: true };
  }): Promise<Array<{ hints: string[] }>>;
  updateMany(args: { where: ActorKey; data: ActorScoreColumns }): Promise<{ count: number }>;
}

export interface KernelStoreClient {
  pair: PairDelegate;
  actor: ActorDelegate;
}

export interface PrismaKernelStoreOptions {
  /** Clock, overridable for tests. Drives expiresAt. */
  now?: () => Date;
}

export class PrismaKernelStore implements KernelStore {
  private readonly now: () => Date;

  constructor(
    private readonly client: KernelStoreClient,
    opts: PrismaKernelStoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  /**
   * Entry point for the generated client. Exists so the delegate shapes above
   * are checked against the real client at compile time.
   */
  static fromClient(client: PrismaClient, opts?: PrismaKernelStoreOptions): PrismaKernelStore {
    return new PrismaKernelStore(client, opts);
  }

  async getPair(customerId: string, actorUid: string, targetUid: string): Promise<PairState | null> {
    const row = await this.client.pair.findUnique({
      where: { customerId_actorUid_targetUid: { customerId, actorUid, targetUid } },
    });
    return row ? pairStateFromRow(row) : null;
  }

  async putPair(
    customerId: string,
    actorUid: string,
    targetUid: string,
    state: PairState,
  ): Promise<void> {
    const now = this.now();
    const key: PairKey = { customerId, actorUid, targetUid };
    const existing = await this.client.pair.findUnique({ where: { customerId_actorUid_targetUid: key } });
    if (!existing) {
      await this.ensureActor(customerId, actorUid, state.actorBand, now);
      await this.ensureActor(customerId, targetUid, state.targetBand, now);
    }
    // Quoted spans follow the tier, the way event text does. A pair the model
    // has only ever scored T0 keeps its numeric trajectory for the 30 days the
    // kernel needs, and none of the child's words (CLAUDE.md rule 7).
    await this.upsertPair(key, existing, pairColumns(state, existing), "WATCH_30D", now);
  }

  async getActor(customerId: string, actorUid: string): Promise<ActorState | null> {
    const row = await this.client.actor.findUnique({
      where: { customerId_hashedUid: { customerId, hashedUid: actorUid } },
    });
    return row ? actorStateFromRow(row) : null;
  }

  async putActor(customerId: string, actorUid: string, state: ActorState): Promise<void> {
    const now = this.now();
    const key: ActorKey = { customerId, hashedUid: actorUid };
    const existing = await this.client.actor.findUnique({ where: { customerId_hashedUid: key } });
    const kept = keepRetention(existing, "WATCH_30D", now);
    const columns = actorColumns(state);
    await this.client.actor.upsert({
      where: { customerId_hashedUid: key },
      create: { ...key, ...columns, retention: kept.retention, expiresAt: kept.expiresAt },
      update: { ...columns, ...kept.patch },
    });
  }

  async bannedHints(customerId: string): Promise<Set<string>> {
    const rows = await this.client.actor.findMany({
      where: { customerId, actionedAt: { not: null } },
      select: { hints: true },
    });
    const out = new Set<string>();
    for (const row of rows) for (const hint of row.hints) out.add(hint);
    return out;
  }

  /**
   * Record a scored tier on the pair row and refresh the actor's score
   * columns. Retention rises to retentionForTier(tier) and never falls. The
   * pair is normally written by putPair first; if it is missing the row is
   * created with empty state so the score is not lost.
   */
  async recordTier(
    customerId: string,
    actorUid: string,
    targetUid: string,
    result: TierResult,
  ): Promise<void> {
    if (result.tier === "T3" && result.producedBy !== "reviewer") {
      throw new Error(
        "recordTier: tier T3 can only be recorded from a reviewer decision (CLAUDE.md rule 6)",
      );
    }
    const now = this.now();
    const key: PairKey = { customerId, actorUid, targetUid };
    const existing = await this.client.pair.findUnique({ where: { customerId_actorUid_targetUid: key } });
    if (!existing) {
      await this.ensureActor(customerId, actorUid, "UNKNOWN", now);
      await this.ensureActor(customerId, targetUid, "UNKNOWN", now);
    }
    const columns: PairScoreColumns & Pick<PairStateColumns, "windowStart" | "windowEnd"> = {
      pairScore: result.pair.score,
      actorScore: result.actor.score,
      fusedScore: result.fusedScore,
      tier: result.tier,
      criticalSignals: [...result.criticalSignals],
      soleAutomatedBasis: result.soleAutomatedBasis,
      // ROADMAP S4. Without this the posture dies with the request and the
      // reviewer queue has no way to recompute it: the bands it derives from
      // are on the event, not on the pair.
      suggestedPosture: result.suggestedPosture ?? null,
      windowStart: new Date(result.pair.windowStart),
      windowEnd: new Date(result.pair.windowEnd),
      modelVersion: result.versions.modelVersion,
      lexiconVersion: result.versions.lexiconVersion,
      fusionVersion: result.versions.fusionVersion,
    };
    await this.upsertPair(key, existing, columns, retentionForTier(result.tier), now);
    await this.client.actor.updateMany({
      where: { customerId, hashedUid: actorUid },
      data: {
        skewScore: result.actor.skew,
        fanOut7d: result.actor.fanOut7d,
        minorFanOut7d: result.actor.minorFanOut7d,
      },
    });
  }

  private async upsertPair(
    key: PairKey,
    existing: PairRow | null,
    columns: Partial<PairStateColumns> & PairScoreColumns,
    floor: RetentionClass,
    now: Date,
  ): Promise<void> {
    const kept = keepRetention(existing, floor, now);
    await this.client.pair.upsert({
      where: { customerId_actorUid_targetUid: key },
      create: {
        ...key,
        firstStageAt: {},
        signals: [],
        ...columns,
        retention: kept.retention,
        expiresAt: kept.expiresAt,
      },
      update: { ...columns, ...kept.patch },
    });
  }

  /** Put the side on record without touching an existing actor row. */
  private async ensureActor(
    customerId: string,
    hashedUid: string,
    band: AgeBand,
    now: Date,
  ): Promise<void> {
    const key: ActorKey = { customerId, hashedUid };
    await this.client.actor.upsert({
      where: { customerId_hashedUid: key },
      create: { ...key, ageBand: band, retention: "WATCH_30D", expiresAt: expiryFor("WATCH_30D", now) },
      update: {},
    });
  }
}

/**
 * Retention for a write. The class is the higher of what the row holds and
 * the floor for this write, and the expiry is the later of the row's current
 * expiry and the one implied by that class. The class is only included in the
 * update patch when it changes, so a concurrent escalation by another writer
 * is not overwritten with a stale value.
 */
function keepRetention(
  existing: { retention: RetentionClass; expiresAt: Date | null } | null,
  floor: RetentionClass,
  now: Date,
): { retention: RetentionClass; expiresAt: Date | null; patch: RetentionColumns } {
  const retention = escalateRetention(existing?.retention ?? floor, floor);
  const computed = expiryFor(retention, now);
  const current = existing?.expiresAt ?? null;
  const expiresAt =
    computed === null ? null : current && current.getTime() > computed.getTime() ? current : computed;
  const patch: RetentionColumns = { expiresAt };
  if (!existing || existing.retention !== retention) patch.retention = retention;
  return { retention, expiresAt, patch };
}

/**
 * Pair state as columns. Signal excerpts are the one part of this that is raw
 * message text, so they are written only while the pair's own tier retains
 * text. Excerpts already stored are left alone: a pair that reached T2 and has
 * since fallen back does not lose the words that put it there.
 */
function pairColumns(state: PairState, existing: PairRow | null): PairStateColumns {
  const keepText = textRetainedForTier(existing?.tier ?? "T0");
  const alreadyStored = keepText ? new Set<string>() : storedSignalKeys(existing);
  return {
    firstStageAt: { ...state.firstStageAt },
    signals: state.signals.map((hit) => {
      const stored = storedSignal(hit);
      return keepText || alreadyStored.has(signalKey(stored)) ? stored : withoutText(stored);
    }),
    messageCounts: {
      actorMessages: state.actorMessages,
      targetMessages: state.targetMessages,
      actorQuestions: state.actorQuestions,
      knownCsamMatch: state.knownCsamMatch,
      actorBand: state.actorBand,
      targetBand: state.targetBand,
      recentExternalIds: [...state.recentExternalIds],
    },
    lastInboundMediaAt: toDate(state.lastInboundMediaAt),
    windowStart: toDate(state.firstSeenAt),
    windowEnd: toDate(state.lastSeenAt),
  };
}

function pairStateFromRow(row: PairRow): PairState {
  const counts: Partial<MessageCounts> = isObject(row.messageCounts)
    ? (row.messageCounts as Partial<MessageCounts>)
    : {};
  return {
    actorBand: counts.actorBand ?? "UNKNOWN",
    targetBand: counts.targetBand ?? "UNKNOWN",
    actorMessages: counts.actorMessages ?? 0,
    targetMessages: counts.targetMessages ?? 0,
    actorQuestions: counts.actorQuestions ?? 0,
    firstStageAt: isObject(row.firstStageAt) ? { ...(row.firstStageAt as Partial<Record<Stage, string>>) } : {},
    signals: signalHitSchema.array().parse(Array.isArray(row.signals) ? row.signals : []),
    lastInboundMediaAt: row.lastInboundMediaAt?.toISOString() ?? null,
    knownCsamMatch: counts.knownCsamMatch ?? false,
    firstSeenAt: row.windowStart?.toISOString() ?? null,
    lastSeenAt: row.windowEnd?.toISOString() ?? null,
    recentExternalIds: Array.isArray(counts.recentExternalIds)
      ? counts.recentExternalIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

function actorColumns(state: ActorState): ActorStateColumns {
  const columns: ActorStateColumns = {
    ageBand: state.actorBand,
    role: state.role,
    accountAgeHours: state.accountAgeHours,
    hints: [...state.hints],
    graphState: {
      daily: { ...state.daily },
      contactsByDay: { ...state.contactsByDay },
      minorContactsByDay: { ...state.minorContactsByDay },
      recentOutboundTs: [...state.recentOutboundTs],
      outboundBurstMax1h: state.outboundBurstMax1h,
      inbound: [...(state.inbound ?? [])],
    },
  };
  const firstSeen = toDate(state.firstSeenAt);
  const lastSeen = toDate(state.lastSeenAt);
  if (firstSeen) columns.firstSeen = firstSeen;
  if (lastSeen) columns.lastSeen = lastSeen;
  return columns;
}

/** A row without graphState is a stub written to satisfy a foreign key; it has no state yet. */
function actorStateFromRow(row: ActorRow): ActorState | null {
  if (!isObject(row.graphState)) return null;
  const graph = row.graphState as Partial<GraphState>;
  return {
    actorBand: row.ageBand,
    role: row.role,
    accountAgeHours: row.accountAgeHours,
    firstSeenAt: row.firstSeen.toISOString(),
    lastSeenAt: row.lastSeen.toISOString(),
    daily: { ...(graph.daily ?? {}) },
    contactsByDay: { ...(graph.contactsByDay ?? {}) },
    minorContactsByDay: { ...(graph.minorContactsByDay ?? {}) },
    hints: [...row.hints],
    outboundBurstMax1h: graph.outboundBurstMax1h ?? 0,
    recentOutboundTs: [...(graph.recentOutboundTs ?? [])],
    inbound: [...(graph.inbound ?? [])],
  };
}

/** Identity of one stored signal, for deciding whether its text is already on the row. */
function signalKey(signal: StoredSignal): string {
  return `${signal.kind}|${signal.eventExternalId ?? ""}|${signal.ts}`;
}

function storedSignalKeys(existing: PairRow | null): Set<string> {
  const keys = new Set<string>();
  if (!existing || !Array.isArray(existing.signals)) return keys;
  for (const signal of existing.signals as StoredSignal[]) {
    if (isObject(signal) && typeof signal.excerpt === "string") keys.add(signalKey(signal));
  }
  return keys;
}

function withoutText(signal: StoredSignal): StoredSignal {
  const { excerpt: _excerpt, matched: _matched, ...rest } = signal;
  return rest;
}

function storedSignal(hit: SignalHit): StoredSignal {
  const out: StoredSignal = {
    kind: hit.kind,
    stage: hit.stage,
    weight: hit.weight,
    ts: new Date(hit.ts).toISOString(),
  };
  if (hit.excerpt !== undefined) out.excerpt = hit.excerpt;
  if (hit.matched !== undefined) out.matched = hit.matched;
  if (hit.eventExternalId !== undefined) out.eventExternalId = hit.eventExternalId;
  // A flag a reviewer set has to survive a persist and a reload, or the
  // per-excerpt human-viewed record is only as durable as one worker's memory.
  if (hit.viewedByHuman) out.viewedByHuman = true;
  return out;
}

function toDate(iso: string | null): Date | null {
  return iso ? new Date(iso) : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
