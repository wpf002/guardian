/**
 * The Prisma client for this app, and the switch that decides whether there is
 * one at all.
 *
 * Mock mode exists so the console runs, renders and screenshots without a
 * database. It is on when GUARDIAN_MOCK=1, and on by default when DATABASE_URL
 * is unset, so a fresh checkout starts rather than crashing on a connection
 * string nobody has set yet.
 *
 * The client is imported dynamically. A static import would pull the generated
 * client into every module that touches a data function, including the ones a
 * component test imports under jsdom.
 */

import type { PrismaClient } from "@guardian/schema/db";

export type { PrismaClient };

export function isMockMode(): boolean {
  if (process.env.GUARDIAN_MOCK === "1") return true;
  if (process.env.GUARDIAN_MOCK === "0") return false;
  return !process.env.DATABASE_URL;
}

/**
 * One client per process. Next reloads modules in development, and a new pool
 * on every reload exhausts Postgres connections within a few edits.
 */
const globalForPrisma = globalThis as unknown as {
  guardianReviewPrisma?: Promise<PrismaClient>;
};

export function getPrisma(): Promise<PrismaClient> {
  if (isMockMode()) {
    throw new Error(
      "getPrisma() was called in mock mode. Data functions must branch on isMockMode() before reaching the database.",
    );
  }
  if (!globalForPrisma.guardianReviewPrisma) {
    globalForPrisma.guardianReviewPrisma = import("@guardian/schema/db").then((mod) =>
      mod.createPrismaClient(),
    );
  }
  return globalForPrisma.guardianReviewPrisma;
}

/** Test and script hook. Drops the cached client so a new one is built next call. */
export async function disconnectPrisma(): Promise<void> {
  const pending = globalForPrisma.guardianReviewPrisma;
  globalForPrisma.guardianReviewPrisma = undefined;
  if (!pending) return;
  const client = await pending;
  await client.$disconnect();
}
