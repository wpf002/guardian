import { randomBytes } from "node:crypto";
import { PrismaDeliveryStore, enqueueDelivery } from "@guardian/ingest";
import type { WebhookPayload } from "@guardian/schema";
import { createPrismaClient, type PrismaClient } from "@guardian/schema/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * PrismaDeliveryStore.claimDue against the real database.
 *
 * The claim is the one piece of the delivery path that is not ordinary Prisma:
 * it is a raw UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) whose whole
 * purpose is behaviour the memory twin cannot have. The twin claims by
 * filtering a Map with nothing awaited in between, which is a fine model of the
 * outcome and no model at all of the mechanism. If SKIP LOCKED were dropped
 * from the SQL, or the status cast were wrong, or the reclaim predicate read
 * the wrong clock, every unit test would still pass and every customer would
 * get every tier twice.
 *
 * Local only, and everything it writes is keyed to a customer minted for the
 * run and deleted afterwards. Unlike e2e.test.ts this appends nothing to the
 * audit chain, so the cleanup is complete.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://guardian:guardian@localhost:5433/guardian";
const URL_TARGET = "https://customer.example/hooks/guardian";

function isLocal(url: string): boolean {
  if (process.env.GUARDIAN_E2E_ALLOW_REMOTE === "1") return true;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

async function probe(): Promise<PrismaClient | { unreachable: string }> {
  const db = createPrismaClient(DATABASE_URL);
  try {
    await db.$queryRaw`SELECT 1`;
    return db;
  } catch (err) {
    await db.$disconnect().catch(() => undefined);
    return {
      unreachable: `postgres (DATABASE_URL): ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    };
  }
}

const probed = isLocal(DATABASE_URL)
  ? await probe()
  : { unreachable: "DATABASE_URL is not local; set GUARDIAN_E2E_ALLOW_REMOTE=1 to override" };
const skipReason = "unreachable" in probed ? probed.unreachable : null;
const live = skipReason === null ? describe : describe.skip;
if (skipReason) console.warn(`delivery claim test skipped, ${skipReason}`);

const db = "unreachable" in probed ? null : probed;
const CUSTOMER_ID = `cus_claim_${randomBytes(6).toString("hex")}`;

function payload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event: "tier.assigned",
    customerId: CUSTOMER_ID,
    actorUid: "a".repeat(64),
    targetUid: "b".repeat(64),
    tier: "T2",
    rationale: ["Supervision probing followed by a migration ask within 3 hours."],
    criticalSignals: [],
    versions: { modelVersion: "m1", lexiconVersion: "v2", fusionVersion: "rules-v2" },
    scoredAt: new Date(),
    ...overrides,
  };
}

live("PrismaDeliveryStore.claimDue against Postgres", () => {
  let store: PrismaDeliveryStore;

  beforeAll(async () => {
    if (!db) return;
    await db.customer.create({
      data: {
        id: CUSTOMER_ID,
        name: "Delivery claim test",
        apiKeyHash: randomBytes(32).toString("hex"),
        idSalt: randomBytes(16).toString("hex"),
        webhookSecret: `whsec_${randomBytes(16).toString("hex")}`,
      },
    });
    store = new PrismaDeliveryStore(db as never);
  });

  // Between tests rather than at the end of each one: a failed assertion
  // stops the test body, and rows left behind would then fail every test
  // after it for a reason that has nothing to do with what it checks.
  afterEach(async () => {
    if (!db) return;
    await db.webhookDelivery.deleteMany({ where: { customerId: CUSTOMER_ID } });
  });

  afterAll(async () => {
    if (!db) return;
    await db.webhookDelivery.deleteMany({ where: { customerId: CUSTOMER_ID } });
    await db.customer.delete({ where: { id: CUSTOMER_ID } }).catch(() => undefined);
    await db.$disconnect();
  });

  async function seed(n: number, at: Date): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const row = await enqueueDelivery(
        store,
        {
          customerId: CUSTOMER_ID,
          kind: "tier.assigned",
          url: URL_TARGET,
          payload: payload(),
          externalId: `seed-${randomBytes(4).toString("hex")}-${i}`,
        },
        at,
      );
      ids.push(row.id);
    }
    return ids;
  }

  /**
   * The property SKIP LOCKED exists for. Two workers claiming at the same
   * instant must get disjoint sets, and between them all of the due rows.
   */
  it("gives two concurrent workers disjoint sets", async () => {
    const now = new Date();
    const seeded = await seed(6, now);

    const [a, b] = await Promise.all([
      store.claimDue(now, 6, "worker-a"),
      store.claimDue(now, 6, "worker-b"),
    ]);

    const idsA = a.map((r) => r.id);
    const idsB = b.map((r) => r.id);
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([]);
    expect([...idsA, ...idsB].sort()).toEqual([...seeded].sort());
    for (const row of [...a, ...b]) expect(row.status).toBe("delivering");
  });

  it("hands a row to nobody twice while the claim is fresh", async () => {
    const now = new Date();
    await seed(2, now);

    const first = await store.claimDue(now, 10, "worker-a");
    expect(first).toHaveLength(2);
    const second = await store.claimDue(now, 10, "worker-b");
    expect(second).toEqual([]);
  });

  /**
   * How a crashed worker's rows come back. The claim goes stale on the clock
   * the caller passes, so the test moves the clock rather than waiting.
   */
  it("reclaims a row whose claim has gone stale, and names the new holder", async () => {
    const now = new Date();
    await seed(1, now);

    const [claimed] = await store.claimDue(now, 10, "worker-crashed");
    expect(claimed?.claimedBy).toBe("worker-crashed");

    // Inside the 60 second claim timeout. At exactly 60s the row is already
    // reclaimable, which is the boundary the predicate is written on.
    const stillFresh = await store.claimDue(new Date(now.getTime() + 30_000), 10, "worker-b");
    expect(stillFresh).toEqual([]);

    const afterTimeout = new Date(now.getTime() + 15 * 60_000);
    const reclaimed = await store.claimDue(afterTimeout, 10, "worker-b");
    expect(reclaimed.map((r) => r.id)).toEqual([claimed!.id]);
    expect(reclaimed[0]!.claimedBy).toBe("worker-b");
  });

  it("takes the oldest schedule first and honours the limit", async () => {
    const base = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const row = await enqueueDelivery(
        store,
        {
          customerId: CUSTOMER_ID,
          kind: "tier.assigned",
          url: URL_TARGET,
          payload: payload(),
          externalId: `ordered-${i}`,
        },
        new Date(base + i * 1000),
      );
      ids.push(row.id);
    }

    const claimed = await store.claimDue(new Date(base + 10_000), 2, "worker-a");
    expect(claimed.map((r) => r.id)).toEqual(ids.slice(0, 2));
  });

  /**
   * The other half of P-4, checked where the unique index actually lives. The
   * memory twin dedupes in JavaScript; this asks Postgres.
   */
  it("enqueues once for a redelivered external id", async () => {
    const now = new Date();
    const input = {
      customerId: CUSTOMER_ID,
      kind: "tier.assigned" as const,
      url: URL_TARGET,
      payload: payload(),
      externalId: "stream-entry-1",
    };
    const first = await enqueueDelivery(store, input, now);
    const again = await enqueueDelivery(store, input, new Date(now.getTime() + 5_000));

    expect(again.id).toBe(first.id);
    expect(
      await db!.webhookDelivery.count({ where: { customerId: CUSTOMER_ID } }),
    ).toBe(1);
  });
});
