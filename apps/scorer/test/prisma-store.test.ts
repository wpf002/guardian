import type { Tier, TierResult } from "@guardian/schema";
import { describe, expect, it } from "vitest";
import { emptyActorState, observeActor, type ActorState } from "../src/actor.js";
import type { PairState } from "../src/pair.js";
import {
  PrismaKernelStore,
  type ActorDelegate,
  type ActorRow,
  type PairDelegate,
  type PairRow,
} from "../src/prisma-store.js";

/**
 * In-memory fakes with Postgres write semantics: an undefined field is left
 * alone, a json column loses Dates and undefined keys on the way in, and the
 * schema defaults apply on create.
 */

const NOW = new Date("2026-09-03T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const CUS = "cus_a";
const ACTOR = "actor-hash";
const TARGET = "target-hash";

type Row = Record<string, unknown>;

const JSON_COLUMNS = new Set(["firstStageAt", "signals", "messageCounts", "graphState"]);

function applyWrite(target: Row, data: object): void {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    target[k] = JSON_COLUMNS.has(k) ? JSON.parse(JSON.stringify(v)) : v;
  }
}

const PAIR_DEFAULTS: Row = {
  pairScore: 0,
  actorScore: 0,
  fusedScore: 0,
  tier: "T0",
  criticalSignals: [],
  messageCounts: null,
  lastInboundMediaAt: null,
  windowStart: null,
  windowEnd: null,
  modelVersion: null,
  lexiconVersion: null,
  fusionVersion: null,
  retention: "EPHEMERAL_24H",
  expiresAt: null,
  resolvedAt: null,
};

const ACTOR_DEFAULTS: Row = {
  ageBand: "UNKNOWN",
  role: "unknown",
  accountAgeHours: null,
  skewScore: 0,
  fanOut7d: 0,
  minorFanOut7d: 0,
  graphState: null,
  hints: [],
  actionedAt: null,
  retention: "WATCH_30D",
  expiresAt: null,
};

class FakePairs implements PairDelegate {
  readonly rows = new Map<string, Row>();
  lastUpsert: Parameters<PairDelegate["upsert"]>[0] | null = null;

  async findUnique(args: Parameters<PairDelegate["findUnique"]>[0]): Promise<PairRow | null> {
    const row = this.rows.get(pairKey(args.where.customerId_actorUid_targetUid));
    return row ? ({ ...row } as unknown as PairRow) : null;
  }

  async upsert(args: Parameters<PairDelegate["upsert"]>[0]): Promise<unknown> {
    this.lastUpsert = args;
    const key = pairKey(args.where.customerId_actorUid_targetUid);
    const existing = this.rows.get(key);
    if (existing) {
      applyWrite(existing, args.update);
      return existing;
    }
    const row: Row = { ...PAIR_DEFAULTS, createdAt: NOW };
    applyWrite(row, args.create);
    this.rows.set(key, row);
    return row;
  }

  row(customerId = CUS, actorUid = ACTOR, targetUid = TARGET): Row {
    const row = this.rows.get(pairKey({ customerId, actorUid, targetUid }));
    if (!row) throw new Error("no pair row");
    return row;
  }

  seed(row: Row): void {
    const full: Row = { ...PAIR_DEFAULTS, firstStageAt: {}, signals: [], ...row };
    this.rows.set(
      pairKey({
        customerId: full.customerId as string,
        actorUid: full.actorUid as string,
        targetUid: full.targetUid as string,
      }),
      full,
    );
  }
}

class FakeActors implements ActorDelegate {
  readonly rows = new Map<string, Row>();

  async findUnique(args: Parameters<ActorDelegate["findUnique"]>[0]): Promise<ActorRow | null> {
    const row = this.rows.get(actorKey(args.where.customerId_hashedUid));
    return row ? ({ ...row } as unknown as ActorRow) : null;
  }

  async upsert(args: Parameters<ActorDelegate["upsert"]>[0]): Promise<unknown> {
    const key = actorKey(args.where.customerId_hashedUid);
    const existing = this.rows.get(key);
    if (existing) {
      applyWrite(existing, args.update);
      return existing;
    }
    const row: Row = { ...ACTOR_DEFAULTS, firstSeen: NOW, lastSeen: NOW };
    applyWrite(row, args.create);
    this.rows.set(key, row);
    return row;
  }

  async findMany(args: Parameters<ActorDelegate["findMany"]>[0]): Promise<Array<{ hints: string[] }>> {
    return [...this.rows.values()]
      .filter((r) => r.customerId === args.where.customerId && r.actionedAt !== null)
      .map((r) => ({ hints: r.hints as string[] }));
  }

  async updateMany(args: Parameters<ActorDelegate["updateMany"]>[0]): Promise<{ count: number }> {
    const row = this.rows.get(actorKey(args.where));
    if (!row) return { count: 0 };
    applyWrite(row, args.data);
    return { count: 1 };
  }

  row(hashedUid = ACTOR, customerId = CUS): Row {
    const row = this.rows.get(actorKey({ customerId, hashedUid }));
    if (!row) throw new Error("no actor row");
    return row;
  }

  seed(row: Row): void {
    const full: Row = { ...ACTOR_DEFAULTS, firstSeen: NOW, lastSeen: NOW, ...row };
    this.rows.set(
      actorKey({ customerId: full.customerId as string, hashedUid: full.hashedUid as string }),
      full,
    );
  }
}

function pairKey(k: { customerId: string; actorUid: string; targetUid: string }): string {
  return `${k.customerId}:${k.actorUid}:${k.targetUid}`;
}

function actorKey(k: { customerId: string; hashedUid: string }): string {
  return `${k.customerId}:${k.hashedUid}`;
}

function makeStore(now: Date = NOW) {
  const pairs = new FakePairs();
  const actors = new FakeActors();
  const store = new PrismaKernelStore({ pair: pairs, actor: actors }, { now: () => now });
  return { pairs, actors, store };
}

function samplePair(): PairState {
  return {
    actorBand: "A21_PLUS",
    targetBand: "A13_15",
    actorMessages: 7,
    targetMessages: 2,
    actorQuestions: 4,
    firstStageAt: { probe: "2026-09-03T11:00:00.000Z", migrate: "2026-09-03T11:30:00.000Z" },
    signals: [
      {
        kind: "supervision_probe",
        stage: "probe",
        weight: 1,
        excerpt: "are your parents home",
        matched: "supervision_probe:parents_home",
        eventExternalId: "m1",
        ts: new Date("2026-09-03T11:00:00.000Z"),
      },
      {
        kind: "off_platform_migration",
        stage: "migrate",
        weight: 1.3,
        ts: new Date("2026-09-03T11:30:00.000Z"),
      },
    ],
    lastInboundMediaAt: "2026-09-03T11:45:00.000Z",
    knownCsamMatch: false,
    firstSeenAt: "2026-09-03T10:00:00.000Z",
    lastSeenAt: "2026-09-03T11:50:00.000Z",
    recentExternalIds: ["m1", "m2"],
  };
}

function sampleActor(): ActorState {
  let state = emptyActorState("A21_PLUS");
  state = observeActor(state, {
    ts: new Date("2026-09-02T09:00:00.000Z"),
    targetUid: "t1",
    targetBand: "A13_15",
    flagged: true,
    accountAgeHours: 30,
    role: "member",
    hints: ["dev-1", "ip-1"],
  });
  state = observeActor(state, {
    ts: new Date("2026-09-03T11:00:00.000Z"),
    targetUid: "t2",
    targetBand: "A16_17",
    flagged: false,
    hints: ["ip-2"],
  });
  return state;
}

function tierResult(tier: Tier, producedBy: TierResult["producedBy"] = "model"): TierResult {
  return {
    tier,
    fusedScore: 3.4,
    rationale: ["Stage progression observed: probe to migrate."],
    criticalSignals: tier === "T2" ? ["meetup_logistics"] : [],
    pair: {
      customerId: CUS,
      actorUid: ACTOR,
      targetUid: TARGET,
      score: 2.9,
      components: { progression: 2, velocity: 0.5, asymmetry: 0.2, ageGap: 0.2, economic: 0 },
      stagesHit: ["probe", "migrate"],
      criticalSignals: [],
      signals: [],
      windowStart: new Date("2026-09-03T10:00:00.000Z"),
      windowEnd: new Date("2026-09-03T11:50:00.000Z"),
    },
    actor: {
      customerId: CUS,
      actorUid: ACTOR,
      skew: 0.4,
      fanOut7d: 12,
      minorFanOut7d: 9,
      accountAgeHours: 30,
      altClusterSize: 0,
      score: 1.0,
    },
    versions: { modelVersion: "rules-v1", lexiconVersion: "v1", fusionVersion: "rules-v1" },
    producedBy,
    scoredAt: NOW,
  };
}

describe("PrismaKernelStore pairs", () => {
  it("round trips pair state through the column mapping", async () => {
    const { store } = makeStore();
    const state = samplePair();
    await store.putPair(CUS, ACTOR, TARGET, state);
    expect(await store.getPair(CUS, ACTOR, TARGET)).toEqual(state);
  });

  it("returns null for a pair that was never written", async () => {
    const { store } = makeStore();
    expect(await store.getPair(CUS, ACTOR, "nobody")).toBeNull();
  });

  it("stamps customerId and WATCH_30D retention with a 30 day expiry on write", async () => {
    const { store, pairs } = makeStore();
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    const row = pairs.row();
    expect(row.customerId).toBe(CUS);
    expect(row.retention).toBe("WATCH_30D");
    expect(row.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(row.messageCounts).toEqual({
      actorMessages: 7,
      targetMessages: 2,
      actorQuestions: 4,
      knownCsamMatch: false,
      actorBand: "A21_PLUS",
      targetBand: "A13_15",
      recentExternalIds: ["m1", "m2"],
    });
    expect(row.windowStart).toEqual(new Date("2026-09-03T10:00:00.000Z"));
    expect(row.windowEnd).toEqual(new Date("2026-09-03T11:50:00.000Z"));
  });

  it("upserts on the unique key instead of adding rows", async () => {
    const { store, pairs } = makeStore();
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    const next = { ...samplePair(), actorMessages: 9, knownCsamMatch: true };
    await store.putPair(CUS, ACTOR, TARGET, next);
    expect(pairs.rows.size).toBe(1);
    expect(await store.getPair(CUS, ACTOR, TARGET)).toEqual(next);
  });

  it("creates stub actor rows for both sides so the foreign keys hold", async () => {
    const { store, actors } = makeStore();
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    expect(actors.row(ACTOR).ageBand).toBe("A21_PLUS");
    expect(actors.row(TARGET).ageBand).toBe("A13_15");
    expect(actors.row(TARGET).retention).toBe("WATCH_30D");
    expect(actors.row(TARGET).customerId).toBe(CUS);
    // A stub has no state yet.
    expect(await store.getActor(CUS, TARGET)).toBeNull();
  });

  it("does not touch an existing actor row when writing a pair", async () => {
    const { store, actors } = makeStore();
    await store.putActor(CUS, ACTOR, sampleActor());
    const before = { ...actors.row(ACTOR) };
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    expect(actors.row(ACTOR)).toEqual(before);
  });

  it("slides the expiry forward on later writes", async () => {
    const pairs = new FakePairs();
    const actors = new FakeActors();
    let now = NOW;
    const store = new PrismaKernelStore({ pair: pairs, actor: actors }, { now: () => now });
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    now = new Date(NOW.getTime() + DAY);
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    expect(pairs.row().expiresAt).toEqual(new Date(NOW.getTime() + 31 * DAY));
  });
});

describe("PrismaKernelStore retention ratchet", () => {
  it("never lowers a pair that already holds a higher class", async () => {
    const { store, pairs } = makeStore();
    const held = new Date(NOW.getTime() + 400 * DAY);
    pairs.seed({ customerId: CUS, actorUid: ACTOR, targetUid: TARGET, retention: "CASE_1Y", expiresAt: held });
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    expect(pairs.row().retention).toBe("CASE_1Y");
    expect(pairs.row().expiresAt).toEqual(held);
    // The class is left out of the patch when unchanged, so a concurrent raise survives.
    expect(pairs.lastUpsert?.update.retention).toBeUndefined();
  });

  it("keeps a legal hold open ended", async () => {
    const { store, pairs } = makeStore();
    pairs.seed({ customerId: CUS, actorUid: ACTOR, targetUid: TARGET, retention: "LEGAL_HOLD", expiresAt: null });
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    expect(pairs.row().retention).toBe("LEGAL_HOLD");
    expect(pairs.row().expiresAt).toBeNull();
  });

  it("raises an ephemeral row to the watch class", async () => {
    const { store, pairs } = makeStore();
    pairs.seed({ customerId: CUS, actorUid: ACTOR, targetUid: TARGET, retention: "EPHEMERAL_24H", expiresAt: null });
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    expect(pairs.row().retention).toBe("WATCH_30D");
    expect(pairs.lastUpsert?.update.retention).toBe("WATCH_30D");
  });

  it("never lowers an actor that already holds a higher class", async () => {
    const { store, actors } = makeStore();
    const held = new Date(NOW.getTime() + 400 * DAY);
    actors.seed({ customerId: CUS, hashedUid: ACTOR, retention: "CASE_1Y", expiresAt: held });
    await store.putActor(CUS, ACTOR, sampleActor());
    expect(actors.row(ACTOR).retention).toBe("CASE_1Y");
    expect(actors.row(ACTOR).expiresAt).toEqual(held);
  });
});

describe("PrismaKernelStore actors", () => {
  it("round trips actor state through the column mapping", async () => {
    const { store, actors } = makeStore();
    const state = sampleActor();
    await store.putActor(CUS, ACTOR, state);
    expect(await store.getActor(CUS, ACTOR)).toEqual(state);
    const row = actors.row(ACTOR);
    expect(row.customerId).toBe(CUS);
    expect(row.retention).toBe("WATCH_30D");
    expect(row.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(row.ageBand).toBe("A21_PLUS");
    expect(row.role).toBe("member");
    expect(row.accountAgeHours).toBe(30);
    expect(row.hints).toEqual(["dev-1", "ip-1", "ip-2"]);
    expect(row.firstSeen).toEqual(new Date("2026-09-02T09:00:00.000Z"));
    expect(row.lastSeen).toEqual(new Date("2026-09-03T11:00:00.000Z"));
    expect(row.graphState).toEqual({
      daily: state.daily,
      contactsByDay: state.contactsByDay,
      minorContactsByDay: state.minorContactsByDay,
      recentOutboundTs: state.recentOutboundTs,
      outboundBurstMax1h: state.outboundBurstMax1h,
    });
  });

  it("upserts on the unique key and fills in a stub", async () => {
    const { store, actors } = makeStore();
    await store.putPair(CUS, TARGET, ACTOR, samplePair());
    expect(await store.getActor(CUS, ACTOR)).toBeNull();
    const state = sampleActor();
    await store.putActor(CUS, ACTOR, state);
    await store.putActor(CUS, ACTOR, { ...state, role: "moderator" });
    expect(actors.rows.size).toBe(2);
    expect((await store.getActor(CUS, ACTOR))?.role).toBe("moderator");
  });

  it("returns null for an actor that was never written", async () => {
    const { store } = makeStore();
    expect(await store.getActor(CUS, "nobody")).toBeNull();
  });
});

describe("PrismaKernelStore bannedHints", () => {
  it("unions hints from actioned accounts of the same customer only", async () => {
    const { store, actors } = makeStore();
    actors.seed({ customerId: CUS, hashedUid: "a1", hints: ["h1", "h2"], actionedAt: NOW });
    actors.seed({ customerId: CUS, hashedUid: "a2", hints: ["h2", "h3"], actionedAt: NOW });
    actors.seed({ customerId: CUS, hashedUid: "a3", hints: ["h4"], actionedAt: null });
    actors.seed({ customerId: "cus_b", hashedUid: "a4", hints: ["h5"], actionedAt: NOW });
    expect(await store.bannedHints(CUS)).toEqual(new Set(["h1", "h2", "h3"]));
    expect(await store.bannedHints("cus_c")).toEqual(new Set());
  });
});

describe("PrismaKernelStore recordTier", () => {
  it("writes the score columns, the version triple and the window", async () => {
    const { store, pairs, actors } = makeStore();
    await store.putActor(CUS, ACTOR, sampleActor());
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    await store.recordTier(CUS, ACTOR, TARGET, tierResult("T2"));

    const row = pairs.row();
    expect(row.pairScore).toBe(2.9);
    expect(row.actorScore).toBe(1.0);
    expect(row.fusedScore).toBe(3.4);
    expect(row.tier).toBe("T2");
    expect(row.criticalSignals).toEqual(["meetup_logistics"]);
    expect(row.windowStart).toEqual(new Date("2026-09-03T10:00:00.000Z"));
    expect(row.windowEnd).toEqual(new Date("2026-09-03T11:50:00.000Z"));
    expect(row.modelVersion).toBe("rules-v1");
    expect(row.lexiconVersion).toBe("v1");
    expect(row.fusionVersion).toBe("rules-v1");
    expect(row.retention).toBe("WATCH_30D");
    expect(row.customerId).toBe(CUS);
    // State columns are untouched.
    expect(await store.getPair(CUS, ACTOR, TARGET)).toEqual(samplePair());

    const actor = actors.row(ACTOR);
    expect(actor.skewScore).toBe(0.4);
    expect(actor.fanOut7d).toBe(12);
    expect(actor.minorFanOut7d).toBe(9);
  });

  it("does not lower retention when a later score is T0", async () => {
    const { store, pairs } = makeStore();
    pairs.seed({ customerId: CUS, actorUid: ACTOR, targetUid: TARGET, retention: "CASE_1Y", expiresAt: new Date(NOW.getTime() + 365 * DAY) });
    await store.recordTier(CUS, ACTOR, TARGET, tierResult("T0"));
    expect(pairs.row().tier).toBe("T0");
    expect(pairs.row().retention).toBe("CASE_1Y");
    expect(pairs.row().expiresAt).toEqual(new Date(NOW.getTime() + 365 * DAY));
  });

  it("raises retention to the tier's class", async () => {
    const { store, pairs } = makeStore();
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    await store.recordTier(CUS, ACTOR, TARGET, tierResult("T3", "reviewer"));
    expect(pairs.row().retention).toBe("CASE_1Y");
    expect(pairs.row().expiresAt).toEqual(new Date(NOW.getTime() + 365 * DAY));
  });

  it("refuses a T3 that did not come from a reviewer", async () => {
    const { store, pairs } = makeStore();
    await store.putPair(CUS, ACTOR, TARGET, samplePair());
    await expect(store.recordTier(CUS, ACTOR, TARGET, tierResult("T3"))).rejects.toThrow(/reviewer/);
    expect(pairs.row().tier).toBe("T0");
  });

  it("creates the row with empty state when the pair was never written", async () => {
    const { store, pairs, actors } = makeStore();
    await store.recordTier(CUS, ACTOR, TARGET, tierResult("T1"));
    expect(pairs.row().tier).toBe("T1");
    expect(pairs.row().retention).toBe("WATCH_30D");
    expect(actors.rows.size).toBe(2);
    expect(await store.getPair(CUS, ACTOR, TARGET)).toMatchObject({ actorMessages: 0, signals: [] });
  });
});
