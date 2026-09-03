import { AuditLog, MemoryAuditStore } from "@guardian/audit";
import { beforeEach, describe, expect, it } from "vitest";
import { hashApiKey, MemoryCustomerStore } from "../src/customers.js";
import {
  PrismaCustomerStore,
  SENTINEL_CUSTOMERS,
  type CustomerCreateData,
  type CustomerPrismaLike,
  type CustomerRow,
  type ViolationRow,
} from "../src/prisma-customers.js";
import { MemoryEventQueue } from "../src/queue.js";
import { buildServer } from "../src/server.js";

/**
 * A fake of the two Prisma delegates the store touches. It records every
 * argument it is given so the tests can assert on what would have reached the
 * database, not just on what the store returned.
 */
function fakeDb() {
  const customers = new Map<string, CustomerRow>();
  const violations: ViolationRow[] = [];
  const createCalls: CustomerCreateData[] = [];
  const upsertCalls: string[] = [];
  let nextId = 1;

  const db: CustomerPrismaLike = {
    customer: {
      async findUnique({ where }) {
        if ("id" in where) return customers.get(where.id) ?? null;
        for (const row of customers.values()) {
          if (row.apiKeyHash === where.apiKeyHash) return row;
        }
        return null;
      },
      async create({ data }) {
        createCalls.push(data);
        const row: CustomerRow = { ...data, id: data.id ?? `cus_${nextId++}` };
        customers.set(row.id, row);
        return row;
      },
      async upsert({ where, create }) {
        upsertCalls.push(where.id);
        const existing = customers.get(where.id);
        if (existing) return existing;
        const row: CustomerRow = { ...create, id: where.id };
        customers.set(row.id, row);
        return row;
      },
    },
    customerViolation: {
      async createMany({ data }) {
        violations.push(...data);
        return { count: data.length };
      },
    },
  };

  return { db, customers, violations, createCalls, upsertCalls };
}

describe("PrismaCustomerStore lookups", () => {
  let fake: ReturnType<typeof fakeDb>;
  let store: PrismaCustomerStore;

  beforeEach(() => {
    fake = fakeDb();
    store = new PrismaCustomerStore(fake.db);
  });

  it("finds a customer by its api key", async () => {
    const { customer, apiKey } = await store.createCustomer("Test Guild");
    const found = await store.byApiKey(apiKey);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(customer.id);
    expect(found!.name).toBe("Test Guild");
  });

  it("misses on a wrong key, an empty key, and a key differing by one character", async () => {
    const { apiKey } = await store.createCustomer("Test Guild");
    expect(await store.byApiKey("gk_not_a_real_key")).toBeNull();
    expect(await store.byApiKey("")).toBeNull();
    expect(await store.byApiKey(apiKey.slice(0, -1) + "x")).toBeNull();
  });

  it("finds a customer by id and misses on an unknown id", async () => {
    const { customer } = await store.createCustomer("Test Guild");
    expect((await store.byId(customer.id))?.name).toBe("Test Guild");
    expect(await store.byId("cus_missing")).toBeNull();
    expect(await store.byId("")).toBeNull();
  });

  it("maps only the customer fields out of the row", async () => {
    const { customer } = await store.createCustomer("Test Guild", { webhookUrl: "https://example.com/hook" });
    const found = await store.byId(customer.id);
    expect(Object.keys(found!).sort()).toEqual(
      ["apiKeyHash", "crossCustomerOptIn", "id", "idSalt", "name", "webhookSecret", "webhookUrl"].sort(),
    );
    expect(found!.webhookUrl).toBe("https://example.com/hook");
    expect(found!.crossCustomerOptIn).toBe(false);
  });
});

describe("PrismaCustomerStore.createCustomer", () => {
  let fake: ReturnType<typeof fakeDb>;
  let store: PrismaCustomerStore;

  beforeEach(() => {
    fake = fakeDb();
    store = new PrismaCustomerStore(fake.db);
  });

  it("returns the key once and stores only its sha256", async () => {
    const { customer, apiKey } = await store.createCustomer("Test Guild");
    expect(apiKey).toMatch(/^gk_[a-f0-9]{48}$/);
    expect(fake.createCalls).toHaveLength(1);
    const written = fake.createCalls[0]!;
    expect(written.apiKeyHash).toBe(hashApiKey(apiKey));
    expect(JSON.stringify(written)).not.toContain(apiKey);
    expect(JSON.stringify(customer)).not.toContain(apiKey);
    expect(customer.apiKeyHash).toBe(hashApiKey(apiKey));
  });

  it("mints a fresh salt and webhook secret per customer", async () => {
    const a = await store.createCustomer("A");
    const b = await store.createCustomer("B");
    expect(a.customer.idSalt).toMatch(/^[a-f0-9]{64}$/);
    expect(a.customer.idSalt).not.toBe(b.customer.idSalt);
    expect(a.customer.webhookSecret).toMatch(/^whsec_[a-f0-9]{64}$/);
    expect(a.customer.webhookSecret).not.toBe(b.customer.webhookSecret);
    expect(a.apiKey).not.toBe(b.apiKey);
  });

  it("defaults cross-customer joins to off", async () => {
    const { customer } = await store.createCustomer("A");
    expect(customer.crossCustomerOptIn).toBe(false);
    const optedIn = await store.createCustomer("B", { crossCustomerOptIn: true });
    expect(optedIn.customer.crossCustomerOptIn).toBe(true);
  });

  it("refuses an empty name", async () => {
    await expect(store.createCustomer("   ")).rejects.toThrow(/name/);
    expect(fake.createCalls).toHaveLength(0);
  });

  it("produces a store that agrees with the memory store on the same key", async () => {
    const { apiKey } = await store.createCustomer("Test Guild");
    const memory = new MemoryCustomerStore();
    memory.create("cus_mem", "Test Guild", apiKey);
    const fromMemory = await memory.byApiKey(apiKey);
    const fromPrisma = await store.byApiKey(apiKey);
    expect(fromMemory!.apiKeyHash).toBe(fromPrisma!.apiKeyHash);
  });
});

describe("PrismaCustomerStore.recordViolation", () => {
  let fake: ReturnType<typeof fakeDb>;
  let store: PrismaCustomerStore;

  beforeEach(() => {
    fake = fakeDb();
    store = new PrismaCustomerStore(fake.db);
  });

  it("writes reason, path and detail against the customer", async () => {
    await store.recordViolation("cus_1", [
      { reason: "data_uri", at: "$.text", detail: "field contains a data URI carrying media" },
      { reason: "byte_field", at: "$.extra.bytes", detail: 'field "bytes" is a byte-carrying field name' },
    ]);
    expect(fake.violations).toEqual([
      { customerId: "cus_1", reason: "data_uri", path: "$.text", detail: "field contains a data URI carrying media" },
      {
        customerId: "cus_1",
        reason: "byte_field",
        path: "$.extra.bytes",
        detail: 'field "bytes" is a byte-carrying field name',
      },
    ]);
  });

  it("drops any field that is not reason, path or detail", async () => {
    const smuggled = {
      reason: "base64_blob",
      at: "$.text",
      detail: "field contains a 600 character base64 run",
      value: "iVBORw0KGgo" + "A".repeat(600),
      content: "should never be stored",
    };
    await store.recordViolation("cus_1", [smuggled]);
    const row = fake.violations[0]!;
    expect(Object.keys(row).sort()).toEqual(["customerId", "detail", "path", "reason"]);
    expect(JSON.stringify(fake.violations)).not.toContain("iVBORw0KGgo");
    expect(JSON.stringify(fake.violations)).not.toContain("should never be stored");
  });

  it("caps the detail length", async () => {
    await store.recordViolation("cus_1", [{ reason: "media_url", at: "$.text", detail: "x".repeat(5000) }]);
    expect(fake.violations[0]!.detail.length).toBeLessThanOrEqual(500);
  });

  it("writes nothing for an empty list", async () => {
    await store.recordViolation("cus_1", []);
    expect(fake.violations).toHaveLength(0);
  });
});

describe("PrismaCustomerStore.ensureSentinels", () => {
  it("upserts the system and unknown rows with keys nobody holds", async () => {
    const fake = fakeDb();
    const store = new PrismaCustomerStore(fake.db);
    await store.ensureSentinels();
    await store.ensureSentinels();
    expect(fake.upsertCalls).toEqual(["system", "unknown", "system", "unknown"]);
    for (const { id } of SENTINEL_CUSTOMERS) {
      const row = fake.customers.get(id);
      expect(row).toBeDefined();
      expect(row!.apiKeyHash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(fake.customers.size).toBe(2);
  });
});

/**
 * The edge writes a refusal to the table as well as to the chain. The
 * recorder gets the same redacted violations the audit entry gets, and only
 * when a customer authenticated.
 */
describe("refusals reach the violations recorder", () => {
  const API_KEY = "gk_test_key";

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

  function setup() {
    const customers = new MemoryCustomerStore();
    customers.create("cus_1", "Test Guild", API_KEY);
    const queue = new MemoryEventQueue();
    const auditStore = new MemoryAuditStore();
    const audit = new AuditLog(auditStore, "test-secret");
    const recorded: Array<{ customerId: string; violations: unknown[] }> = [];
    const violations = {
      async record(customerId: string, list: Array<{ reason: string; at: string; detail: string }>) {
        recorded.push({ customerId, violations: list });
      },
    };
    const app = buildServer({ customers, queue, audit, violations });
    return { app, recorded, auditStore, queue };
  }

  it("records a media refusal against the authenticated customer with no content", async () => {
    const { app, recorded, auditStore } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "application/json", "x-guardian-key": API_KEY },
      payload: JSON.stringify({ ...validEvent, text: "data:image/png;base64,iVBORw0KGgo=" }),
    });
    expect(res.statusCode).toBe(422);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.customerId).toBe("cus_1");
    expect(recorded[0]!.violations).toEqual([
      { reason: "data_uri", at: "$.text", detail: "field contains a data URI carrying media" },
    ]);
    expect(JSON.stringify(recorded)).not.toContain("iVBORw0KGgo");
    const entries = await auditStore.read();
    expect(entries.some((e) => e.kind === "customer.violation")).toBe(true);
  });

  it("attributes a binary content type refusal to the key that sent it", async () => {
    const { app, recorded, auditStore } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "multipart/form-data; boundary=x", "x-guardian-key": API_KEY },
      payload: "irrelevant",
    });
    expect(res.statusCode).toBe(422);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.customerId).toBe("cus_1");
    const entries = await auditStore.read();
    const entry = entries.find((e) => e.kind === "customer.violation");
    expect(entry?.customerId).toBe("cus_1");
  });

  it("writes nothing anywhere for a binary post that carries no key", async () => {
    const { app, recorded, auditStore } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      payload: "irrelevant",
    });
    expect(res.statusCode).toBe(401);
    expect(recorded).toHaveLength(0);
    expect(await auditStore.read()).toHaveLength(0);
  });

  it("still refuses when no recorder is configured", async () => {
    const customers = new MemoryCustomerStore();
    customers.create("cus_1", "Test Guild", API_KEY);
    const app = buildServer({
      customers,
      queue: new MemoryEventQueue(),
      audit: new AuditLog(new MemoryAuditStore(), "test-secret"),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/events",
      headers: { "content-type": "application/json", "x-guardian-key": API_KEY },
      payload: JSON.stringify({ ...validEvent, extra: { bytes: "x" } }),
    });
    expect(res.statusCode).toBe(422);
  });
});
