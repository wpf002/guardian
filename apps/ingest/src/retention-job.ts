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
  /** T0 events written before the cutoff. Returns how many had text cleared. */
  clearExpiredText(cutoff: Date): Promise<number>;
  /** Rows past expiry, excluding legal holds. Returns how many were deleted. */
  deleteExpiredEvents(now: Date): Promise<number>;
  deleteExpiredPairs(now: Date): Promise<number>;
  deleteExpiredActors(now: Date): Promise<number>;
  deleteExpiredBundles(now: Date): Promise<number>;
  /**
   * Webhook delivery rows past expiry. A delivery carrying a reviewer-confirmed
   * T3 was stamped CASE_1Y at enqueue, so the expiry it is compared against is
   * already the preservation date; nothing here shortens it.
   */
  deleteExpiredDeliveries(now: Date): Promise<number>;
}

export type SweepStep = "text" | "events" | "pairs" | "actors" | "bundles" | "deliveries";

export interface SweepResult {
  textCleared: number;
  eventsDeleted: number;
  pairsDeleted: number;
  actorsDeleted: number;
  bundlesDeleted: number;
  deliveriesDeleted: number;
  /**
   * Steps that threw. The step still counts as run, its count is 0, and the
   * other steps proceed: one bad row must not stop the rest of the sweep.
   * The detail is the error's class and code only, never its message.
   */
  errors: Array<{ step: SweepStep; error: string }>;
  ranAt: Date;
}

export const TEXT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function runRetentionSweep(
  delegate: RetentionDelegate,
  audit: AuditLog,
  now = new Date(),
): Promise<SweepResult> {
  const textCutoff = new Date(now.getTime() - TEXT_WINDOW_MS);
  const errors: SweepResult["errors"] = [];

  // Each step runs on its own. A foreign key refusing one delete (a pair with
  // a review, a bundle with a report) is recorded and the next step runs, so
  // expired actors and bundles are not left in place because of it (rule 7).
  const step = async (name: SweepStep, run: () => Promise<number>): Promise<number> => {
    try {
      return await run();
    } catch (err) {
      errors.push({ step: name, error: describeError(err) });
      return 0;
    }
  };

  const textCleared = await step("text", () => delegate.clearExpiredText(textCutoff));
  const eventsDeleted = await step("events", () => delegate.deleteExpiredEvents(now));
  const pairsDeleted = await step("pairs", () => delegate.deleteExpiredPairs(now));
  const actorsDeleted = await step("actors", () => delegate.deleteExpiredActors(now));
  const bundlesDeleted = await step("bundles", () => delegate.deleteExpiredBundles(now));
  const deliveriesDeleted = await step("deliveries", () =>
    delegate.deleteExpiredDeliveries(now),
  );

  const result: SweepResult = {
    textCleared,
    eventsDeleted,
    pairsDeleted,
    actorsDeleted,
    bundlesDeleted,
    deliveriesDeleted,
    errors,
    ranAt: now,
  };

  // The sweep is logged even when it deleted nothing or when a step failed,
  // so a gap in the log is a sign the job stopped running rather than a quiet
  // period, and a failing step is visible in the chain rather than only in a
  // process log.
  await audit.append({
    kind: "retention.deleted",
    customerId: "system",
    payload: { ...result, ranAt: result.ranAt.toISOString(), textCutoff: textCutoff.toISOString() },
  });

  return result;
}

/** Class name plus a driver code when there is one. Messages can quote rows; these cannot. */
function describeError(err: unknown): string {
  if (typeof err !== "object" || err === null) return typeof err;
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  const base = typeof name === "string" && name.length > 0 ? name : "Error";
  return typeof code === "string" ? `${base} ${code}` : base;
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
      // createdAt, not ts. ts is the customer's own clock and a wrong one, or
      // a backfill, would decide when text is dropped; createdAt is stamped by
      // the database on the write.
      const result = await prisma.event.updateMany({
        where: { retention: "EPHEMERAL_24H", createdAt: { lt: cutoff }, text: { not: null } },
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
      // A pair with a review row is a reviewer's record and the foreign key
      // is Restrict, so it stays whatever its expiry says. Excluding it here
      // keeps one reviewed pair from aborting the delete of every other
      // expired pair in the same statement.
      const result = await prisma.pair.deleteMany({
        where: {
          expiresAt: { lt: now },
          retention: { not: "LEGAL_HOLD" },
          resolvedAt: null,
          reviews: { none: {} },
        },
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
      // A bundle with a CyberTipline report is under the one year preservation
      // duty whatever its own expiry says, and the foreign key would refuse
      // the delete anyway. Report creation should also move the bundle to
      // CASE_1Y; that lands with the reporting client in phase 3.
      const result = await prisma.evidenceBundle.deleteMany({
        where: { expiresAt: { lt: now }, retention: { not: "LEGAL_HOLD" }, report: null },
      });
      return result.count;
    },
    async deleteExpiredDeliveries(now) {
      // The dead-letter view is a month of failures, and a year where the
      // delivery carried a reviewer-confirmed T3. Both are already on the row
      // as expiresAt, stamped when the delivery was queued.
      const result = await prisma.webhookDelivery.deleteMany({
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
  webhookDelivery: Deletable;
}

/** Run the sweep on an interval. Returns a stop function. */
export function scheduleRetentionSweep(
  delegate: RetentionDelegate,
  audit: AuditLog,
  intervalMs = 60 * 60 * 1000,
): () => void {
  const timer = setInterval(() => {
    runRetentionSweep(delegate, audit)
      .then((result) => {
        if (result.errors.length > 0) {
          console.warn(
            `retention sweep finished with failed steps: ${result.errors.map((e) => `${e.step} (${e.error})`).join(", ")}`,
          );
        }
      })
      .catch((err) => {
        // Only the chain append can throw now. The class name is enough.
        console.error("retention sweep could not record itself:", describeError(err));
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
