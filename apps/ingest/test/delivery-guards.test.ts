import type { WebhookPayload } from "@guardian/schema";
import { describe, expect, it } from "vitest";
import {
  attemptDelivery,
  classifyStatus,
  isRedirect,
  MemoryDeliveryStore,
  enqueueDelivery,
  type DeliveryStore,
} from "../src/delivery.js";
import { runDeliveryPass } from "../src/delivery-worker.js";

/**
 * The delivery findings from an adversarial review of the phase 3 work. Each
 * block is one finding. Every one of these was reachable with the endpoint's
 * own cooperation and no attack on Guardian itself, which is why they are here
 * rather than in a comment.
 */

const SECRET = "whsec_test_secret";
const URL = "https://customer.example/hooks/guardian";
const T0_MS = Date.parse("2026-09-04T12:00:00.000Z");

const allowTarget = (): { ok: true } => ({ ok: true });

function payload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event: "tier.assigned",
    customerId: "cus_1",
    actorUid: "a1b2c3",
    targetUid: "d4e5f6",
    tier: "T2",
    rationale: ["Supervision probing followed by a migration ask within 3 hours."],
    criticalSignals: [],
    versions: { modelVersion: "m1", lexiconVersion: "v2", fusionVersion: "rules-v2" },
    scoredAt: new Date(T0_MS),
    ...overrides,
  };
}

async function queueOne(store: DeliveryStore, at = new Date(T0_MS)) {
  return enqueueDelivery(
    store,
    { customerId: "cus_1", kind: "tier.assigned", url: URL, payload: payload() },
    at,
  );
}

/* -------------------------------------------------------------------------- */

describe("a redirect is never followed", () => {
  it("recognises a redirect on either response shape", () => {
    expect(isRedirect({ status: 307 })).toBe(true);
    expect(isRedirect({ status: 0, type: "opaqueredirect" })).toBe(true);
    expect(isRedirect({ status: 200 })).toBe(false);
    expect(classifyStatus(307)).toBe("dead");
  });

  it("asks fetch not to follow, and kills the row when it sees one", async () => {
    const store = new MemoryDeliveryStore();
    await queueOne(store);
    const [row] = await store.claimDue(new Date(T0_MS), 1, "worker-1");

    let init: RequestInit | undefined;
    const outcome = await attemptDelivery(store, row!, {
      checkTarget: allowTarget,
      secretFor: () => SECRET,
      now: () => T0_MS,
      fetchImpl: (async (_url: unknown, given: RequestInit) => {
        init = given;
        // The shape a customer endpoint uses to walk the signed POST somewhere
        // the https and private-space checks never looked.
        return { status: 307, ok: false, headers: { location: "http://169.254.169.254/" } };
      }) as unknown as typeof fetch,
    });

    expect(init?.redirect).toBe("manual");
    expect(outcome.status).toBe("dead");
    expect(outcome.error).toBe("redirected");
    expect((await store.get(row!.id))?.lastError).toBe("redirected");
  });
});

/* -------------------------------------------------------------------------- */

describe("Retry-After raises the wait and never lowers it", () => {
  async function delayFor(header: string): Promise<number> {
    const store = new MemoryDeliveryStore();
    await queueOne(store);
    const [row] = await store.claimDue(new Date(T0_MS), 1, "worker-1");
    const outcome = await attemptDelivery(store, row!, {
      checkTarget: allowTarget,
      secretFor: () => SECRET,
      now: () => T0_MS,
      // The random half pinned to zero, so the schedule floor is 500ms.
      rand: () => 0,
      fetchImpl: (async () => ({
        status: 429,
        ok: false,
        headers: { "retry-after": header },
      })) as unknown as typeof fetch,
    });
    return outcome.delayMs;
  }

  it("keeps the schedule when a shedding endpoint asks for zero", async () => {
    expect(await delayFor("0")).toBe(500);
  });

  it("keeps the schedule on an HTTP date that has already passed", async () => {
    // Thirty seconds of clock skew relative to Guardian, and no
    // misconfiguration anywhere: the header parses to a delay of zero.
    expect(await delayFor("Fri, 04 Sep 2026 11:59:30 GMT")).toBe(500);
  });

  it("still honours a longer wait, which is what the header is for", async () => {
    expect(await delayFor("120")).toBe(120_000);
  });

  it("does not burn the eight-attempt budget in a couple of seconds", async () => {
    const store = new MemoryDeliveryStore();
    await queueOne(store);
    let clock = T0_MS;
    const delays: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const [row] = await store.claimDue(new Date(clock), 1, "worker-1");
      if (!row) break;
      const outcome = await attemptDelivery(store, row, {
        checkTarget: allowTarget,
        secretFor: () => SECRET,
        now: () => clock,
        rand: () => 0,
        fetchImpl: (async () => ({
          status: 429,
          ok: false,
          headers: { "retry-after": "0" },
        })) as unknown as typeof fetch,
      });
      delays.push(outcome.delayMs);
      clock += outcome.delayMs;
    }
    expect(delays.slice(0, 7)).toEqual([500, 1_000, 2_000, 4_000, 8_000, 16_000, 32_000]);
    expect(delays.reduce((a, b) => a + b, 0)).toBeGreaterThan(60_000);
  });
});

/* -------------------------------------------------------------------------- */

describe("the target is checked immediately before every request", () => {
  it("kills a row whose name resolves somewhere it may not point, and signs nothing", async () => {
    const store = new MemoryDeliveryStore();
    const queued = await queueOne(store);
    const [row] = await store.claimDue(new Date(T0_MS), 1, "worker-1");

    let called = false;
    const outcome = await attemptDelivery(store, row!, {
      // The save-time check saw a public address. This one runs against what
      // the name answers now, which is the DNS rebinding case.
      checkTarget: () => ({ ok: false, reason: "resolves into private space" }),
      secretFor: () => SECRET,
      now: () => T0_MS,
      fetchImpl: (async () => {
        called = true;
        return { status: 200, ok: true, headers: {} };
      }) as unknown as typeof fetch,
    });

    expect(called).toBe(false);
    expect(outcome.status).toBe("dead");
    expect(outcome.error).toBe("target_refused");
    // Dead rather than retried: eight attempts at a refused target is eight
    // probes, and the outcome is readable from the dead-letter view.
    const stored = await store.get(queued.id);
    expect(stored?.status).toBe("dead");
  });

  it("uses the real check by default, so a caller cannot forget it", async () => {
    const store = new MemoryDeliveryStore();
    await enqueueDelivery(store, {
      customerId: "cus_1",
      kind: "tier.assigned",
      // Resolves nowhere. The real check refuses it without a request.
      url: "https://guardian-delivery-target.invalid/hook",
      payload: payload(),
    }, new Date(T0_MS));
    const [row] = await store.claimDue(new Date(T0_MS), 1, "worker-1");
    const outcome = await attemptDelivery(store, row!, {
      secretFor: () => SECRET,
      now: () => T0_MS,
      fetchImpl: (async () => {
        throw new Error("no request should be made against an unchecked target");
      }) as unknown as typeof fetch,
    });
    expect(outcome.error).toBe("target_refused");
  });
});

/* -------------------------------------------------------------------------- */

describe("a settle is fenced to the worker that holds the claim", () => {
  it("drops a stale worker's result rather than resurrecting a delivered row", async () => {
    const store = new MemoryDeliveryStore();
    const queued = await queueOne(store);

    // Worker A claims and then stalls past the claim timeout.
    const [held] = await store.claimDue(new Date(T0_MS), 1, "worker-a");
    expect(held?.claimedBy).toBe("worker-a");

    const later = T0_MS + 61_000;
    const [reclaimed] = await store.claimDue(new Date(later), 1, "worker-b");
    expect(reclaimed?.claimedBy).toBe("worker-b");

    // B delivers and settles.
    const bOutcome = await attemptDelivery(store, reclaimed!, {
      checkTarget: allowTarget,
      secretFor: () => SECRET,
      now: () => later,
      fetchImpl: (async () => ({ status: 204, ok: true, headers: {} })) as unknown as typeof fetch,
    });
    expect(bOutcome.status).toBe("delivered");
    expect(bOutcome.settled).toBe(true);

    // A resumes with its stale handle and its own failure.
    const aOutcome = await attemptDelivery(store, held!, {
      checkTarget: allowTarget,
      secretFor: () => SECRET,
      now: () => later + 30_000,
      fetchImpl: (async () => ({ status: 503, ok: false, headers: {} })) as unknown as typeof fetch,
    });
    expect(aOutcome.settled).toBe(false);

    const stored = await store.get(queued.id);
    expect(stored?.status).toBe("delivered");
    expect(stored?.deliveredAt).toBeInstanceOf(Date);
    // Still claimable would mean the customer gets the tier a third time.
    expect(await store.claimDue(new Date(later + 120_000), 5, "worker-c")).toEqual([]);
  });

  it("does not mark delivered a row another worker already failed", async () => {
    const store = new MemoryDeliveryStore();
    const queued = await queueOne(store);
    const [held] = await store.claimDue(new Date(T0_MS), 1, "worker-a");
    const later = T0_MS + 61_000;
    const [reclaimed] = await store.claimDue(new Date(later), 1, "worker-b");

    await attemptDelivery(store, reclaimed!, {
      checkTarget: allowTarget,
      secretFor: () => SECRET,
      now: () => later,
      rand: () => 0,
      fetchImpl: (async () => ({ status: 503, ok: false, headers: {} })) as unknown as typeof fetch,
    });
    const stale = await attemptDelivery(store, held!, {
      checkTarget: allowTarget,
      secretFor: () => SECRET,
      now: () => later + 1_000,
      fetchImpl: (async () => ({ status: 204, ok: true, headers: {} })) as unknown as typeof fetch,
    });

    expect(stale.settled).toBe(false);
    expect((await store.get(queued.id))?.deliveredAt).toBeNull();
  });

  it("settles normally where the claim is still held", async () => {
    const store = new MemoryDeliveryStore();
    await queueOne(store);
    const [row] = await store.claimDue(new Date(T0_MS), 1, "worker-a");
    const outcome = await attemptDelivery(store, row!, {
      checkTarget: allowTarget,
      secretFor: () => SECRET,
      now: () => T0_MS,
      fetchImpl: (async () => ({ status: 200, ok: true, headers: {} })) as unknown as typeof fetch,
    });
    expect(outcome.settled).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe("a store error on the claim does not stop delivery for everybody", () => {
  it("returns an empty pass instead of throwing out of the loop", async () => {
    const failing: DeliveryStore = {
      ...new MemoryDeliveryStore(),
      claimDue: async () => {
        throw Object.assign(new Error("connection terminated"), { code: "ECONNRESET" });
      },
    } as unknown as DeliveryStore;

    await expect(
      runDeliveryPass({ store: failing, secretFor: () => SECRET, checkTarget: allowTarget }),
    ).resolves.toEqual([]);
  });

  it("kills a row it cannot read rather than poisoning every pass", async () => {
    const good = {
      id: "wd_good",
      customerId: "cus_1",
      kind: "tier.assigned",
      url: URL,
      payload: payload(),
      actorUid: "a1b2c3",
      targetUid: "d4e5f6",
      tier: "T2",
      status: "delivering",
      attempt: 0,
      lastStatusCode: null,
      lastError: null,
      nextAttemptAt: new Date(T0_MS),
      deliveredAt: null,
      claimedAt: new Date(T0_MS),
      claimedBy: "worker-1",
      retention: "WATCH_30D",
      expiresAt: null,
      createdAt: new Date(T0_MS),
      updatedAt: new Date(T0_MS),
    };
    // One extra payload key, which is what a scorer deployed ahead of this
    // worker writes. The strict payload schema refuses it on read.
    const poison = {
      ...good,
      id: "wd_poison",
      payload: { ...payload(), reasonCode: "added_in_a_later_deploy" },
    };

    const updates: Array<Record<string, unknown>> = [];
    const db = {
      webhookDelivery: {
        create: async () => good,
        findUnique: async () => good,
        findMany: async () => [],
        update: async () => good,
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          updates.push({ ...args.where, ...args.data });
          return { count: 1 };
        },
      },
      // CLAIM_SQL has already committed by the time the rows are parsed, and it
      // orders by nextAttemptAt with no customer predicate, so a poison row
      // sorts first on every pass for every customer.
      $queryRawUnsafe: async () => [poison, good],
    };
    const { PrismaDeliveryStore } = await import("../src/delivery.js");
    const store = new PrismaDeliveryStore(db as never);

    const claimed = await store.claimDue(new Date(T0_MS), 10, "worker-1");
    expect(claimed.map((r) => r.id)).toEqual(["wd_good"]);
    expect(updates).toEqual([
      {
        id: "wd_poison",
        status: "dead",
        lastError: "unparseable_row",
        claimedAt: null,
        claimedBy: null,
      },
    ]);
  });

  it("stops attempting a batch that has outrun its own claim", async () => {
    const store = new MemoryDeliveryStore();
    for (let i = 0; i < 4; i += 1) await queueOne(store);

    let clock = T0_MS;
    let sent = 0;
    const outcomes = await runDeliveryPass({
      store,
      checkTarget: allowTarget,
      secretFor: () => SECRET,
      batchSize: 4,
      claimTimeoutMs: 60_000,
      now: () => clock,
      // Every send eats 25 seconds of the 60 second claim.
      fetchImpl: (async () => {
        sent += 1;
        clock += 25_000;
        return { status: 200, ok: true, headers: {} };
      }) as unknown as typeof fetch,
    });

    // Three land inside the claim; the fourth is left for whoever reclaims it
    // rather than attempted on a claim this worker no longer holds.
    expect(sent).toBe(3);
    expect(outcomes).toHaveLength(3);
  });
});
