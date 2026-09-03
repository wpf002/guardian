import { AuditLog, PrismaAuditStore, type AuditDelegate } from "@guardian/audit";
import { Redis } from "ioredis";
import { MemoryCustomerStore } from "./customers.js";
import { RedisEventQueue } from "./queue.js";
import { buildServer } from "./server.js";

/**
 * Local entrypoint. The Prisma-backed customer store lands with the platform
 * SDK in phase 3; phase 1 runs the Discord bot as a single seeded customer.
 */

const port = Number(process.env.INGEST_PORT ?? 3001);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const auditSecret = process.env.AUDIT_CHAIN_SECRET ?? "";

const customers = new MemoryCustomerStore();
const seedKey = process.env.GUARDIAN_DEV_API_KEY;
if (seedKey) {
  customers.create("cus_dev", "local development", seedKey);
  console.log("seeded development customer cus_dev");
}

const redis = new Redis(redisUrl);
const queue = new RedisEventQueue(redis);

// Swapped for PrismaAuditStore once the schema is migrated; the in-process
// store keeps local development running without a database.
const memoryRows: Parameters<AuditDelegate["create"]>[0]["data"][] = [];
const delegate: AuditDelegate = {
  async findFirst() {
    return memoryRows[memoryRows.length - 1] ?? null;
  },
  async findMany({ where, take }) {
    const rows = memoryRows.filter((r) => r.seq >= where.seq.gte);
    return take === undefined ? rows : rows.slice(0, take);
  },
  async create({ data }) {
    memoryRows.push(data);
    return data;
  },
};

const audit = new AuditLog(new PrismaAuditStore(delegate), auditSecret);
const app = buildServer({ customers, queue, audit, logger: true });

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`ingest listening on ${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
