import type { AuditLog } from "@guardian/audit";

/**
 * Retention enforcement (CLAUDE.md rule 7, DESIGN.md 7, 9).
 *
 * Every stored row carries a customer id and a retention class, and deletion is
 * a scheduled job rather than a hope. This sweep runs on a timer and does three
 * things:
 *
 *   1. Drops raw text from T0 events older than 24 hours, keeping the features.
 *   2. Deletes any row past its expiry, oldest class first.
 *   3. Records what it deleted in the audit chain, because a defence motion
 *      will ask when data went and who said so.
 *
 * It lives beside ingest because ingest is what stamps the class on write. It
 * never touches a row under LEGAL_HOLD, and it never touches a row whose
 * retention was escalated by a reviewer, because escalation only ratchets up.
 *
 * The delegate interface is the slice of Prisma this needs, so the sweep is
 * testable without a database.
 */

export interface RetentionDelegate {
  /** T0 events past the text window. Returns how many had text cleared. */
  clearExpiredText(cutoff: Date): Promise<number>;
  /** Rows past expiry, excluding legal holds. Returns how many were deleted. */
  deleteExpiredEvents(now: Date): Promise<number>;
  deleteExpiredPairs(now: Date): Promise<number>;
  deleteExpiredActors(now: Date): Promise<number>;
  deleteExpiredBundles(now: Date): Promise<number>;
}

export interface SweepResult {
  textCleared: number;
  eventsDeleted: number;
  pairsDeleted: number;
  actorsDeleted: number;
  bundlesDeleted: number;
  ranAt: Date;
}

export const TEXT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runRetentionSweep(
  delegate: RetentionDelegate,
  audit: AuditLog,
  now = new Date(),
): Promise<SweepResult> {
  const textCutoff = new Date(now.getTime() - TEXT_WINDOW_MS);

  const textCleared = await delegate.clearExpiredText(textCutoff);
  const eventsDeleted = await delegate.deleteExpiredEvents(now);
  const pairsDeleted = await delegate.deleteExpiredPairs(now);
  const actorsDeleted = await delegate.deleteExpiredActors(now);
  const bundlesDeleted = await delegate.deleteExpiredBundles(now);

  const result: SweepResult = {
    textCleared,
    eventsDeleted,
    pairsDeleted,
    actorsDeleted,
    bundlesDeleted,
    ranAt: now,
  };

  // The sweep is logged even when it deleted nothing, so a gap in the log is a
  // sign the job stopped running rather than a quiet period.
  await audit.append({
    kind: "retention.deleted",
    customerId: "system",
    payload: { ...result, ranAt: result.ranAt.toISOString(), textCutoff: textCutoff.toISOString() },
  });

  return result;
}

/**
 * Build the delegate from a Prisma client. Written as a factory so the job can
 * be unit tested against a fake and wired to Prisma in main.
 *
 * Note the LEGAL_HOLD exclusion on every delete. A hold outranks an expiry and
 * is released by a named custodian, not by a timer.
 */
export function prismaRetentionDelegate(prisma: PrismaLike): RetentionDelegate {
  return {
    async clearExpiredText(cutoff) {
      const result = await prisma.event.updateMany({
        where: { retention: "EPHEMERAL_24H", ts: { lt: cutoff }, text: { not: null } },
        data: { text: null },
      });
      return result.count;
    },
    async deleteExpiredEvents(now) {
      const result = await prisma.event.deleteMany({
        where: { expiresAt: { lt: now }, retention: { not: "LEGAL_HOLD" } },
      });
      return result.count;
    },
    async deleteExpiredPairs(now) {
      const result = await prisma.pair.deleteMany({
        where: { expiresAt: { lt: now }, retention: { not: "LEGAL_HOLD" }, resolvedAt: null },
      });
      return result.count;
    },
    async deleteExpiredActors(now) {
      const result = await prisma.actor.deleteMany({
        where: { expiresAt: { lt: now }, retention: { not: "LEGAL_HOLD" } },
      });
      return result.count;
    },
    async deleteExpiredBundles(now) {
      const result = await prisma.evidenceBundle.deleteMany({
        where: { expiresAt: { lt: now }, retention: { not: "LEGAL_HOLD" } },
      });
      return result.count;
    },
  };
}

interface Deletable {
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

export interface PrismaLike {
  event: Deletable & {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  pair: Deletable;
  actor: Deletable;
  evidenceBundle: Deletable;
}

/** Run the sweep on an interval. Returns a stop function. */
export function scheduleRetentionSweep(
  delegate: RetentionDelegate,
  audit: AuditLog,
  intervalMs = 60 * 60 * 1000,
): () => void {
  const timer = setInterval(() => {
    runRetentionSweep(delegate, audit).catch((err) => {
      console.error("retention sweep failed:", err);
    });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
