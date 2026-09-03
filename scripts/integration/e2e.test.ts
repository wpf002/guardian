import { randomBytes } from "node:crypto";
import { AuditLog, PrismaAuditStore } from "@guardian/audit";
import { PrismaCustomerStore, RedisEventQueue, buildServer, streamKey } from "@guardian/ingest";
import { Kernel, PrismaKernelStore, persistScoredEvent, runWorker } from "@guardian/scorer";
import { hashUid, type AgeBand } from "@guardian/schema";
import { createPrismaClient, type PrismaClient } from "@guardian/schema/db";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End to end against the live local Postgres and Redis: ingest edge to Redis
 * Stream to scorer worker to the pairs, events and audit tables.
 *
 * The conversation is the nine message grooming ladder from
 * apps/scorer/test/kernel.test.ts, sent adult to child through the HTTP edge
 * with the customer's real key. Everything the run creates is keyed to a
 * customer minted for this run and removed in afterAll.
 *
 * Skips, rather than fails, when either service is unreachable.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://guardian:guardian@localhost:5433/guardian";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6381";
const AUDIT_SECRET = "integration-test-secret";
const STEP_TIMEOUT_MS = 60_000;

type Infra = { db: PrismaClient; redis: Redis };

async function probe(): Promise<Infra | { unreachable: string }> {
  const db = createPrismaClient(DATABASE_URL);
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    await db.$disconnect().catch(() => undefined);
    return { unreachable: `postgres (DATABASE_URL): ${message(err)}` };
  }
  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    await redis.ping();
  } catch (err) {
    redis.disconnect();
    await db.$disconnect().catch(() => undefined);
    return { unreachable: `redis (REDIS_URL): ${message(err)}` };
  }
  return { db, redis };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] ?? "" : String(err);
}

const infra = await probe();
const skipReason = "unreachable" in infra ? infra.unreachable : null;
const live = skipReason === null ? describe : describe.skip;
if (skipReason) console.warn(`e2e skipped, ${skipReason}`);

/** Minutes after the conversation start. Copied from the kernel tests. */
interface Line {
  from: "actor" | "target";
  text: string;
  at: number;
}

const groomingLadder: Line[] = [
  { from: "actor", text: "hey nice build in that game", at: 0 },
  { from: "target", text: "thanks lol", at: 1 },
  { from: "actor", text: "what do you like to play? i can send you some robux if you want", at: 3 },
  { from: "target", text: "omg really", at: 4 },
  { from: "actor", text: "yeah. are your parents home right now? do they check your phone?", at: 8 },
  { from: "target", text: "no theyre at work", at: 9 },
  { from: "actor", text: "cool. add me on 👻 my snap is ryan_xx99, easier to talk there", at: 12 },
  { from: "target", text: "ok", at: 13 },
  { from: "actor", text: "dont tell anyone we talk ok, our secret", at: 15 },
];

const T0 = new Date("2026-09-02T12:00:00Z").getTime();
const ADULT_BAND: AgeBand = "A21_PLUS";
const CHILD_BAND: AgeBand = "A9_12";

live(`ingest to scorer to postgres (${skipReason ?? "live"})`, () => {
  const { db, redis } = infra as Infra;
  const run = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const adultUid = `adult-${run}`;
  const childUid = `child-${run}`;

  const customers = new PrismaCustomerStore(db);
  const audit = new AuditLog(new PrismaAuditStore(db), AUDIT_SECRET);

  let customerId = "";
  let idSalt = "";
  let apiKey = "";
  let app: ReturnType<typeof buildServer> | null = null;
  let seqBefore = 0;

  function inbound(line: Line, index: number) {
    const fromActor = line.from === "actor";
    return {
      externalId: `m${index}`,
      actorUid: fromActor ? adultUid : childUid,
      targetUid: fromActor ? childUid : adultUid,
      channel: "general",
      ts: new Date(T0 + line.at * 60_000).toISOString(),
      text: line.text,
      actorBand: fromActor ? ADULT_BAND : CHILD_BAND,
      targetBand: fromActor ? CHILD_BAND : ADULT_BAND,
      provenance: { surface: "discord", sourceId: `guild-${run}` },
    };
  }

  async function post(payload: unknown) {
    if (!app) throw new Error("server not built");
    return app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "application/json", "x-guardian-key": apiKey },
      payload: JSON.stringify(payload),
    });
  }

  beforeAll(async () => {
    const created = await customers.createCustomer(`Integration run ${run}`);
    customerId = created.customer.id;
    idSalt = created.customer.idSalt;
    apiKey = created.apiKey;
    seqBefore = (await audit.head()).seq;

    app = buildServer({
      customers,
      queue: new RedisEventQueue(redis),
      audit,
      violations: {
        record: (id, violations) => customers.recordViolation(id, violations),
      },
    });
  }, STEP_TIMEOUT_MS);

  afterAll(async () => {
    await app?.close();
    if (customerId) {
      const where = { customerId };
      await db.evidenceBundle.deleteMany({ where });
      await db.pair.deleteMany({ where });
      await db.event.deleteMany({ where });
      await db.actor.deleteMany({ where });
      await db.customerViolation.deleteMany({ where });
      await db.auditEntry.deleteMany({ where });
      await db.customer.delete({ where: { id: customerId } });
      await redis.del(streamKey(customerId));
    }
    await redis.quit().catch(() => undefined);
    await db.$disconnect();
  }, STEP_TIMEOUT_MS);

  it(
    "accepts the ladder at the edge and scores it to T2 with text kept and the chain intact",
    async () => {
      const res = await post({ events: groomingLadder.map(inbound) });
      expect({ status: res.statusCode, body: res.json() }).toEqual({
        status: 202,
        body: { accepted: groomingLadder.length, rejected: [] },
      });

      const store = PrismaKernelStore.fromClient(db);
      const kernel = new Kernel({ store });
      let persisted = 0;
      const deadline = Date.now() + STEP_TIMEOUT_MS / 2;
      await runWorker(
        {
          redis,
          kernel,
          audit,
          customerIds: [customerId],
          consumerName: `e2e-${run}`,
          blockMs: 250,
          persist: async (event, scored) => {
            await persistScoredEvent(db, store, event, scored);
            persisted += 1;
          },
        },
        () => persisted >= groomingLadder.length || Date.now() > deadline,
      );
      expect(persisted).toBe(groomingLadder.length);

      const actorUid = hashUid(adultUid, idSalt);
      const targetUid = hashUid(childUid, idSalt);
      const pair = await db.pair.findUnique({
        where: { customerId_actorUid_targetUid: { customerId, actorUid, targetUid } },
      });
      expect(pair?.tier).toBe("T2");
      expect(pair?.retention).toBe("WATCH_30D");

      const lastIndex = groomingLadder.length - 1;
      const last = await db.event.findUnique({
        where: { customerId_externalId: { customerId, externalId: `m${lastIndex}` } },
      });
      expect(last?.text).toBe(groomingLadder[lastIndex]?.text);
      expect(last?.retention).toBe("WATCH_30D");
      expect(last?.actorUid).toBe(actorUid);

      // One event.ingested entry plus one score.assigned per message.
      const verdict = await audit.verify(seqBefore + 1);
      expect(verdict.ok).toBe(true);
      expect(verdict.checked).toBeGreaterThanOrEqual(groomingLadder.length + 1);
    },
    STEP_TIMEOUT_MS,
  );

  it(
    "keeps the chain contiguous under concurrent appends from two clients",
    async () => {
      // A second client stands in for a second process (the scorer beside
      // ingest). Without the advisory lock in PrismaAuditStore these would
      // race for the same seq.
      const db2 = createPrismaClient(DATABASE_URL);
      try {
        const audit2 = new AuditLog(new PrismaAuditStore(db2), AUDIT_SECRET);
        const start = (await audit.head()).seq;
        const writers = [audit, audit2];
        const appends = Array.from({ length: 12 }, (_, i) =>
          writers[i % 2]!.append({
            kind: "lexicon.updated",
            customerId,
            payload: { probe: i },
          }),
        );
        const entries = await Promise.all(appends);
        const seqs = entries.map((e) => e.seq).sort((a, b) => a - b);
        expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => start + 1 + i));
        const verdict = await audit.verify(seqBefore + 1);
        expect(verdict.ok).toBe(true);
      } finally {
        await db2.$disconnect();
      }
    },
    STEP_TIMEOUT_MS,
  );

  it(
    "records a customer violation when a data uri is posted",
    async () => {
      const res = await post({
        ...inbound(groomingLadder[0]!, 99),
        text: "data:image/png;base64,iVBORw0KGgo=",
      });
      expect({ status: res.statusCode, error: res.json().error }).toEqual({
        status: 422,
        error: "media bytes are never accepted",
      });

      const violations = await db.customerViolation.count({ where: { customerId } });
      expect(violations).toBeGreaterThanOrEqual(1);
      const queued = await db.event.count({ where: { customerId, externalId: "m99" } });
      expect(queued).toBe(0);
    },
    STEP_TIMEOUT_MS,
  );
});
