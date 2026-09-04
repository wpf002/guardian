import {
  FORBIDDEN_PAYLOAD_KEYS,
  findForbiddenPayloadKeys,
  verifySignature,
  type WebhookPayload,
} from "@guardian/schema";
import { describe, expect, it } from "vitest";
import {
  attemptDelivery,
  backoffMs,
  classifyStatus,
  DEFAULT_BACKOFF,
  enqueueDelivery,
  listDeadLetters,
  MemoryDeliveryStore,
  parseRetryAfter,
  redeliver,
  retentionForDelivery,
  type BackoffPolicy,
} from "../src/delivery.js";
import { runDeliveryPass, runDeliveryWorker } from "../src/delivery-worker.js";

const SECRET = "whsec_test_secret";
const URL = "https://customer.example/hooks/guardian";

/**
 * The target check runs immediately before every request against the address
 * the name resolves to right now, so it is injected here: customer.example does
 * not resolve, and a test about backoff should not be a test about DNS. The
 * refusal path has its own tests below.
 */
const allowTarget = (): { ok: true } => ({ ok: true });
const T0_MS = Date.parse("2026-09-04T12:00:00.000Z");

/** Fake clock. Nothing in these tests waits on a real timer except the abort. */
class Clock {
  constructor(public ms: number = T0_MS) {}
  now = (): number => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
}

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

function reply(status: number, headers: Record<string, string> = {}): Response {
  return { status, ok: status >= 200 && status < 300, headers } as unknown as Response;
}

interface Recorder {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit }>;
}

function recordingFetch(
  handler: (call: number, init: RequestInit) => Promise<Response> | Response,
): Recorder {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (input: unknown, init: unknown) => {
    const req = (init ?? {}) as RequestInit;
    calls.push({ url: String(input), init: req });
    return handler(calls.length, req);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

async function queueOne(store: MemoryDeliveryStore, clock: Clock, over = {}) {
  return enqueueDelivery(
    store,
    { customerId: "cus_1", kind: "tier.assigned", url: URL, payload: payload(over) },
    new Date(clock.now()),
  );
}

/**
 * Claim and attempt exactly one row, the way the worker does, so a test never
 * settles a row the store has not handed out.
 */
async function pass(
  store: MemoryDeliveryStore,
  clock: Clock,
  fetchImpl: typeof fetch,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  rand = (): number => 1,
) {
  const [row] = await store.claimDue(new Date(clock.now()), 1, "worker-1");
  if (!row) throw new Error("nothing due");
  return attemptDelivery(store, row, {
    fetchImpl,
    checkTarget: allowTarget,
    secretFor: () => SECRET,
    now: clock.now,
    rand,
    policy,
    timeoutMs: 50,
  });
}

describe("backoff", () => {
  it("doubles from one second and stays under the cap", () => {
    const nominal = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => backoffMs(n, DEFAULT_BACKOFF, () => 1));
    expect(nominal).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000]);

    // Equal jitter: the floor is half the nominal wait, never zero.
    const floor = [1, 2, 3, 4].map((n) => backoffMs(n, DEFAULT_BACKOFF, () => 0));
    expect(floor).toEqual([500, 1_000, 2_000, 4_000]);
  });

  it("caps a long schedule at one hour", () => {
    expect(backoffMs(30, DEFAULT_BACKOFF, () => 1)).toBe(DEFAULT_BACKOFF.capMs);
    expect(DEFAULT_BACKOFF.capMs).toBe(60 * 60 * 1_000);
  });

  it("keeps every jittered wait inside half the nominal and the nominal", () => {
    for (const r of [0, 0.13, 0.5, 0.87, 1]) {
      const ms = backoffMs(5, DEFAULT_BACKOFF, () => r);
      expect(ms).toBeGreaterThanOrEqual(8_000);
      expect(ms).toBeLessThanOrEqual(16_000);
    }
  });
});

describe("status classification", () => {
  it("treats 2xx as delivered, 408 429 5xx as retryable, other 4xx as dead", () => {
    expect([200, 201, 202, 204].map(classifyStatus)).toEqual(Array(4).fill("delivered"));
    expect([408, 429, 500, 502, 503, 504].map(classifyStatus)).toEqual(Array(6).fill("retry"));
    expect([400, 401, 403, 404, 409, 410, 422, 301].map(classifyStatus)).toEqual(
      Array(8).fill("dead"),
    );
  });
});

describe("retry-after", () => {
  it("reads the seconds form", () => {
    expect(parseRetryAfter("120", T0_MS)).toBe(120_000);
    expect(parseRetryAfter(" 30 ", T0_MS)).toBe(30_000);
  });

  it("reads the http-date form relative to now", () => {
    expect(parseRetryAfter("Fri, 04 Sep 2026 12:02:00 GMT", T0_MS)).toBe(120_000);
    // A date already past asks for no wait rather than a negative one.
    expect(parseRetryAfter("Fri, 04 Sep 2026 11:00:00 GMT", T0_MS)).toBe(0);
  });

  it("clamps to the cap and ignores nonsense", () => {
    expect(parseRetryAfter("999999", T0_MS)).toBe(DEFAULT_BACKOFF.capMs);
    expect(parseRetryAfter("soon", T0_MS)).toBeNull();
    expect(parseRetryAfter(null, T0_MS)).toBeNull();
    expect(parseRetryAfter(undefined, T0_MS)).toBeNull();
  });
});

describe("enqueue", () => {
  it("writes a row with the tier, the identifiers and a retention class", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const row = await queueOne(store, clock);

    expect(row.status).toBe("pending");
    expect(row.attempt).toBe(0);
    expect(row.tier).toBe("T2");
    expect(row.actorUid).toBe("a1b2c3");
    expect(row.targetUid).toBe("d4e5f6");
    expect(row.customerId).toBe("cus_1");
    expect(row.retention).toBe("WATCH_30D");
    expect(row.expiresAt?.getTime()).toBe(T0_MS + 30 * 24 * 60 * 60 * 1_000);
    expect(row.nextAttemptAt.getTime()).toBe(T0_MS);
  });

  it("puts a reviewer-confirmed T3 under the one year preservation class", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const row = await queueOne(store, clock, { tier: "T3" });
    expect(row.retention).toBe("CASE_1Y");
    expect(retentionForDelivery("T3")).toBe("CASE_1Y");
  });
});

describe("no message text on a delivery row", () => {
  it("refuses a payload carrying chat content", async () => {
    const store = new MemoryDeliveryStore();
    const withText = { ...payload(), text: "hey are your parents home" };
    await expect(
      enqueueDelivery(store, {
        customerId: "cus_1",
        kind: "tier.assigned",
        url: URL,
        // The strict schema is the point of the cast: this is what a caller
        // building the payload by hand would try to do.
        payload: withText as never,
      }),
    ).rejects.toThrow();
    expect(store.rows.size).toBe(0);
  });

  it("names a nested content key rather than dropping it quietly", () => {
    const nested = { tier: "T2", evidence: { timeline: [{ excerpt: "..." }] } };
    const found = findForbiddenPayloadKeys(nested);
    expect(found).toContain("evidence.timeline");
    expect(found).toContain("evidence.timeline[0].excerpt");
    expect(FORBIDDEN_PAYLOAD_KEYS).toContain("transcript");
  });

  it("stores and sends the tier and the identifiers only", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const row = await queueOne(store, clock);

    expect(findForbiddenPayloadKeys(row.payload)).toEqual([]);
    expect(findForbiddenPayloadKeys(JSON.parse(JSON.stringify(row)))).toEqual([]);

    const fetcher = recordingFetch(() => reply(200));
    await pass(store, clock, fetcher.impl);
    const sent = JSON.parse(String(fetcher.calls[0]?.init.body)) as Record<string, unknown>;
    expect(findForbiddenPayloadKeys(sent)).toEqual([]);
    expect(Object.keys(sent).sort()).toEqual([
      "criticalSignals",
      "customerId",
      "event",
      "actorUid",
      "rationale",
      "scoredAt",
      "targetUid",
      "tier",
      "versions",
    ].sort());
  });
});

describe("signing", () => {
  it("signs the timestamp and the body, so existing SDK verification holds", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    await queueOne(store, clock);

    const fetcher = recordingFetch(() => reply(204));
    await pass(store, clock, fetcher.impl);

    const call = fetcher.calls[0]!;
    const headers = call.init.headers as Record<string, string>;
    const body = String(call.init.body);
    const ts = Number(headers["x-guardian-timestamp"]);

    expect(ts).toBe(Math.floor(T0_MS / 1_000));
    const check = verifySignature(body, SECRET, ts, headers["x-guardian-signature"]!, {
      now: clock.now,
    });
    expect(check.ok).toBe(true);
  });
});

describe("attempt outcomes", () => {
  it("marks a 2xx delivered and stops", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const queued = await queueOne(store, clock);

    const fetcher = recordingFetch(() => reply(200));
    const outcome = await pass(store, clock, fetcher.impl);

    expect(outcome.status).toBe("delivered");
    expect(outcome.attempt).toBe(1);
    const stored = await store.get(queued.id);
    expect(stored?.status).toBe("delivered");
    expect(stored?.deliveredAt?.getTime()).toBe(T0_MS);
    expect(await store.claimDue(new Date(clock.now()), 10, "w")).toEqual([]);
  });

  it("kills a 400 on the first attempt rather than burning the schedule", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const queued = await queueOne(store, clock);

    const fetcher = recordingFetch(() => reply(400));
    const outcome = await pass(store, clock, fetcher.impl);

    expect(outcome.status).toBe("dead");
    expect(outcome.attempt).toBe(1);
    expect(fetcher.calls).toHaveLength(1);
    expect((await store.get(queued.id))?.lastStatusCode).toBe(400);

    // Nothing reschedules it, however far the clock moves.
    clock.advance(24 * 60 * 60 * 1_000);
    expect(await store.claimDue(new Date(clock.now()), 10, "w")).toEqual([]);
  });

  it("retries a 5xx on the doubling schedule", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const queued = await queueOne(store, clock);
    const fetcher = recordingFetch(() => reply(503));

    const waits: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const outcome = await pass(store, clock, fetcher.impl);
      expect(outcome.status).toBe("failed");
      waits.push(outcome.delayMs);
      clock.advance(outcome.delayMs);
    }

    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(fetcher.calls).toHaveLength(4);
    expect((await store.get(queued.id))?.attempt).toBe(4);
    expect((await store.get(queued.id))?.lastError).toBe("http_503");
  });

  it("retries a network failure and a timeout", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    await queueOne(store, clock);

    const fetcher = recordingFetch((call, init) => {
      if (call === 1) return Promise.reject(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
      // Never resolves. The 50ms timeout in `pass` aborts it.
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    const first = await pass(store, clock, fetcher.impl);
    expect(first.status).toBe("failed");
    expect(first.error).toBe("Error ECONNREFUSED");

    clock.advance(first.delayMs);
    const second = await pass(store, clock, fetcher.impl);
    expect(second.status).toBe("failed");
    expect(second.error).toContain("AbortError");
  });

  it("honours Retry-After instead of its own schedule", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    await queueOne(store, clock);

    const fetcher = recordingFetch((call) =>
      call === 1
        ? reply(429, { "retry-after": "120" })
        : reply(503, { "retry-after": "Fri, 04 Sep 2026 12:07:00 GMT" }),
    );

    const first = await pass(store, clock, fetcher.impl);
    expect(first.status).toBe("failed");
    expect(first.delayMs).toBe(120_000);
    expect(first.nextAttemptAt.getTime()).toBe(T0_MS + 120_000);

    clock.advance(120_000);
    const second = await pass(store, clock, fetcher.impl);
    // 12:07:00 from a clock now reading 12:02:00.
    expect(second.delayMs).toBe(300_000);
  });

  it("dies after the eighth attempt", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const queued = await queueOne(store, clock);
    const fetcher = recordingFetch(() => reply(500));

    const statuses: string[] = [];
    for (let i = 0; i < DEFAULT_BACKOFF.maxAttempts; i += 1) {
      const outcome = await pass(store, clock, fetcher.impl);
      statuses.push(outcome.status);
      clock.advance(outcome.delayMs);
    }

    expect(statuses.slice(0, 7)).toEqual(Array(7).fill("failed"));
    expect(statuses[7]).toBe("dead");
    expect(fetcher.calls).toHaveLength(8);

    const stored = await store.get(queued.id);
    expect(stored?.status).toBe("dead");
    expect(stored?.attempt).toBe(8);

    clock.advance(24 * 60 * 60 * 1_000);
    expect(await store.claimDue(new Date(clock.now()), 10, "w")).toEqual([]);
  });

  it("kills a delivery with no signing secret rather than retrying it forever", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const queued = await queueOne(store, clock);
    const [row] = await store.claimDue(new Date(clock.now()), 10, "w");
    const fetcher = recordingFetch(() => reply(200));

    const outcome = await attemptDelivery(store, row!, {
      checkTarget: allowTarget,
      fetchImpl: fetcher.impl,
      secretFor: () => null,
      now: clock.now,
    });

    expect(outcome.status).toBe("dead");
    expect(fetcher.calls).toHaveLength(0);
    expect((await store.get(queued.id))?.lastError).toBe("missing_webhook_secret");
  });
});

describe("the claim", () => {
  it("hands one row to one worker, so two workers cannot double-send", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    await queueOne(store, clock);

    const fetcher = recordingFetch(() => reply(200));
    const deps = {
      store,
      checkTarget: allowTarget,
      secretFor: (): string => SECRET,
      fetchImpl: fetcher.impl,
      now: clock.now,
      timeoutMs: 50,
    };

    const [a, b] = await Promise.all([
      runDeliveryPass({ ...deps, workerName: "worker-a" }),
      runDeliveryPass({ ...deps, workerName: "worker-b" }),
    ]);

    expect(fetcher.calls).toHaveLength(1);
    expect(a.length + b.length).toBe(1);
  });

  it("reclaims a row whose worker died mid-attempt", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const queued = await queueOne(store, clock);

    const [claimed] = await store.claimDue(new Date(clock.now()), 10, "worker-gone");
    expect(claimed?.status).toBe("delivering");
    expect(claimed?.claimedBy).toBe("worker-gone");

    // Still held, so nobody else takes it.
    expect(await store.claimDue(new Date(clock.now()), 10, "worker-b")).toEqual([]);

    clock.advance(61_000);
    const [reclaimed] = await store.claimDue(new Date(clock.now()), 10, "worker-b");
    expect(reclaimed?.id).toBe(queued.id);
    expect(reclaimed?.claimedBy).toBe("worker-b");
  });

  it("leaves a row that is not yet due alone", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    await queueOne(store, clock);
    const fetcher = recordingFetch(() => reply(500));

    const outcome = await pass(store, clock, fetcher.impl);
    expect(outcome.status).toBe("failed");

    clock.advance(outcome.delayMs - 1);
    expect(await store.claimDue(new Date(clock.now()), 10, "w")).toEqual([]);
    clock.advance(1);
    expect(await store.claimDue(new Date(clock.now()), 10, "w")).toHaveLength(1);
  });
});

describe("dead letters", () => {
  it("lists what died for one customer and nothing from another", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    await queueOne(store, clock);
    await enqueueDelivery(
      store,
      {
        customerId: "cus_2",
        kind: "tier.assigned",
        url: URL,
        payload: payload({ customerId: "cus_2" }),
      },
      new Date(clock.now()),
    );

    const fetcher = recordingFetch(() => reply(403));
    await pass(store, clock, fetcher.impl);
    await pass(store, clock, fetcher.impl);

    const one = await listDeadLetters(store, "cus_1");
    expect(one).toHaveLength(1);
    expect(one[0]?.customerId).toBe("cus_1");
    expect(await listDeadLetters(store, "cus_2")).toHaveLength(1);
    expect(await listDeadLetters(store, "cus_3")).toEqual([]);
  });

  it("redelivers a dead row with the schedule reset, and refuses a live one", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    const queued = await queueOne(store, clock);

    const fetcher = recordingFetch((call) => (call === 1 ? reply(404) : reply(200)));
    await pass(store, clock, fetcher.impl);
    expect((await store.get(queued.id))?.status).toBe("dead");

    clock.advance(60_000);
    const back = await redeliver(store, queued.id, new Date(clock.now()));
    expect(back?.status).toBe("pending");
    expect(back?.attempt).toBe(0);
    expect(back?.lastError).toBeNull();

    const outcome = await pass(store, clock, fetcher.impl);
    expect(outcome.status).toBe("delivered");

    // Already delivered, so there is nothing to put back.
    expect(await redeliver(store, queued.id, new Date(clock.now()))).toBeNull();
    expect(await redeliver(store, "wd_missing", new Date(clock.now()))).toBeNull();
  });
});

describe("the worker loop", () => {
  it("drains the queue and stops when told to", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    for (let i = 0; i < 3; i += 1) await queueOne(store, clock);

    const fetcher = recordingFetch(() => reply(200));
    let passes = 0;
    let stopping = false;

    await runDeliveryWorker(
      {
        store,
        checkTarget: allowTarget,
        secretFor: () => SECRET,
        fetchImpl: fetcher.impl,
        now: clock.now,
        timeoutMs: 50,
        batchSize: 2,
        sleep: async () => {
          passes += 1;
          // Third pass finds nothing left; that is the shutdown signal here.
          if (passes >= 3) stopping = true;
        },
      },
      () => stopping,
    );

    expect(fetcher.calls).toHaveLength(3);
    expect([...store.rows.values()].every((row) => row.status === "delivered")).toBe(true);
  });

  it("returns without attempting anything when it is already stopping", async () => {
    const store = new MemoryDeliveryStore();
    const clock = new Clock();
    await queueOne(store, clock);
    const fetcher = recordingFetch(() => reply(200));

    await runDeliveryWorker(
      {
        store,
        checkTarget: allowTarget,
        secretFor: () => SECRET,
        fetchImpl: fetcher.impl,
        now: clock.now,
      },
      () => true,
    );

    expect(fetcher.calls).toHaveLength(0);
    expect((await store.claimDue(new Date(clock.now()), 10, "w"))).toHaveLength(1);
  });
});
