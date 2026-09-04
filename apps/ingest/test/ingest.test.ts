import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { signPayload } from "@guardian/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryCustomerStore } from "../src/customers.js";
import { MemoryEventQueue, RedisEventQueue } from "../src/queue.js";
import { prismaRetentionDelegate, runRetentionSweep } from "../src/retention-job.js";
import { buildServer, SourceRateLimiter, type ServerDeps } from "../src/server.js";

const API_KEY = "gk_test_key";

function setup(overrides: Partial<ServerDeps> = {}) {
  const customers = new MemoryCustomerStore();
  const customer = customers.create("cus_1", "Test Guild", API_KEY);
  const queue = new MemoryEventQueue();
  const store = new MemoryAuditStore();
  const audit = new AuditLog(store, "test-secret");
  const app = buildServer({ customers, queue, audit, ...overrides });
  return { app, customers, customer, queue, audit, store };
}

const validEvent = {
  externalId: "msg-1",
  actorUid: "discord-user-111",
  targetUid: "discord-user-222",
  channel: "general",
  ts: "2026-09-02T12:00:00Z",
  text: "hey how are you",
  actorBand: "A21_PLUS",
  targetBand: "A9_12",
  provenance: { surface: "discord", sourceId: "guild-1" },
};

async function post(app: ReturnType<typeof buildServer>, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: "POST",
    url: "/v1/events",
    headers: { "content-type": "application/json", "x-guardian-key": API_KEY, ...headers },
    payload: JSON.stringify(payload),
  });
}

describe("auth", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("rejects a missing key", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(validEvent),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unknown key", async () => {
    const res = await post(ctx.app, validEvent, { "x-guardian-key": "nope" });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a correctly signed request", async () => {
    const body = JSON.stringify(validEvent);
    const ts = Math.floor(Date.now() / 1000);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/events",
      headers: {
        "content-type": "application/json",
        "x-guardian-key": API_KEY,
        "x-guardian-timestamp": String(ts),
        "x-guardian-signature": signPayload(body, ctx.customer.webhookSecret, ts),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(202);
  });

  it("rejects a signature over different bytes", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const res = await post(ctx.app, validEvent, {
      "x-guardian-timestamp": String(ts),
      "x-guardian-signature": signPayload("{}", ctx.customer.webhookSecret, ts),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain("bad_signature");
  });
});

// G-01. The chain is append-only and shared by every customer, so nothing an
// unauthenticated caller does may append to it.
describe("refusals before authentication", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("does not write to the audit chain for a binary post with no key", async () => {
    for (let i = 0; i < 25; i += 1) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/v1/events",
        headers: { "content-type": "image/png" },
        payload: Buffer.from("not really a png"),
      });
      expect(res.statusCode).toBe(401);
    }
    expect((await ctx.audit.head()).seq).toBe(0);
    expect(ctx.app.counters.preAuthRefusals.missing_key).toBe(25);
  });

  it("does not write to the audit chain for a binary post with an unknown key", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "video/mp4", "x-guardian-key": "nope" },
      payload: Buffer.from("bytes"),
    });
    expect(res.statusCode).toBe(401);
    expect((await ctx.audit.head()).seq).toBe(0);
    expect(ctx.app.counters.preAuthRefusals.unknown_key).toBe(1);
  });

  it("still records a binary post from an authenticated customer", async () => {
    const res = await post(ctx.app, validEvent, { "content-type": "image/png" });
    expect(res.statusCode).toBe(422);
    const entries = await ctx.store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("customer.violation");
    expect(entries[0]!.customerId).toBe("cus_1");
  });

  it("reports pre-auth refusals through the hook with a fixed reason only", async () => {
    const seen: string[] = [];
    const hooked = setup({ onPreAuthRefusal: (reason) => seen.push(reason) });
    await hooked.app.inject({ method: "POST", url: "/v1/events", headers: { "content-type": "image/png" }, payload: "x" });
    await post(hooked.app, validEvent, { "x-guardian-key": "nope" });
    expect(seen).toEqual(["missing_key", "unknown_key"]);
  });

  it("rate limits a source address before any key lookup or chain write", async () => {
    const limited = setup({ preAuthRateLimit: { max: 3, windowMs: 60_000 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await limited.app.inject({
        method: "POST",
        url: "/v1/events",
        headers: { "content-type": "image/png" },
        payload: "x",
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    expect((await limited.audit.head()).seq).toBe(0);
    expect(limited.app.counters.preAuthRefusals.rate_limited).toBe(2);
  });

  it("gives two customers behind one source address their own budgets", async () => {
    // Behind a platform proxy every customer is the same TCP peer. The quota
    // has to be charged to the key, or one flood refuses everyone.
    const ctx = setup({ rateLimit: { max: 2, windowMs: 60_000 }, preAuthRateLimit: false });
    const second = ctx.customers.create("cus_2", "Second Guild", "gk_second_key");
    expect(second.id).toBe("cus_2");

    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await post(ctx.app, { ...validEvent, externalId: `a-${i}` });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([202, 202, 429, 429]);
    expect(ctx.app.counters.rateLimited).toBe(2);

    // The second customer's budget is untouched by the first one's flood.
    const other = await ctx.app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "application/json", "x-guardian-key": "gk_second_key" },
      payload: JSON.stringify({ ...validEvent, externalId: "b-1" }),
    });
    expect(other.statusCode).toBe(202);
  });

  it("does not spend the customer quota on an unauthenticated request", async () => {
    const ctx = setup({ rateLimit: { max: 1, windowMs: 60_000 }, preAuthRateLimit: false });
    for (let i = 0; i < 5; i += 1) {
      await post(ctx.app, validEvent, { "x-guardian-key": "nope" });
    }
    const res = await post(ctx.app, validEvent);
    expect(res.statusCode).toBe(202);
  });

  it("limits per key and resets with the window", () => {
    let clock = 0;
    const limiter = new SourceRateLimiter({ max: 2, windowMs: 1000 }, () => clock);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    expect(limiter.allow("b")).toBe(true);
    clock = 1000;
    expect(limiter.allow("a")).toBe(true);
  });
});

// CLAUDE.md rule 1. These are the paths a customer could use to push bytes in.
describe("media rejection", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("refuses multipart uploads at the content type", async () => {
    const res = await post(ctx.app, validEvent, { "content-type": "multipart/form-data; boundary=x" });
    expect(res.statusCode).toBe(422);
    expect(res.json().violations[0].reason).toBe("binary_content_type");
  });

  it("refuses an image content type", async () => {
    const res = await post(ctx.app, validEvent, { "content-type": "image/png" });
    expect(res.statusCode).toBe(422);
  });

  it("refuses a data uri hidden in the text field", async () => {
    const res = await post(ctx.app, { ...validEvent, text: "data:image/png;base64,iVBORw0KGgo=" });
    expect(res.statusCode).toBe(422);
    expect(res.json().violations[0].reason).toBe("data_uri");
  });

  it("refuses a long base64 run in any field", async () => {
    const res = await post(ctx.app, { ...validEvent, text: "A".repeat(600) });
    expect(res.statusCode).toBe(422);
    expect(res.json().violations[0].reason).toBe("base64_blob");
  });

  it("refuses a byte carrying field name even when nested", async () => {
    const res = await post(ctx.app, { ...validEvent, extra: { attachment: { bytes: "x" } } });
    expect(res.statusCode).toBe(422);
    expect(res.json().violations[0].at).toContain("bytes");
  });

  it("refuses a link to media, because Guardian does not fetch media", async () => {
    const res = await post(ctx.app, { ...validEvent, text: "look https://cdn.example.com/a.jpg" });
    expect(res.statusCode).toBe(422);
    expect(res.json().violations[0].reason).toBe("media_url");
  });

  it("refuses an oversized body before buffering it", async () => {
    const res = await post(ctx.app, { ...validEvent, channel: "c".repeat(100_000) });
    // Fastify's own bodyLimit fires first, which is the point: the bytes are
    // refused at the socket rather than read into memory and then checked.
    expect(res.statusCode).toBe(413);
    expect(ctx.queue.published).toHaveLength(0);
  });

  it("accepts a sha256 hash and an operator verdict", async () => {
    const res = await post(ctx.app, {
      ...validEvent,
      media: { sha256: "a".repeat(64), knownCsamVerdict: "no_match", kind: "image" },
    });
    expect(res.statusCode).toBe(202);
    expect(ctx.queue.eventsFor("cus_1")[0]!.media?.sha256).toBe("a".repeat(64));
  });

  it("records the refusal against the customer, with no content", async () => {
    await post(ctx.app, { ...validEvent, text: "data:image/png;base64,iVBORw0KGgo=" });
    const entries = await ctx.store.read();
    const violation = entries.find((e) => e.kind === "customer.violation");
    expect(violation).toBeDefined();
    expect(JSON.stringify(violation!.payload)).not.toContain("iVBORw0KGgo");
  });

  it("never queues an event from a refused request", async () => {
    await post(ctx.app, { ...validEvent, text: "data:image/png;base64,iVBORw0KGgo=" });
    expect(ctx.queue.published).toHaveLength(0);
  });
});

describe("pii minimization", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("replaces customer user ids with salted hashes", async () => {
    await post(ctx.app, validEvent);
    const [event] = ctx.queue.eventsFor("cus_1");
    expect(event!.actorUid).not.toBe("discord-user-111");
    expect(event!.actorUid).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event)).not.toContain("discord-user-111");
  });

  it("gives different hashes to different customers for the same uid", async () => {
    const other = setup();
    other.customers.create("cus_2", "Other", API_KEY + "2");
    await post(ctx.app, validEvent);
    const otherApp = other.app;
    await otherApp.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "application/json", "x-guardian-key": API_KEY },
      payload: JSON.stringify(validEvent),
    });
    expect(ctx.queue.eventsFor("cus_1")[0]!.actorUid).not.toBe(
      other.queue.eventsFor("cus_1")[0]!.actorUid,
    );
  });

  it("hashes device and network hints", async () => {
    await post(ctx.app, {
      ...validEvent,
      deviceHints: { deviceIdHash: "device-abc", ipHash: "203.0.113.4" },
    });
    const [event] = ctx.queue.eventsFor("cus_1");
    expect(event!.deviceHints?.ipHash).not.toContain("203.0.113");
  });

  it("stamps a retention class and expiry on every event", async () => {
    await post(ctx.app, validEvent);
    const [event] = ctx.queue.eventsFor("cus_1");
    expect(event!.retention).toBe("EPHEMERAL_24H");
    expect(new Date(event!.expiresAt).getTime()).toBeGreaterThan(new Date(event!.ts).getTime());
  });

  it("stamps the expiry from receipt, not from the customer's clock", async () => {
    // A backdated event still gets a full 24 hours from receipt, and a ts
    // years ahead cannot buy retention the class does not allow (rule 7).
    const before = Date.now();
    await post(ctx.app, { ...validEvent, externalId: "old-1", ts: "2020-01-01T00:00:00Z" });
    const [event] = ctx.queue.eventsFor("cus_1");
    const expiry = new Date(event!.expiresAt).getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + 86_400_000 - 5_000);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 86_400_000 + 5_000);
    expect(new Date(event!.provenance.receivedAt!).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("refuses an event timestamped far in the future", async () => {
    const res = await post(ctx.app, { ...validEvent, externalId: "future-1", ts: "2099-01-01T00:00:00Z" });
    expect(res.statusCode).toBe(207);
    expect(res.json().rejected[0].error).toContain("future");
    expect(ctx.queue.eventsFor("cus_1")).toHaveLength(0);
  });

  it("carries age band provenance and channel visibility through to the stored event", async () => {
    await post(ctx.app, {
      ...validEvent,
      externalId: "prov-1",
      actorBandProvenance: "server_role",
      actorBandConfidence: 0.82,
      targetBandProvenance: "platform_default",
      channelVisibility: "public",
    });
    const event = ctx.queue.eventsFor("cus_1").find((e) => e.externalId === "prov-1");
    expect(event!.actorBandProvenance).toBe("server_role");
    expect(event!.actorBandConfidence).toBe(0.82);
    expect(event!.targetBandProvenance).toBe("platform_default");
    expect(event!.channelVisibility).toBe("public");
  });

  it("leaves an unstated provenance absent rather than inventing one", async () => {
    // A confidence nobody published must not read back as zero, and a
    // visibility nobody stated must not read back as public: absent is what
    // treatAsPrivateMessaging turns into the stricter rule.
    await post(ctx.app, { ...validEvent, externalId: "prov-2" });
    const event = ctx.queue.eventsFor("cus_1").find((e) => e.externalId === "prov-2");
    expect(event!.actorBandConfidence).toBeNull();
    expect(event!.actorBandProvenance).toBeNull();
    expect(event!.channelVisibility).toBeNull();
  });

  it("takes the customer id from the key and not from the body", async () => {
    await post(ctx.app, { ...validEvent, customerId: "cus_someone_else" });
    // customerId is not in the inbound schema, so the strict parse rejects it.
    const [event] = ctx.queue.eventsFor("cus_1");
    expect(event).toBeUndefined();
  });
});

describe("batches and validation", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("accepts a batch", async () => {
    const res = await post(ctx.app, {
      events: [validEvent, { ...validEvent, externalId: "msg-2" }],
    });
    expect(res.statusCode).toBe(202);
    expect(ctx.queue.eventsFor("cus_1")).toHaveLength(2);
  });

  it("reports per item errors without dropping the good ones", async () => {
    const res = await post(ctx.app, {
      events: [validEvent, { ...validEvent, externalId: "msg-2", ts: "not a date" }],
    });
    expect(res.statusCode).toBe(207);
    expect(res.json().accepted).toBe(1);
    expect(res.json().rejected).toHaveLength(1);
  });

  it("caps batch size", async () => {
    const res = await post(ctx.app, { events: new Array(501).fill(validEvent) });
    expect(res.statusCode).toBe(413);
  });

  it("logs an ingest entry carrying no message text", async () => {
    await post(ctx.app, validEvent);
    const entries = await ctx.store.read();
    const ingested = entries.find((e) => e.kind === "event.ingested");
    expect(ingested).toBeDefined();
    expect(JSON.stringify(ingested!.payload)).not.toContain("hey how are you");
  });

  it("keeps the audit chain verifiable across a mix of accepts and refusals", async () => {
    await post(ctx.app, validEvent);
    await post(ctx.app, { ...validEvent, text: "data:image/png;base64,iVBORw0KGgo=" });
    await post(ctx.app, { ...validEvent, externalId: "msg-3" });
    const result = await ctx.audit.verify();
    expect(result.ok).toBe(true);
  });

  // G-07. The events are on the stream before the ingest entry is appended. A
  // 500 here would make the customer replay a batch the scorer already has.
  it("answers 202 with audited false when the chain append fails after publish", async () => {
    const failing = setup();
    failing.audit.append = async () => {
      throw new Error("advisory lock wait timed out");
    };
    const res = await post(failing.app, { events: [validEvent, { ...validEvent, externalId: "msg-2" }] });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: 2, rejected: [], audited: false });
    expect(failing.queue.eventsFor("cus_1")).toHaveLength(2);
    expect(failing.app.counters.auditAppendFailures).toBe(1);
  });
});

// G-06. Per-customer partitions isolate consumer latency, not Redis memory.
describe("queue backpressure", () => {
  it("answers 429 and publishes nothing when the customer's partition is full", async () => {
    const ctx = setup();
    ctx.queue.full = true;
    const res = await post(ctx.app, { events: [validEvent] });
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(ctx.queue.published).toHaveLength(0);
    expect(ctx.app.counters.queueFull).toBe(1);
  });

  it("trims the stream on every append and reports full at the backpressure mark", async () => {
    const calls: Array<Array<string | number>> = [];
    let length = 0;
    const redis = {
      async xadd(key: string, ...args: Array<string | number>) {
        calls.push([key, ...args]);
        return "1-0";
      },
      async xlen() {
        return length;
      },
    };
    const queue = new RedisEventQueue(redis, { maxLen: 100 });
    await queue.publish("cus_1", {
      externalId: "m1",
      customerId: "cus_1",
      actorUid: "a",
      targetUid: "b",
      channel: "c",
      ts: new Date("2026-09-02T12:00:00Z"),
      text: null,
      media: null,
      actorBand: "UNKNOWN",
      targetBand: "UNKNOWN",
      actorRole: "unknown",
      actorAccountAgeHours: null,
      deviceHints: null,
      provenance: { surface: "discord", sourceId: "g", receivedAt: new Date() },
      retention: "EPHEMERAL_24H",
      expiresAt: new Date("2026-09-03T12:00:00Z"),
    });
    expect(calls[0]!.slice(0, 5)).toEqual(["guardian:events:cus_1", "MAXLEN", "~", "100", "*"]);
    expect(await queue.isFull("cus_1")).toBe(false);
    length = 90;
    expect(await queue.isFull("cus_1")).toBe(true);
  });
});

describe("health", () => {
  it("answers without a key", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });
});

describe("retention sweep", () => {
  it("clears T0 text, deletes expired rows, and logs the sweep", async () => {
    const { audit, store } = setup();
    const calls: string[] = [];
    const delegate = {
      async clearExpiredText(cutoff: Date) {
        calls.push(`text:${cutoff.toISOString()}`);
        return 12;
      },
      async deleteExpiredEvents() {
        calls.push("events");
        return 5;
      },
      async deleteExpiredPairs() {
        calls.push("pairs");
        return 2;
      },
      async deleteExpiredActors() {
        calls.push("actors");
        return 1;
      },
      async deleteExpiredBundles() {
        calls.push("bundles");
        return 0;
      },
    };

    const now = new Date("2026-09-02T12:00:00Z");
    const result = await runRetentionSweep(delegate, audit, now);

    expect(result.textCleared).toBe(12);
    expect(result.eventsDeleted).toBe(5);
    expect(calls[0]).toBe("text:2026-09-01T12:00:00.000Z");

    const entries = await store.read();
    const swept = entries.find((e) => e.kind === "retention.deleted");
    expect(swept).toBeDefined();
    expect(swept!.payload.eventsDeleted).toBe(5);
  });

  it("logs a sweep that deleted nothing, so a gap means the job stopped", async () => {
    const { audit, store } = setup();
    const noop = {
      clearExpiredText: async () => 0,
      deleteExpiredEvents: async () => 0,
      deleteExpiredPairs: async () => 0,
      deleteExpiredActors: async () => 0,
      deleteExpiredBundles: async () => 0,
    };
    await runRetentionSweep(noop, audit);
    const entries = await store.read();
    expect(entries.some((e) => e.kind === "retention.deleted")).toBe(true);
  });

  // G-08. reviews.pairId is Restrict, so one expired reviewed pair used to
  // abort the whole statement and, with it, every later step of the sweep.
  it("runs the remaining steps and records the failure when one step throws", async () => {
    const { audit, store } = setup();
    const calls: string[] = [];
    const delegate = {
      clearExpiredText: async () => 3,
      deleteExpiredEvents: async () => 4,
      async deleteExpiredPairs() {
        const err = new Error("Foreign key constraint violated: reviews_pairId_fkey") as Error & { code: string };
        err.code = "P2003";
        throw err;
      },
      async deleteExpiredActors() {
        calls.push("actors");
        return 2;
      },
      async deleteExpiredBundles() {
        calls.push("bundles");
        return 1;
      },
    };
    const result = await runRetentionSweep(delegate, audit, new Date("2026-09-02T12:00:00Z"));
    expect(calls).toEqual(["actors", "bundles"]);
    expect(result.actorsDeleted).toBe(2);
    expect(result.bundlesDeleted).toBe(1);
    expect(result.pairsDeleted).toBe(0);
    expect(result.errors).toEqual([{ step: "pairs", error: "Error P2003" }]);

    const entries = await store.read();
    const swept = entries.find((e) => e.kind === "retention.deleted");
    expect(swept).toBeDefined();
    expect(swept!.payload.errors).toEqual([{ step: "pairs", error: "Error P2003" }]);
    expect(JSON.stringify(swept!.payload)).not.toContain("reviews_pairId_fkey");
  });

  it("skips pairs that carry a review", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const capture = {
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        seen.push(args.where);
        return { count: 0 };
      },
    };
    const delegate = prismaRetentionDelegate({
      event: { ...capture, updateMany: async () => ({ count: 0 }) },
      pair: capture,
      actor: capture,
      evidenceBundle: capture,
    });
    await delegate.deleteExpiredPairs(new Date());
    expect(seen[0]!.reviews).toEqual({ none: {} });
    expect(seen[0]!.resolvedAt).toBeNull();
  });

  it("clears T0 text on the column the server stamped, not the customer's ts", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const capture = {
      deleteMany: async () => ({ count: 0 }),
    };
    const delegate = prismaRetentionDelegate({
      event: {
        ...capture,
        updateMany: async (args: { where: Record<string, unknown> }) => {
          seen.push(args.where);
          return { count: 0 };
        },
      },
      pair: capture,
      actor: capture,
      evidenceBundle: capture,
    });
    const cutoff = new Date("2026-09-02T12:00:00Z");
    await delegate.clearExpiredText(cutoff);
    expect(seen[0]!.createdAt).toEqual({ lt: cutoff });
    expect(seen[0]!.ts).toBeUndefined();
  });

  it("never deletes a legal hold", () => {
    const seen: Array<Record<string, unknown>> = [];
    const capture = {
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        seen.push(args.where);
        return { count: 0 };
      },
    };
    const delegate = prismaRetentionDelegate({
      event: { ...capture, updateMany: async () => ({ count: 0 }) },
      pair: capture,
      actor: capture,
      evidenceBundle: capture,
    });

    return Promise.all([
      delegate.deleteExpiredEvents(new Date()),
      delegate.deleteExpiredPairs(new Date()),
      delegate.deleteExpiredActors(new Date()),
      delegate.deleteExpiredBundles(new Date()),
    ]).then(() => {
      expect(seen).toHaveLength(4);
      for (const where of seen) {
        expect(where.retention).toEqual({ not: "LEGAL_HOLD" });
      }
    });
  });
});
