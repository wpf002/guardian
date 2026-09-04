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

/**
 * Mock mode disables the entire auth stack: the middleware waves every request
 * through, getSession() returns the owner seat without reading a cookie, and
 * requireRole("owner") succeeds for an anonymous visitor. That is fine on a
 * laptop and unacceptable on a deployment, so it is never inferred in
 * production.
 *
 * A production deploy whose database service is unlinked, renamed or not yet
 * attached now fails on the first query instead of quietly serving the whole
 * console, on fixtures, to whoever finds the URL. Turning it on there still
 * takes the explicit GUARDIAN_MOCK=1, which nobody sets by accident, and the
 * app says so on screen.
 */
export function isMockMode(): boolean {
  if (process.env.GUARDIAN_MOCK === "0") return false;
  if (process.env.GUARDIAN_MOCK === "1") {
    warnOnceIfProduction();
    return true;
  }
  if (process.env.NODE_ENV === "production") return false;
  return !process.env.DATABASE_URL;
}

let warnedAboutProductionMock = false;

function warnOnceIfProduction(): void {
  if (warnedAboutProductionMock || process.env.NODE_ENV !== "production") return;
  warnedAboutProductionMock = true;
  console.warn(
    "[guardian] GUARDIAN_MOCK=1 in a production build. The console is serving fixtures and every request is signed in as the mock owner seat. Unset it before this is reachable by anyone.",
  );
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
