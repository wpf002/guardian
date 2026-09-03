import { PrismaClient } from "@prisma/client";

/**
 * Prisma client factory, exposed on the @guardian/schema/db subpath only.
 *
 * It is deliberately not re-exported from src/index.ts. The customer SDK
 * imports the package index and must never pull the generated database client
 * into a customer's bundle. Services that own state import this subpath.
 */

export type { PrismaClient } from "@prisma/client";

/** Build a client. With no url the client reads DATABASE_URL from the environment. */
export function createPrismaClient(url?: string): PrismaClient {
  if (url === undefined) return new PrismaClient();
  return new PrismaClient({ datasourceUrl: url });
}
