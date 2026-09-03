import { createHash, timingSafeEqual } from "node:crypto";
import { newCustomerSalt } from "@guardian/schema";

/**
 * Customer registry. The API key is stored as a sha256 digest; the per-customer
 * uid salt never leaves the process that needs it (CLAUDE.md rule 8).
 */

export interface Customer {
  id: string;
  name: string;
  /** sha256 of the API key. The key itself is shown once, at creation. */
  apiKeyHash: string;
  /** Hex salt for hashing this customer's user ids. */
  idSalt: string;
  /** Shared secret for signing outbound webhooks and verifying inbound ones. */
  webhookSecret: string;
  webhookUrl: string | null;
  /** Opt-in flag for cross-customer joins. Off by default (CLAUDE.md rule 8). */
  crossCustomerOptIn: boolean;
}

export interface CustomerStore {
  byApiKey(apiKey: string): Promise<Customer | null>;
  byId(id: string): Promise<Customer | null>;
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function constantTimeMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export class MemoryCustomerStore implements CustomerStore {
  private readonly byKey = new Map<string, Customer>();
  private readonly byIdMap = new Map<string, Customer>();

  add(customer: Customer): Customer {
    this.byKey.set(customer.apiKeyHash, customer);
    this.byIdMap.set(customer.id, customer);
    return customer;
  }

  /** Convenience for tests and local development. */
  create(id: string, name: string, apiKey: string, webhookUrl: string | null = null): Customer {
    return this.add({
      id,
      name,
      apiKeyHash: hashApiKey(apiKey),
      idSalt: newCustomerSalt(),
      webhookSecret: `whsec_${id}`,
      webhookUrl,
      crossCustomerOptIn: false,
    });
  }

  async byApiKey(apiKey: string): Promise<Customer | null> {
    return this.byKey.get(hashApiKey(apiKey)) ?? null;
  }

  async byId(id: string): Promise<Customer | null> {
    return this.byIdMap.get(id) ?? null;
  }
}
