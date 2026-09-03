import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { signPayload } from "@guardian/schema";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryCustomerStore } from "../src/customers.js";
import { MemoryEventQueue } from "../src/queue.js";
import { prismaRetentionDelegate, runRetentionSweep } from "../src/retention-job.js";
import { buildServer } from "../src/server.js";

const API_KEY = "gk_test_key";

function setup() {
  const customers = new MemoryCustomerStore();
  const customer = customers.create("cus_1", "Test Guild", API_KEY);
  const queue = new MemoryEventQueue();
  const store = new MemoryAuditStore();
  const audit = new AuditLog(store, "test-secret");
  const app = buildServer({ customers, queue, audit });
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
