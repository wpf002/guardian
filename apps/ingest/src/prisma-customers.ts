import { randomBytes } from "node:crypto";
import { newCustomerSalt } from "@guardian/schema";
import { hashApiKey, type Customer, type CustomerStore } from "./customers.js";

/**
 * Postgres-backed customer registry over the `customers` and
 * `customer_violations` tables.
 *
 * Three things never leave this module in the clear. The API key is returned
 * exactly once, from createCustomer, and only its sha256 is stored. The uid
 * salt is read by the process that hashes uids and is never printed. A
 * violation row carries where the refusal happened and why, never the content
 * that was refused (CLAUDE.md rules 1 and 8).
 *
 * The delegate interfaces are the slice of the Prisma client this store needs,
 * so it can be tested against a fake and typechecked against the generated
 * client without depending on it at build time.
 */

export interface CustomerRow {
  id: string;
  name: string;
  apiKeyHash: string;
  idSalt: string;
  webhookSecret: string;
  webhookUrl: string | null;
  crossCustomerOptIn: boolean;
}

export interface CustomerCreateData {
  id?: string;
  name: string;
  apiKeyHash: string;
  idSalt: string;
  webhookSecret: string;
  webhookUrl: string | null;
  crossCustomerOptIn: boolean;
}

export interface CustomerDelegate {
  findUnique(args: {
    where: { apiKeyHash: string } | { id: string };
  }): Promise<CustomerRow | null>;
  create(args: { data: CustomerCreateData }): Promise<CustomerRow>;
  upsert(args: {
    where: { id: string };
    create: CustomerCreateData;
    update: Record<string, never>;
  }): Promise<CustomerRow>;
}

export interface ViolationRow {
  customerId: string;
  reason: string;
  path: string;
  detail: string;
}

export interface ViolationDelegate {
  createMany(args: { data: ViolationRow[] }): Promise<{ count: number }>;
}

export interface CustomerPrismaLike {
  customer: CustomerDelegate;
  customerViolation: ViolationDelegate;
}

export interface CreateCustomerOptions {
  webhookUrl?: string | null;
  /** Off by default (CLAUDE.md rule 8). */
  crossCustomerOptIn?: boolean;
}

export interface CreatedCustomer {
  customer: Customer;
  /** Shown once. Nothing else ever holds it in the clear. */
  apiKey: string;
}

export interface ViolationInput {
  reason: string;
  /** Where in the request the refusal happened. Never the content. */
  at: string;
  detail: string;
}

/**
 * Audit entries and violation rows reference a customer by foreign key. Two
 * writers have no real customer: the retention sweep, which logs as "system",
 * and a refusal that happens before authentication, which logs as "unknown".
 * These rows exist so that those writes hold. Their key hashes are of random
 * bytes that are discarded immediately, so nothing can authenticate as them.
 */
export const SENTINEL_CUSTOMERS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "system", name: "Guardian system" },
  { id: "unknown", name: "Unauthenticated request" },
];

const DETAIL_MAX_CHARS = 500;

export function mintApiKey(): string {
  return `gk_${randomBytes(24).toString("hex")}`;
}

export function mintWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

export class PrismaCustomerStore implements CustomerStore {
  constructor(private readonly db: CustomerPrismaLike) {}

  async byApiKey(apiKey: string): Promise<Customer | null> {
    if (!apiKey) return null;
    const row = await this.db.customer.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
    return row ? toCustomer(row) : null;
  }

  async byId(id: string): Promise<Customer | null> {
    if (!id) return null;
    const row = await this.db.customer.findUnique({ where: { id } });
    return row ? toCustomer(row) : null;
  }

  /**
   * Mint a key, a salt and a webhook secret, store the key's hash, and hand
   * the key back exactly once.
   */
  async createCustomer(name: string, opts: CreateCustomerOptions = {}): Promise<CreatedCustomer> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("customer name is required");

    const apiKey = mintApiKey();
    const row = await this.db.customer.create({
      data: {
        name: trimmed,
        apiKeyHash: hashApiKey(apiKey),
        idSalt: newCustomerSalt(),
        webhookSecret: mintWebhookSecret(),
        webhookUrl: opts.webhookUrl ?? null,
        crossCustomerOptIn: opts.crossCustomerOptIn ?? false,
      },
    });
    return { customer: toCustomer(row), apiKey };
  }

  /**
   * Write one row per violation. Only the reason, the path and the detail are
   * copied; any other field on the input is dropped here, so a caller cannot
   * accidentally persist what was refused.
   */
  async recordViolation(customerId: string, violations: ViolationInput[]): Promise<void> {
    if (violations.length === 0) return;
    await this.db.customerViolation.createMany({
      data: violations.map((v) => ({
        customerId,
        reason: String(v.reason),
        path: String(v.at),
        detail: String(v.detail).slice(0, DETAIL_MAX_CHARS),
      })),
    });
  }

  /** Idempotent. Safe to call on every start. */
  async ensureSentinels(): Promise<void> {
    for (const sentinel of SENTINEL_CUSTOMERS) {
      await this.db.customer.upsert({
        where: { id: sentinel.id },
        update: {},
        create: {
          id: sentinel.id,
          name: sentinel.name,
          apiKeyHash: hashApiKey(randomBytes(32).toString("hex")),
          idSalt: newCustomerSalt(),
          webhookSecret: mintWebhookSecret(),
          webhookUrl: null,
          crossCustomerOptIn: false,
        },
      });
    }
  }
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    apiKeyHash: row.apiKeyHash,
    idSalt: row.idSalt,
    webhookSecret: row.webhookSecret,
    webhookUrl: row.webhookUrl,
    crossCustomerOptIn: row.crossCustomerOptIn,
  };
}
