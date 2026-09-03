import { AuditLog, PrismaAuditStore, type AuditDelegate } from "@guardian/audit";
import { eventSchema, type Event } from "@guardian/schema";
import { Redis } from "ioredis";
import { Kernel } from "./kernel.js";
import { MemoryKernelStore } from "./store.js";
import { dispatch, toWebhookPayload } from "./webhook.js";

/**
 * Scorer worker. Reads a per-customer Redis Stream partition, scores each
 * event through the kernel, records the score in the audit chain, and dispatches
 * the tier to the customer's webhook.
 *
 * The worker is stateless. Kernel state lives in the store
 * (CLAUDE.md conventions).
 */

const CONSUMER_GROUP = "guardian-scorer";

export interface WorkerOptions {
  redis: Redis;
  kernel: Kernel;
  audit: AuditLog;
  /** Which customers this worker instance serves. One partition each. */
  customerIds: string[];
  webhookFor?: (customerId: string) => { url: string; secret: string } | null;
  consumerName?: string;
  blockMs?: number;
  batchSize?: number;
}

export async function runWorker(opts: WorkerOptions, shouldStop = () => false): Promise<void> {
  const consumer = opts.consumerName ?? `scorer-${process.pid}`;
  const streams = opts.customerIds.map((id) => `guardian:events:${id}`);

  for (const stream of streams) {
    try {
      await opts.redis.xgroup("CREATE", stream, CONSUMER_GROUP, "0", "MKSTREAM");
    } catch (err) {
      // BUSYGROUP means the group already exists, which is the normal restart path.
      if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) throw err;
    }
  }

  while (!shouldStop()) {
    const response = await opts.redis.xreadgroup(
      "GROUP",
      CONSUMER_GROUP,
      consumer,
      "COUNT",
      String(opts.batchSize ?? 50),
      "BLOCK",
      String(opts.blockMs ?? 2000),
      "STREAMS",
      ...streams,
      ...streams.map(() => ">"),
    );
    if (!response) continue;

    for (const [stream, messages] of response as Array<[string, Array<[string, string[]]>]>) {
      for (const [id, fields] of messages) {
        try {
          await handleMessage(opts, fields);
        } catch (err) {
          console.error(`scoring failed for ${stream} ${id}:`, err);
        } finally {
          await opts.redis.xack(stream, CONSUMER_GROUP, id);
        }
      }
    }
  }
}

async function handleMessage(opts: WorkerOptions, fields: string[]): Promise<void> {
  const payloadIndex = fields.indexOf("event");
  if (payloadIndex === -1) return;
  const parsed = eventSchema.safeParse(JSON.parse(fields[payloadIndex + 1]!));
  if (!parsed.success) return;
  await scoreAndDispatch(opts, parsed.data);
}

export async function scoreAndDispatch(
  opts: Pick<WorkerOptions, "kernel" | "audit" | "webhookFor">,
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
    },
  });

  // T0 is not worth a customer's webhook call.
  if (result.tier === "T0") return;

  const target = opts.webhookFor?.(event.customerId);
  if (!target) return;
  await dispatch(target, toWebhookPayload(result));
}

/** Local entrypoint. */
if (process.argv[1]?.endsWith("worker.js") || process.argv[1]?.endsWith("worker.ts")) {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const rows: Parameters<AuditDelegate["create"]>[0]["data"][] = [];
  const delegate: AuditDelegate = {
    async findFirst() {
      return rows[rows.length - 1] ?? null;
    },
    async findMany({ where, take }) {
      const found = rows.filter((r) => r.seq >= where.seq.gte);
      return take === undefined ? found : found.slice(0, take);
    },
    async create({ data }) {
      rows.push(data);
      return data;
    },
  };

  const audit = new AuditLog(new PrismaAuditStore(delegate), process.env.AUDIT_CHAIN_SECRET ?? "");
  const kernel = new Kernel({ store: new MemoryKernelStore() });
  const customerIds = (process.env.GUARDIAN_CUSTOMER_IDS ?? "cus_dev").split(",");

  console.log(`scorer worker starting on partitions: ${customerIds.join(", ")}`);
  runWorker({ redis, kernel, audit, customerIds }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
