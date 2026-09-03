import { AuditLog, PrismaAuditStore, type AppendInput, type AuditEntry } from "@guardian/audit";
import { createPrismaClient } from "@guardian/schema/db";
import { Redis } from "ioredis";
import { PrismaCustomerStore } from "./prisma-customers.js";
import { RedisEventQueue } from "./queue.js";
import { prismaRetentionDelegate, scheduleRetentionSweep } from "./retention-job.js";
import { buildServer } from "./server.js";

/**
 * Ingest entrypoint. Customers, the audit chain and violations live in
 * Postgres; events go onto a per-customer Redis Stream; the retention sweep
 * runs on an hourly timer (CLAUDE.md rule 7).
 *
 * Environment: DATABASE_URL, REDIS_URL, AUDIT_CHAIN_SECRET, INGEST_PORT, and
 * GUARDIAN_TRUST_PROXY when the service sits behind a proxy.
 * Customers are created with `pnpm cli create-customer <name>`.
 */

const port = Number(process.env.INGEST_PORT ?? 3001);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const auditSecret = process.env.AUDIT_CHAIN_SECRET ?? "";
const sweepIntervalMs = Number(process.env.RETENTION_SWEEP_INTERVAL_MS ?? 60 * 60 * 1000);

/**
 * How far to trust X-Forwarded-For, from GUARDIAN_TRUST_PROXY: a hop count
 * ("1") or a comma separated list of proxy addresses or CIDRs. Never `true`,
 * which would take whatever header the caller sent. Unset means the TCP peer
 * address is used, which is correct with no proxy in front.
 */
function trustProxyFromEnv(): string[] | number | undefined {
  const raw = process.env.GUARDIAN_TRUST_PROXY?.trim();
  if (!raw || raw === "false") return undefined;
  if (raw === "true") {
    console.warn("GUARDIAN_TRUST_PROXY=true is not accepted: set a hop count or the proxy addresses");
    return undefined;
  }
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops > 0) return hops;
  return raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * PrismaAuditStore built from the client takes a database advisory lock per
 * append, which covers a second ingest instance and the scorer. Serializing
 * appends within this process as well keeps concurrent requests from queueing
 * on that lock inside their own transactions.
 */
class SerialAuditLog extends AuditLog {
  private tail: Promise<unknown> = Promise.resolve();

  override append(input: AppendInput): Promise<AuditEntry> {
    const next = this.tail.then(() => super.append(input));
    this.tail = next.catch(() => undefined);
    return next;
  }
}

async function start(): Promise<void> {
  const db = createPrismaClient();
  const customers = new PrismaCustomerStore(db);
  const audit = new SerialAuditLog(new PrismaAuditStore(db), auditSecret);

  // The "system" and "unknown" rows that violation rows can hang off. The
  // audit chain no longer has a foreign key to customers, so these exist for
  // the customer_violations table and for listings. Idempotent.
  await customers.ensureSentinels();

  const redis = new Redis(redisUrl);
  const queue = new RedisEventQueue(redis);

  const app = buildServer({
    customers,
    queue,
    audit,
    violations: { record: (customerId, violations) => customers.recordViolation(customerId, violations) },
    trustProxy: trustProxyFromEnv(),
    logger: true,
  });

  const stopSweep = scheduleRetentionSweep(prismaRetentionDelegate(db), audit, sweepIntervalMs);

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`ingest stopping on ${signal}`);
    stopSweep();
    await app.close();
    await redis.quit().catch(() => undefined);
    await db.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`ingest listening on ${port}, retention sweep every ${sweepIntervalMs}ms`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
