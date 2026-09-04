import { hostname } from "node:os";
import { AuditLog, PrismaAuditStore, type AppendInput, type AuditEntry } from "@guardian/audit";
import { eventSchema, type Event } from "@guardian/schema";
import { createPrismaClient, type PrismaClient } from "@guardian/schema/db";
import { Redis } from "ioredis";
import { Kernel, type ScoredEvent } from "./kernel.js";
import { persistScoredEvent } from "./persist.js";
import { PrismaKernelStore } from "./prisma-store.js";
import { PrismaDeliveryStore } from "@guardian/ingest/delivery";
import { dispatch, toWebhookPayload, useDeliveryQueue, type WebhookTarget } from "./webhook.js";

/**
 * Scorer worker. Reads a per-customer Redis Stream partition, scores each
 * event through the kernel, records the score in the audit chain, persists
 * the event row and the pair tier, and dispatches the tier to the customer's
 * webhook.
 *
 * The worker is stateless. Kernel state lives in the store
 * (CLAUDE.md conventions).
 *
 * Delivery is at least once and the kernel is idempotent on externalId, so
 * the rules for the pending entries list are simple:
 *
 *   - An entry is acknowledged only after scoring, the chain append, persist
 *     and dispatch all completed. A failure leaves it pending.
 *   - Pending entries idle for longer than `reclaimMinIdleMs` are claimed by
 *     whichever instance holds the partition, whether they were left by this
 *     process before a crash or by one that never came back. The consumer
 *     name is stable across restarts for the same reason.
 *   - An entry that cannot be parsed, or that has failed `maxDeliveries`
 *     times, is recorded on the customer's dead-letter stream with an
 *     event.rejected entry in the chain, and only then is acknowledged.
 *     Nothing is dropped without a row saying so. The dead-letter entry names
 *     the entry and the reason and carries no payload, because that stream has
 *     no retention class and nothing sweeps it (rule 7).
 *
 * One instance reads a partition at a time. Instances take a lease per
 * customer before reading and renew it every loop, so two processes cannot
 * interleave read-modify-write on the same pair rows (docs/PHASE1.md F8).
 *
 * Environment for the entrypoint: DATABASE_URL, REDIS_URL, AUDIT_CHAIN_SECRET,
 * GUARDIAN_WORKER_ID (consumer name, defaults to the hostname), and
 * GUARDIAN_CUSTOMER_IDS as a fallback partition list when the customers
 * table is empty.
 */

export const CONSUMER_GROUP = "guardian-scorer";

const STREAM_PREFIX = "guardian:events:";
const DEAD_LETTER_PREFIX = "guardian:dead:";
const DEAD_LETTER_MAX_LEN = 10_000;

export function streamKey(customerId: string): string {
  return `${STREAM_PREFIX}${customerId}`;
}

export function deadLetterKey(customerId: string): string {
  return `${DEAD_LETTER_PREFIX}${customerId}`;
}

function customerFromStream(stream: string): string {
  return stream.startsWith(STREAM_PREFIX) ? stream.slice(STREAM_PREFIX.length) : stream;
}

/**
 * The slice of ioredis this worker calls. Declared as methods so the real
 * client satisfies it and a test can pass a fake.
 */
export interface WorkerRedis {
  xgroup(...args: unknown[]): Promise<unknown>;
  xreadgroup(...args: unknown[]): Promise<unknown>;
  xpending(...args: unknown[]): Promise<unknown>;
  xclaim(...args: unknown[]): Promise<unknown>;
  xack(...args: unknown[]): Promise<unknown>;
  xadd(...args: unknown[]): Promise<unknown>;
}

/**
 * Exclusive ownership of one partition. `acquire` takes the lease when it is
 * free or already held by this holder and renews its expiry; it returns false
 * when another holder has it. A lease that is not renewed lapses after
 * `ttlMs`, which is how a partition moves to a live instance after a crash.
 */
export interface PartitionLease {
  acquire(customerId: string, holder: string, ttlMs: number): Promise<boolean>;
  release(customerId: string, holder: string): Promise<void>;
}

export interface WorkerOptions {
  redis: WorkerRedis;
  kernel: Kernel;
  audit: AuditLog;
  /** Which customers this worker instance serves. One partition each. */
  customerIds: string[];
  webhookFor?: (customerId: string) => WebhookTarget | null;
  /** Writes the events row and the pair tier. Absent in tests and the eval harness. */
  persist?: (event: Event, scored: ScoredEvent) => Promise<void>;
  /**
   * Consumer name. Must be stable across restarts so a restarted process
   * reclaims its own pending entries by name. Defaults to defaultConsumerName().
   */
  consumerName?: string;
  /** Partition ownership. Without one, every partition is read; only safe with a single instance. */
  lease?: PartitionLease;
  leaseTtlMs?: number;
  blockMs?: number;
  batchSize?: number;
  /** How often the pending list is scanned for stale entries. */
  reclaimIntervalMs?: number;
  /** How long an entry must sit unacknowledged before another delivery claims it. */
  reclaimMinIdleMs?: number;
  /** Deliveries after which a failing entry is dead-lettered. */
  maxDeliveries?: number;
  now?: () => number;
}

export const WORKER_DEFAULTS = {
  leaseTtlMs: 60_000,
  blockMs: 2_000,
  batchSize: 50,
  reclaimIntervalMs: 60_000,
  reclaimMinIdleMs: 5 * 60_000,
  maxDeliveries: 5,
} as const;

/** Hostname, or GUARDIAN_WORKER_ID when set. Never the pid, which changes on every restart. */
export function defaultConsumerName(): string {
  const configured = process.env.GUARDIAN_WORKER_ID?.trim();
  return configured && configured.length > 0 ? configured : `scorer-${hostname()}`;
}

type PendingEntry = [id: string, consumer: string, idleMs: number, deliveries: number];
type StreamEntry = [id: string, fields: string[]] | null;

export async function runWorker(opts: WorkerOptions, shouldStop = () => false): Promise<void> {
  const consumer = opts.consumerName ?? defaultConsumerName();
  const now = opts.now ?? (() => Date.now());
  const blockMs = opts.blockMs ?? WORKER_DEFAULTS.blockMs;
  const batchSize = opts.batchSize ?? WORKER_DEFAULTS.batchSize;
  const leaseTtlMs = opts.leaseTtlMs ?? WORKER_DEFAULTS.leaseTtlMs;
  const reclaimIntervalMs = opts.reclaimIntervalMs ?? WORKER_DEFAULTS.reclaimIntervalMs;

  const partitions = opts.customerIds.map((id) => ({ id, stream: streamKey(id) }));

  for (const { stream } of partitions) {
    try {
      await opts.redis.xgroup("CREATE", stream, CONSUMER_GROUP, "0", "MKSTREAM");
    } catch (err) {
      // BUSYGROUP means the group already exists, which is the normal restart path.
      if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) throw err;
    }
  }

  const held = new Set<string>();
  let lastReclaim = -Infinity;

  try {
    while (!shouldStop()) {
      // Ownership first. A partition whose lease went to another instance is
      // dropped from this loop's reads; one just taken is reclaimed at once,
      // because its previous owner may have left entries pending.
      const active: typeof partitions = [];
      for (const partition of partitions) {
        if (!opts.lease) {
          active.push(partition);
          continue;
        }
        const owned = await opts.lease.acquire(partition.id, consumer, leaseTtlMs);
        if (owned) {
          if (!held.has(partition.id)) {
            held.add(partition.id);
            lastReclaim = -Infinity;
          }
          active.push(partition);
        } else if (held.has(partition.id)) {
          held.delete(partition.id);
          console.warn(`scorer partition lease lost: ${partition.id}`);
        }
      }

      if (active.length === 0) {
        await sleep(blockMs);
        continue;
      }

      if (now() - lastReclaim >= reclaimIntervalMs) {
        lastReclaim = now();
        for (const partition of active) {
          await reclaimStale(opts, partition.stream, consumer, batchSize);
        }
      }

      const response = (await opts.redis.xreadgroup(
        "GROUP",
        CONSUMER_GROUP,
        consumer,
        "COUNT",
        String(batchSize),
        "BLOCK",
        String(blockMs),
        "STREAMS",
        ...active.map((p) => p.stream),
        ...active.map(() => ">"),
      )) as Array<[string, Array<[string, string[]]>]> | null;
      if (!response) continue;

      for (const [stream, messages] of response) {
        for (const [id, fields] of messages) {
          await deliver(opts, stream, id, fields, 1);
        }
      }
    }
  } finally {
    if (opts.lease) {
      for (const id of held) {
        await opts.lease.release(id, consumer).catch(() => undefined);
      }
    }
  }
}

/**
 * Claim entries that have sat in the pending list longer than the idle
 * threshold, whoever they were delivered to, and run them again with their
 * delivery count. XPENDING reports the count before this claim, so the value
 * passed on is one higher.
 */
async function reclaimStale(
  opts: WorkerOptions,
  stream: string,
  consumer: string,
  batchSize: number,
): Promise<void> {
  const minIdle = opts.reclaimMinIdleMs ?? WORKER_DEFAULTS.reclaimMinIdleMs;
  const pending = (await opts.redis.xpending(
    stream,
    CONSUMER_GROUP,
    "IDLE",
    String(minIdle),
    "-",
    "+",
    String(batchSize),
  )) as PendingEntry[] | null;
  if (!pending || pending.length === 0) return;

  const deliveries = new Map<string, number>();
  for (const [id, , , count] of pending) deliveries.set(id, Number(count) + 1);

  const claimed = (await opts.redis.xclaim(
    stream,
    CONSUMER_GROUP,
    consumer,
    String(minIdle),
    ...deliveries.keys(),
  )) as StreamEntry[] | null;
  if (!claimed) return;

  for (const entry of claimed) {
    // A null entry was trimmed from the stream after it was delivered. There
    // is nothing left to score, so it leaves the pending list.
    if (entry === null) continue;
    const [id, fields] = entry;
    await deliver(opts, stream, id, fields, deliveries.get(id) ?? 1);
  }

  // Ids XPENDING listed but XCLAIM did not hand back are left alone. XCLAIM
  // omits an entry for two reasons that cannot be told apart from here: it no
  // longer exists in the stream, or another consumer claimed it in the window
  // between the two calls and its idle time is now below the threshold.
  // Acknowledging on that guess would take an entry out of the pending list
  // while another instance is still holding it, and the message would never be
  // scored, persisted or dead-lettered. Redis drops a genuinely trimmed entry
  // from the pending list during XCLAIM itself, so there is nothing to clean up
  // here; anything still pending is picked up by the next reclaim pass.
}

/**
 * One delivery of one entry. Acknowledged on success or after dead-lettering;
 * left pending on a failure that still has deliveries in hand.
 */
async function deliver(
  opts: WorkerOptions,
  stream: string,
  id: string,
  fields: string[],
  deliveries: number,
): Promise<void> {
  const maxDeliveries = opts.maxDeliveries ?? WORKER_DEFAULTS.maxDeliveries;
  const parsed = parseEntry(fields);

  if (!parsed.ok) {
    await deadLetter(opts, stream, id, parsed.reason, deliveries, null);
    return;
  }

  try {
    await scoreAndDispatch(opts, parsed.event);
  } catch (err) {
    // The class and any driver code are logged. The message could quote a row.
    const detail = describeError(err);
    if (deliveries >= maxDeliveries) {
      console.error(`scoring failed ${deliveries} times for ${stream} ${id} (${detail}); dead-lettering`);
      await deadLetter(opts, stream, id, "scoring_failed", deliveries, parsed.event.externalId);
      return;
    }
    console.error(`scoring failed for ${stream} ${id} on delivery ${deliveries} (${detail}); left pending`);
    return;
  }

  await opts.redis.xack(stream, CONSUMER_GROUP, id);
}

type ParsedEntry = { ok: true; event: Event } | { ok: false; reason: "no_payload" | "not_json" | "not_an_event" };

function parseEntry(fields: string[]): ParsedEntry {
  const payloadIndex = fields.indexOf("event");
  if (payloadIndex === -1 || payloadIndex + 1 >= fields.length) return { ok: false, reason: "no_payload" };
  let json: unknown;
  try {
    json = JSON.parse(fields[payloadIndex + 1]!);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "not_an_event" };
  return { ok: true, event: parsed.data };
}

/**
 * Record that an entry was rejected and acknowledge it. If either write fails
 * the entry stays pending and the next reclaim pass tries again; an entry is
 * never dropped silently.
 *
 * The dead-letter entry is metadata only. The original fields carry the
 * serialized Event, which holds the raw message text, and this stream has no
 * retention class, no expiry and nothing that sweeps it: a copy here would sit
 * in Redis past the 24 hour window rule 7 gives T0 text and outside any
 * deletion request. The stream id and the external id are enough to say what
 * was rejected and why.
 */
async function deadLetter(
  opts: WorkerOptions,
  stream: string,
  id: string,
  reason: string,
  deliveries: number,
  externalId: string | null,
): Promise<void> {
  const customerId = customerFromStream(stream);
  try {
    await opts.redis.xadd(
      deadLetterKey(customerId),
      "MAXLEN",
      "~",
      String(DEAD_LETTER_MAX_LEN),
      "*",
      "customerId",
      customerId,
      "externalId",
      externalId ?? "",
      "reason",
      reason,
      "source",
      stream,
      "sourceId",
      id,
      "deliveries",
      String(deliveries),
    );
    await opts.audit.append({
      kind: "event.rejected",
      customerId,
      payload: {
        stream,
        streamId: id,
        externalId,
        reason,
        deliveries,
        deadLetter: deadLetterKey(customerId),
      },
    });
    await opts.redis.xack(stream, CONSUMER_GROUP, id);
  } catch (err) {
    console.error(`dead-lettering ${stream} ${id} failed (${describeError(err)}); left pending`);
  }
}

function describeError(err: unknown): string {
  if (typeof err !== "object" || err === null) return typeof err;
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  const base = typeof name === "string" && name.length > 0 ? name : "Error";
  return typeof code === "string" ? `${base} ${code}` : base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function scoreAndDispatch(
  opts: Pick<WorkerOptions, "kernel" | "audit" | "webhookFor" | "persist">,
  event: Event,
): Promise<void> {
  const scored = await opts.kernel.score(event);
  if (!scored) return;

  const { result } = scored;

  // Every score goes into the chain, with the version triple and the tier but
  // never the message text.
  await opts.audit.append({
    kind: "score.assigned",
    customerId: event.customerId,
    payload: {
      actorUid: result.pair.actorUid,
      targetUid: result.pair.targetUid,
      tier: result.tier,
      fusedScore: result.fusedScore,
      pairScore: result.pair.score,
      actorScore: result.actor.score,
      criticalSignals: result.criticalSignals,
      stagesHit: result.pair.stagesHit,
      versions: result.versions,
      externalId: event.externalId,
      replay: scored.replay,
    },
  });

  // The row is written before the webhook fires, so a customer that queries
  // on receipt sees the state the payload describes.
  await opts.persist?.(event, scored);

  // T0 is not worth a customer's webhook call.
  if (result.tier === "T0") return;

  const target = opts.webhookFor?.(event.customerId);
  if (!target) return;
  await dispatch(target, toWebhookPayload(result));
}

/**
 * Lease over Redis. One key per customer holding the owner's consumer name,
 * taken or renewed atomically so two instances cannot both believe they own
 * a partition.
 */
const ACQUIRE_OR_RENEW = `
local current = redis.call('GET', KEYS[1])
if current == false then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
if current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

const RELEASE_IF_HELD = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export interface LeaseRedis {
  eval(...args: unknown[]): Promise<unknown>;
}

export function leaseKey(customerId: string): string {
  return `guardian:scorer:lease:${customerId}`;
}

export class RedisPartitionLease implements PartitionLease {
  constructor(private readonly redis: LeaseRedis) {}

  async acquire(customerId: string, holder: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.eval(ACQUIRE_OR_RENEW, 1, leaseKey(customerId), holder, String(ttlMs));
    return Number(result) === 1;
  }

  async release(customerId: string, holder: string): Promise<void> {
    await this.redis.eval(RELEASE_IF_HELD, 1, leaseKey(customerId), holder);
  }
}

/** In-process lease with the same semantics, for tests and the eval harness. */
export class MemoryPartitionLease implements PartitionLease {
  private readonly holders = new Map<string, { holder: string; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async acquire(customerId: string, holder: string, ttlMs: number): Promise<boolean> {
    const current = this.holders.get(customerId);
    if (current && current.holder !== holder && current.expiresAt > this.now()) return false;
    this.holders.set(customerId, { holder, expiresAt: this.now() + ttlMs });
    return true;
  }

  async release(customerId: string, holder: string): Promise<void> {
    if (this.holders.get(customerId)?.holder === holder) this.holders.delete(customerId);
  }

  holderOf(customerId: string): string | null {
    const current = this.holders.get(customerId);
    return current && current.expiresAt > this.now() ? current.holder : null;
  }
}

/**
 * Ingest and the scorer append to the same chain from separate processes.
 * PrismaAuditStore serializes appends with an advisory lock when it is built
 * from the client, so a collision on seq should not happen. This retries the
 * one failure a few times with a fresh head read as a belt and braces.
 */
const AUDIT_APPEND_ATTEMPTS = 3;

class RetryingAuditLog extends AuditLog {
  override async append(input: AppendInput): Promise<AuditEntry> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await super.append(input);
      } catch (err) {
        if (attempt >= AUDIT_APPEND_ATTEMPTS || !isUniqueViolation(err)) throw err;
      }
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/**
 * Rows that exist so the retention sweep and pre-auth refusals have a customer
 * to write against (apps/ingest SENTINEL_CUSTOMERS). They never own events.
 */
const SENTINEL_CUSTOMER_IDS: ReadonlySet<string> = new Set(["system", "unknown"]);

interface CustomerPartition {
  id: string;
  webhookUrl: string | null;
  webhookSecret: string;
}

/**
 * Partition list and webhook targets. The customers table is the source of
 * truth; GUARDIAN_CUSTOMER_IDS is the fallback for a database with no
 * customers yet, and those ids have no webhook. Loaded once at start, so a new
 * customer needs a worker restart.
 */
async function loadCustomers(db: PrismaClient): Promise<CustomerPartition[]> {
  const rows = await db.customer.findMany({
    select: { id: true, webhookUrl: true, webhookSecret: true },
    orderBy: { createdAt: "asc" },
  });
  const customers = rows.filter((row) => !SENTINEL_CUSTOMER_IDS.has(row.id));
  if (customers.length > 0) return customers;

  return (process.env.GUARDIAN_CUSTOMER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => ({ id, webhookUrl: null, webhookSecret: "" }));
}

async function main(): Promise<void> {
  const db = createPrismaClient(process.env.DATABASE_URL);
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

  const audit = new RetryingAuditLog(new PrismaAuditStore(db), process.env.AUDIT_CHAIN_SECRET ?? "");
  const store = PrismaKernelStore.fromClient(db);
  const kernel = new Kernel({ store });

  const customers = await loadCustomers(db);
  if (customers.length === 0) {
    throw new Error(
      "no customers to serve: create one with the ingest cli or set GUARDIAN_CUSTOMER_IDS",
    );
  }
  const targets = new Map<string, WebhookTarget>();
  for (const c of customers) {
    if (c.webhookUrl) targets.set(c.id, { url: c.webhookUrl, secret: c.webhookSecret });
  }

  /**
   * Tiers are handed to a durable delivery row rather than a single fetch, and
   * apps/ingest's delivery-worker drains it with the retry schedule and the
   * dead-letter view. Only the enqueue port crosses the process boundary here:
   * PrismaDeliveryStore satisfies DeliveryEnqueuer structurally, so the scorer
   * takes no dependency on the ingest server, only on that one module.
   *
   * Registered here rather than threaded through runWorker because dispatch is
   * called from scoreAndDispatch with a fixed signature. With no queue
   * registered, dispatch falls back to the inline POST, which is what the unit
   * tests and the eval harness run on.
   */
  useDeliveryQueue(new PrismaDeliveryStore(db));

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`scorer worker stopping on ${signal}`);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  const consumerName = defaultConsumerName();
  console.log(
    `scorer worker ${consumerName} starting on partitions: ${customers.map((c) => c.id).join(", ")}`,
  );
  try {
    await runWorker(
      {
        redis,
        kernel,
        audit,
        customerIds: customers.map((c) => c.id),
        consumerName,
        lease: new RedisPartitionLease(redis),
        webhookFor: (customerId) => targets.get(customerId) ?? null,
        persist: (event, scored) => persistScoredEvent(db, store, event, scored),
      },
      () => stopping,
    );
  } finally {
    await redis.quit().catch(() => undefined);
    await db.$disconnect();
  }
}

/** Local entrypoint. */
if (process.argv[1]?.endsWith("worker.js") || process.argv[1]?.endsWith("worker.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
