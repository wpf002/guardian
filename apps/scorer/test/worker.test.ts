import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { describe, expect, it } from "vitest";
import { Kernel } from "../src/kernel.js";
import { MemoryKernelStore } from "../src/store.js";
import { CONSUMER_GROUP, deadLetterKey, runWorker, streamKey } from "../src/worker.js";

/**
 * Worker delivery rules. Two of them are load bearing: an entry is never
 * acknowledged on a guess about what another consumer is doing with it, and
 * nothing that reaches the dead-letter stream carries the message text.
 */

const CUSTOMER = "cus_worker";
const STREAM = streamKey(CUSTOMER);

/** One event as ingest publishes it: a single "event" field holding the JSON. */
function queuedEvent(text: string): string[] {
  return [
    "event",
    JSON.stringify({
      externalId: "m1",
      customerId: CUSTOMER,
      actorUid: "a".repeat(64),
      targetUid: "b".repeat(64),
      channel: "general",
      ts: "2026-09-03T11:00:00.000Z",
      text,
      actorBand: "A21_PLUS",
      targetBand: "A9_12",
      actorRole: "member",
      provenance: { surface: "discord", sourceId: "guild-1", receivedAt: "2026-09-03T11:00:01.000Z" },
      retention: "EPHEMERAL_24H",
      expiresAt: "2026-09-04T11:00:00.000Z",
    }),
  ];
}

interface FakeOptions {
  /** Entries handed to the consumer on the first read. */
  messages?: Array<[string, string[]]>;
  /** What XPENDING reports. */
  pending?: Array<[string, string, number, number]>;
  /** What XCLAIM hands back. An omitted id models one another consumer took. */
  claimed?: Array<[string, string[]] | null>;
}

class FakeRedis {
  readonly acked: string[] = [];
  readonly added: unknown[][] = [];
  reads = 0;

  constructor(private readonly opts: FakeOptions) {}

  async xgroup(): Promise<unknown> {
    return "OK";
  }

  async xreadgroup(): Promise<unknown> {
    this.reads += 1;
    if (this.reads > 1) return null;
    const messages = this.opts.messages ?? [];
    return messages.length > 0 ? [[STREAM, messages]] : null;
  }

  async xpending(): Promise<unknown> {
    return this.opts.pending ?? [];
  }

  async xclaim(): Promise<unknown> {
    return this.opts.claimed ?? [];
  }

  async xack(_stream: unknown, _group: unknown, id: unknown): Promise<unknown> {
    this.acked.push(String(id));
    return 1;
  }

  async xadd(...args: unknown[]): Promise<unknown> {
    this.added.push(args);
    return "1-0";
  }
}

function worker(redis: FakeRedis, overrides: Record<string, unknown> = {}) {
  return runWorker(
    {
      redis,
      kernel: new Kernel({ store: new MemoryKernelStore() }),
      audit: new AuditLog(new MemoryAuditStore(), "test-secret"),
      customerIds: [CUSTOMER],
      consumerName: "worker-a",
      blockMs: 0,
      reclaimIntervalMs: 0,
      ...overrides,
    },
    () => redis.reads >= 2,
  );
}

describe("reclaim", () => {
  it("does not acknowledge a pending entry XCLAIM declined to return", async () => {
    // XPENDING listed the entry as idle, then another consumer claimed it
    // before this XCLAIM ran, so XCLAIM omits it. Acknowledging on that would
    // take it out of the pending list while the other instance still holds it,
    // and the message would never be scored or dead-lettered.
    const redis = new FakeRedis({ pending: [["1700-0", "worker-b", 360_000, 1]], claimed: [] });
    await worker(redis);
    expect(redis.acked).toEqual([]);
    expect(redis.added).toEqual([]);
  });

  it("redelivers an entry XCLAIM did hand back", async () => {
    const redis = new FakeRedis({
      pending: [["1700-0", "worker-b", 360_000, 1]],
      claimed: [["1700-0", queuedEvent("hey nice build in that game")]],
    });
    await worker(redis);
    // The reclaim pass runs on every loop iteration here, so the entry may be
    // delivered more than once; at least once is what matters.
    expect(redis.acked).toContain("1700-0");
  });
});

describe("dead letter", () => {
  it("records the rejection without copying the message text", async () => {
    // A payload that parses as JSON but is not an Event: dead-lettered on the
    // first delivery, with the raw text still in the entry's fields.
    const fields = ["event", JSON.stringify({ text: "dont tell your mum, add me on snapchat" })];
    const redis = new FakeRedis({ messages: [["1700-1", fields]] });
    await worker(redis);

    expect(redis.added).toHaveLength(1);
    const entry = (redis.added[0] ?? []).map(String);
    expect(entry[0]).toBe(deadLetterKey(CUSTOMER));
    // Nothing from the payload. The stream has no retention class and nothing
    // sweeps it, so text here would outlive the 24 hour T0 window (rule 7).
    expect(entry.join(" ")).not.toContain("snapchat");
    expect(entry).not.toContain("event");
    expect(entry).toContain("not_an_event");
    expect(entry).toContain("1700-1");
    expect(redis.acked).toEqual(["1700-1"]);
  });
});

describe("stream keys", () => {
  it("keeps one partition and one dead-letter stream per customer", () => {
    expect(streamKey(CUSTOMER)).toBe("guardian:events:cus_worker");
    expect(deadLetterKey(CUSTOMER)).toBe("guardian:dead:cus_worker");
    expect(CONSUMER_GROUP).toBe("guardian-scorer");
  });
});
