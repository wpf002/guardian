import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import type { Event, Tier, TierResult } from "@guardian/schema";
import { describe, expect, it } from "vitest";
import type { Detection } from "../src/detectors/index.js";
import { Kernel, type ScoredEvent } from "../src/kernel.js";
import {
  EXCERPT_MAX_CHARS,
  persistScoredEvent,
  type EventDelegate,
  type EventRow,
  type TierRecorder,
} from "../src/persist.js";
import { MemoryKernelStore } from "../src/store.js";
import { scoreAndDispatch } from "../src/worker.js";
import { makeEvent } from "./helpers.js";

/**
 * In-memory fake with Postgres write semantics: an undefined field is left
 * alone, the json column loses undefined keys on the way in, and the schema
 * defaults apply on create.
 */

const NOW = new Date("2026-09-03T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CUS = "cus_test";
const ACTOR = "actor-hash";
const TARGET = "target-hash";

type Row = Record<string, unknown>;

const EVENT_DEFAULTS: Row = {
  targetUid: null,
  text: null,
  mediaSha256: null,
  knownCsamVerdict: null,
  actorBand: "UNKNOWN",
  targetBand: "UNKNOWN",
  actorRole: "unknown",
  features: null,
  stageProbs: null,
  stage: null,
  modelVersion: null,
  lexiconVersion: null,
  fusionVersion: null,
  retention: "EPHEMERAL_24H",
};

function applyWrite(target: Row, data: object): void {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    target[k] = k === "features" ? JSON.parse(JSON.stringify(v)) : v;
  }
}

class FakeEvents implements EventDelegate {
  readonly rows = new Map<string, Row>();
  lastUpsert: Parameters<EventDelegate["upsert"]>[0] | null = null;

  async findUnique(args: Parameters<EventDelegate["findUnique"]>[0]): Promise<EventRow | null> {
    const row = this.rows.get(eventKey(args.where.customerId_externalId));
    if (!row) return null;
    return { retention: row.retention as EventRow["retention"], expiresAt: row.expiresAt as Date };
  }

  async upsert(args: Parameters<EventDelegate["upsert"]>[0]): Promise<unknown> {
    this.lastUpsert = args;
    const key = eventKey(args.where.customerId_externalId);
    const existing = this.rows.get(key);
    if (existing) {
      applyWrite(existing, args.update);
      return existing;
    }
    const row: Row = { ...EVENT_DEFAULTS, createdAt: NOW };
    applyWrite(row, args.create);
    this.rows.set(key, row);
    return row;
  }

  row(externalId: string, customerId = CUS): Row {
    const row = this.rows.get(eventKey({ customerId, externalId }));
    if (!row) throw new Error("no event row");
    return row;
  }

  seed(row: Row): void {
    const full: Row = { ...EVENT_DEFAULTS, ...row };
    this.rows.set(
      eventKey({ customerId: full.customerId as string, externalId: full.externalId as string }),
      full,
    );
  }
}

class FakeRecorder implements TierRecorder {
  readonly calls: Array<{ customerId: string; actorUid: string; targetUid: string; result: TierResult }> = [];
  /** Set by the test to check the events row is written before the tier is recorded. */
  onRecord?: () => void;

  async recordTier(customerId: string, actorUid: string, targetUid: string, result: TierResult): Promise<void> {
    this.onRecord?.();
    this.calls.push({ customerId, actorUid, targetUid, result });
  }
}

function eventKey(k: { customerId: string; externalId: string }): string {
  return `${k.customerId}:${k.externalId}`;
}

function makeDb() {
  const events = new FakeEvents();
  const store = new FakeRecorder();
  const db = { event: events };
  const persist = (event: Event, scored: ScoredEvent) =>
    persistScoredEvent(db, store, event, scored, { now: () => NOW });
  return { events, store, persist };
}

function sampleEvent(overrides: Partial<Event> = {}): Event {
  const base = makeEvent(
    {
      from: "actor",
      text: "are your parents home right now",
      media: { sha256: "a".repeat(64), knownCsamVerdict: "no_match" },
      at: 0,
    },
    1,
    { actorBand: "A21_PLUS", targetBand: "A13_15", customerId: CUS },
  );
  return { ...base, ...overrides };
}

const DETECTION: Detection = {
  kind: "supervision_probe",
  stage: "probe",
  weight: 1,
  matched: "supervision_probe:parents_home",
  excerpt: "are your parents home",
  meta: { field: "supervision_probe" },
};

function tierResult(tier: Tier, event: Event): TierResult {
  return {
    tier,
    fusedScore: tier === "T0" ? 0.2 : 2.1,
    rationale: ["Supervision probe recorded on the pair."],
    criticalSignals: [],
    pair: {
      customerId: event.customerId,
      actorUid: event.actorUid,
      targetUid: event.targetUid ?? TARGET,
      score: 1.4,
      components: { progression: 1, velocity: 0, asymmetry: 0.2, ageGap: 0.2, economic: 0 },
      stagesHit: ["probe"],
      criticalSignals: [],
      signals: [],
      windowStart: event.ts,
      windowEnd: event.ts,
    },
    actor: {
      customerId: event.customerId,
      actorUid: event.actorUid,
      skew: 0.1,
      fanOut7d: 1,
      minorFanOut7d: 1,
      accountAgeHours: null,
      altClusterSize: 0,
      score: 0.3,
    },
    versions: { modelVersion: "rules-v1", lexiconVersion: "v1", fusionVersion: "rules-v1" },
    producedBy: "model",
    soleAutomatedBasis: false,
    scoredAt: NOW,
  };
}

function scoredEvent(tier: Tier, event: Event, detections: Detection[] = [DETECTION]): ScoredEvent {
  return {
    result: tierResult(tier, event),
    detections,
    stage: "probe",
    excerpts: detections.map((d) => d.excerpt),
    replay: false,
  };
}

describe("persistScoredEvent", () => {
  it("keeps features only on T0 and drops the text", async () => {
    const { events, store, persist } = makeDb();
    const event = sampleEvent();
    await persist(event, scoredEvent("T0", event));

    const row = events.row("m1");
    expect(row.text).toBeNull();
    expect(row.features).toEqual([
      {
        kind: "supervision_probe",
        stage: "probe",
        weight: 1,
        matched: "supervision_probe:parents_home",
        excerpt: "are your parents home",
        meta: { field: "supervision_probe" },
      },
    ]);
    expect(row.retention).toBe("EPHEMERAL_24H");
    expect(row.expiresAt).toEqual(new Date(NOW.getTime() + DAY));
    expect(store.calls).toHaveLength(1);
  });

  it("keeps the text on T1 with a 30 day retention", async () => {
    const { events, persist } = makeDb();
    const event = sampleEvent();
    await persist(event, scoredEvent("T1", event));

    const row = events.row("m1");
    expect(row.text).toBe("are your parents home right now");
    expect(row.retention).toBe("WATCH_30D");
    expect(row.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
  });

  it("writes every column rule 7 and rule 1 care about", async () => {
    const { events, persist } = makeDb();
    const event = sampleEvent();
    await persist(event, scoredEvent("T1", event));

    const row = events.row("m1");
    expect(row.customerId).toBe(CUS);
    expect(row.externalId).toBe("m1");
    expect(row.actorUid).toBe(ACTOR);
    expect(row.targetUid).toBe(TARGET);
    expect(row.channel).toBe("general");
    expect(row.ts).toEqual(event.ts);
    expect(row.mediaSha256).toBe("a".repeat(64));
    expect(row.knownCsamVerdict).toBe("no_match");
    expect(row.actorBand).toBe("A21_PLUS");
    expect(row.targetBand).toBe("A13_15");
    expect(row.stage).toBe("probe");
    expect(row.surface).toBe("discord");
    expect(row.sourceId).toBe("guild-1");
    // There is no column for media bytes, and nothing here tries to write one.
    expect(Object.keys(events.lastUpsert!.create)).not.toContain("bytes");
  });

  it("records the version triple on the row", async () => {
    const { events, persist } = makeDb();
    const event = sampleEvent();
    await persist(event, scoredEvent("T1", event));

    const row = events.row("m1");
    expect(row.modelVersion).toBe("rules-v1");
    expect(row.lexiconVersion).toBe("v1");
    expect(row.fusionVersion).toBe("rules-v1");
  });

  it("stores null media columns and a null stage when the event carries neither", async () => {
    const { events, persist } = makeDb();
    const event = sampleEvent({ media: null, text: "hello" });
    const scored = scoredEvent("T1", event, []);
    scored.stage = "not-a-stage";
    await persist(event, scored);

    const row = events.row("m1");
    expect(row.mediaSha256).toBeNull();
    expect(row.knownCsamVerdict).toBeNull();
    expect(row.stage).toBeNull();
    expect(row.features).toEqual([]);
  });

  it("caps excerpts and matched spans at the schema limit", async () => {
    const { events, persist } = makeDb();
    const event = sampleEvent();
    const long: Detection = { ...DETECTION, excerpt: "x".repeat(1000), matched: "y".repeat(1000) };
    await persist(event, scoredEvent("T1", event, [long]));

    const [feature] = events.row("m1").features as Array<{ excerpt: string; matched: string }>;
    expect(feature!.excerpt).toHaveLength(EXCERPT_MAX_CHARS);
    expect(feature!.matched).toHaveLength(EXCERPT_MAX_CHARS);
  });

  it("escalates retention from T0 to T1 on a later write", async () => {
    const { events, persist } = makeDb();
    const event = sampleEvent();
    await persist(event, scoredEvent("T0", event));
    await persist(event, scoredEvent("T1", event));

    expect(events.rows.size).toBe(1);
    const row = events.row("m1");
    expect(row.retention).toBe("WATCH_30D");
    expect(row.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(row.text).toBe("are your parents home right now");
    expect(events.lastUpsert?.update.retention).toBe("WATCH_30D");
  });

  it("never lowers a row that already holds a higher class", async () => {
    const { events, persist } = makeDb();
    const event = sampleEvent();
    const held = new Date(NOW.getTime() + 400 * DAY);
    events.seed({
      customerId: CUS,
      externalId: "m1",
      retention: "CASE_1Y",
      expiresAt: held,
      text: "are your parents home right now",
    });
    await persist(event, scoredEvent("T0", event));

    const row = events.row("m1");
    expect(row.retention).toBe("CASE_1Y");
    expect(row.expiresAt).toEqual(held);
    // A T0 rescore does not strip text the higher class protects.
    expect(row.text).toBe("are your parents home right now");
    // The class is left out of the patch when unchanged, so a concurrent raise survives.
    expect(events.lastUpsert?.update.retention).toBeUndefined();
  });

  it("keeps the stored expiry on a legal hold", async () => {
    const { events, persist } = makeDb();
    const event = sampleEvent();
    const held = new Date(NOW.getTime() + 10 * DAY);
    events.seed({ customerId: CUS, externalId: "m1", retention: "LEGAL_HOLD", expiresAt: held });
    await persist(event, scoredEvent("T1", event));

    const row = events.row("m1");
    expect(row.retention).toBe("LEGAL_HOLD");
    expect(row.expiresAt).toEqual(held);
  });

  it("does not move the expiry earlier when the stored one is later", async () => {
    const { events, persist } = makeDb();
    const event = sampleEvent();
    const later = new Date(NOW.getTime() + 45 * DAY);
    events.seed({ customerId: CUS, externalId: "m1", retention: "WATCH_30D", expiresAt: later });
    await persist(event, scoredEvent("T1", event));
    expect(events.row("m1").expiresAt).toEqual(later);
  });

  it("records the tier on the pair after the events row is written", async () => {
    const { events, store, persist } = makeDb();
    const event = sampleEvent();
    let rowsAtRecord = -1;
    store.onRecord = () => {
      rowsAtRecord = events.rows.size;
    };
    const scored = scoredEvent("T2", event);
    await persist(event, scored);

    expect(rowsAtRecord).toBe(1);
    expect(store.calls).toEqual([
      { customerId: CUS, actorUid: ACTOR, targetUid: TARGET, result: scored.result },
    ]);
  });
});

describe("scoreAndDispatch persist hook", () => {
  function makeAudit(): AuditLog {
    return new AuditLog(new MemoryAuditStore(), "test-secret");
  }

  it("calls persist with the event and the kernel's output once per scored event", async () => {
    const kernel = new Kernel({ store: new MemoryKernelStore() });
    const audit = makeAudit();
    const calls: Array<{ event: Event; scored: ScoredEvent }> = [];
    const event = sampleEvent();

    await scoreAndDispatch(
      {
        kernel,
        audit,
        persist: async (e, s) => {
          calls.push({ event: e, scored: s });
        },
        webhookFor: () => null,
      },
      event,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.event).toBe(event);
    expect(calls[0]!.scored.result.pair.actorUid).toBe(ACTOR);
    expect(calls[0]!.scored.result.versions.lexiconVersion).toBeTruthy();
  });

  it("skips persist for an event with no target, which the kernel does not score", async () => {
    const kernel = new Kernel({ store: new MemoryKernelStore() });
    const audit = makeAudit();
    let called = 0;
    await scoreAndDispatch(
      {
        kernel,
        audit,
        persist: async () => {
          called += 1;
        },
      },
      sampleEvent({ targetUid: null }),
    );
    expect(called).toBe(0);
  });

  it("still works with no persist hook, as the eval harness runs it", async () => {
    const kernel = new Kernel({ store: new MemoryKernelStore() });
    const audit = makeAudit();
    await expect(scoreAndDispatch({ kernel, audit }, sampleEvent())).resolves.toBeUndefined();
  });
});
