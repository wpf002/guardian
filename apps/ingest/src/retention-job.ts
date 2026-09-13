import type { AuditLog } from "@guardian/audit";
import { NoStreamRetention, type StreamRetention } from "./queue.js";

/**
 * Retention enforcement (CLAUDE.md rule 7, DESIGN.md 7, 9).
 *
 * Every stored row carries a customer id and a retention class, and deletion is
 * a scheduled job rather than a hope. This sweep runs on a timer and does three
 * things:
 *
 *   1. Drops raw text from T0 events older than 24 hours, keeping the features.
 *   2. Deletes any row past its expiry, oldest class first.
 *   3. Trims the event streams to the same 24 hour cutoff (ROADMAP S-4). A
 *      queued event is raw text Guardian is holding, and Redis Streams keep an
 *      entry after it is acknowledged, so without this a quiet partition held
 *      every message it had ever carried.
 *   4. Records what it deleted in the audit chain, because a defence motion
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
  /**
   * Account names that expired, or that no flagged pair names any more. A name
   * is kept only while its account is in a conversation Guardian flagged, so a
   * pair deleted earlier in this same sweep takes its names with it.
   */
  deleteExpiredNames(now: Date): Promise<number>;
  deleteExpiredBundles(now: Date): Promise<number>;
  /**
   * Webhook delivery rows past expiry. A delivery carrying a reviewer-confirmed
   * T3 was stamped CASE_1Y at enqueue, so the expiry it is compared against is
   * already the preservation date; nothing here shortens it.
   */
  deleteExpiredDeliveries(now: Date): Promise<number>;
}

export type SweepStep =
  | "text"
  | "events"
  | "pairs"
  | "actors"
  | "names"
  | "bundles"
  | "deliveries"
  | "streams";

export interface SweepResult {
  textCleared: number;
  eventsDeleted: number;
  pairsDeleted: number;
  actorsDeleted: number;
  namesDeleted: number;
  bundlesDeleted: number;
  deliveriesDeleted: number;
  /**
   * Stream entries trimmed past the text cutoff. Not a health signal: an entry
   * stays in the stream after it is consumed, so on a working system nearly
   * everything counted here has already been scored and persisted.
   */
  streamEntriesTrimmed: number;
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
  streams: StreamRetention = new NoStreamRetention(),
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
  // After pairs, so a name whose last flagged conversation went a moment ago
  // goes in the same run rather than waiting an hour.
  const namesDeleted = await step("names", () => delegate.deleteExpiredNames(now));
  const bundlesDeleted = await step("bundles", () => delegate.deleteExpiredBundles(now));
  const deliveriesDeleted = await step("deliveries", () =>
    delegate.deleteExpiredDeliveries(now),
  );
  // Same cutoff as the text step, because it is the same rule about the same
  // words: rule 7 says T0 raw text is gone within 24 hours, and a queued event
  // is raw text whichever store is holding it.
  const streamEntriesTrimmed = await step("streams", () => streams.trimBefore(textCutoff));

  const result: SweepResult = {
    textCleared,
    eventsDeleted,
    pairsDeleted,
    actorsDeleted,
    namesDeleted,
    bundlesDeleted,
    deliveriesDeleted,
    streamEntriesTrimmed,
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
    /**
     * Expired pairs, and the review rows that hang off them.
     *
     * This used to exclude any pair with a review row and any pair a reviewer
     * had resolved, because `Review.pair` is `onDelete: Restrict` and a delete
     * would fail. Every decision sets both, dismissal included, so the moment a
     * reviewer touched a case it became immortal: a teen-romance false positive
     * dismissed on day two kept the child's quoted excerpts in `pairs.signals`
     * for ever, with an `expiresAt` in the past that nothing acted on, while the
     * console told the reviewer the excerpts were deleted.
     *
     * Rule 7 wins over the Restrict. The rule says deletion is a scheduled job;
     * the Restrict was a comment saying a decision should outlive a pair. Both
     * cannot hold, and the reason the rule wins is that the decision does
     * outlive it: every review is on the hash chain, which is append-only and
     * tamper-evident and is the record that would be shown to a regulator. The
     * mutable row is a copy. Keeping the copy meant keeping a child's words to
     * protect something already kept somewhere better.
     *
     * The Restrict stays, because it still stops an accidental pair delete
     * elsewhere from taking decisions with it. The sweep deletes the reviews
     * itself, in the same transaction, so the deletion is deliberate rather
     * than a cascade nobody sees. A legal hold is still excluded.
     */
    async deleteExpiredPairs(now) {
      const doomed = await prisma.pair.findMany({
        where: { expiresAt: { lt: now }, retention: { not: "LEGAL_HOLD" } },
        select: { id: true },
        take: PAIR_DELETE_BATCH,
      });
      if (doomed.length === 0) return 0;

      const ids = doomed.map((row) => String(row.id));
      const results = await prisma.$transaction([
        prisma.review.deleteMany({ where: { pairId: { in: ids } } }),
        prisma.pair.deleteMany({ where: { id: { in: ids } } }),
      ]);
      // The pair delete is the second operation, and its count is the number
      // this step reports. The reviews that went with it are not pairs.
      return results[1]?.count ?? 0;
    },
    async deleteExpiredActors(now) {
      const result = await prisma.actor.deleteMany({
        where: { expiresAt: { lt: now }, retention: { not: "LEGAL_HOLD" } },
      });
      return result.count;
    },
    /*
     * Names go on two conditions. Past their own expiry, like every row. And
     * the moment no flagged pair names the account, whatever the expiry says,
     * because the promise to the operator is that a name is kept only while the
     * account is in a conversation Guardian flagged. A pair under legal hold
     * still names its accounts, so their names stay with it; a name under legal
     * hold is never touched.
     */
    async deleteExpiredNames(now) {
      const expired = await prisma.accountName.deleteMany({
        where: { expiresAt: { lt: now }, retention: { not: "LEGAL_HOLD" } },
      });

      // Paged by id through the whole table, so every name is checked on every
      // run. A single capped read would check the same first rows forever and
      // never reach the rest.
      const orphaned: string[] = [];
      let after = "";
      for (let page = 0; page < NAME_MAX_PAGES; page += 1) {
        const names = await prisma.accountName.findMany({
          where: { retention: { not: "LEGAL_HOLD" }, id: { gt: after } },
          select: { id: true, customerId: true, hashedUid: true },
          orderBy: { id: "asc" },
          take: NAME_CHECK_BATCH,
        });
        if (names.length === 0) break;
        after = String(names[names.length - 1]!.id);

        const byCustomer = new Map<string, Array<{ id: string; hashedUid: string }>>();
        for (const row of names) {
          const list = byCustomer.get(String(row.customerId)) ?? [];
          list.push({ id: String(row.id), hashedUid: String(row.hashedUid) });
          byCustomer.set(String(row.customerId), list);
        }
        for (const [customerId, rows] of byCustomer) {
          const uids = rows.map((row) => row.hashedUid);
          /*
           * One distinct read per side of the pair. A single read capped at a
           * row count let one account in many flagged conversations fill the
           * cap, and every other account in the page then looked unnamed and
           * lost its name. Distinct on the uid bounds each read by the page
           * size, so no cap is needed and none can crowd anything out.
           */
          const flagged = { customerId, tier: { in: ["T1", "T2", "T3"] } };
          const asActor = await prisma.pair.findMany({
            where: { ...flagged, actorUid: { in: uids } },
            select: { actorUid: true },
            distinct: ["actorUid"],
            take: uids.length,
          });
          const asTarget = await prisma.pair.findMany({
            where: { ...flagged, targetUid: { in: uids } },
            select: { targetUid: true },
            distinct: ["targetUid"],
            take: uids.length,
          });
          const named = new Set<string>();
          for (const pair of asActor) named.add(String(pair.actorUid));
          for (const pair of asTarget) named.add(String(pair.targetUid));
          for (const row of rows) if (!named.has(row.hashedUid)) orphaned.push(row.id);
        }
        // No short-page exit. Stopping when a page came back smaller than the
        // batch assumed the driver always fills a page it can, and a page that
        // came back short for any other reason would have ended the check with
        // names left unread. It stops on an empty page, one extra read a run.
      }
      if (orphaned.length === 0) return expired.count;
      const gone = await prisma.accountName.deleteMany({ where: { id: { in: orphaned } } });
      return expired.count + gone.count;
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

/**
 * Pairs deleted per sweep. Bounded because the delete runs in one transaction
 * with its reviews, and an unbounded transaction over a year of expired rows is
 * a lock nobody wants. The sweep runs hourly, so a backlog drains.
 */
const PAIR_DELETE_BATCH = 500;
/** Names read per page when checking each one still has a flagged pair. */
const NAME_CHECK_BATCH = 1000;
/** A ceiling on pages per run, so a runaway table cannot hold the sweep open. */
const NAME_MAX_PAGES = 1000;


interface Deletable {
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
}

export interface PrismaLike {
  /**
   * Pairs are read before they are deleted, because their review rows go in the
   * same transaction and the Restrict on that foreign key means the order
   * matters.
   */
  pair: Deletable & {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      distinct?: Array<"actorUid" | "targetUid">;
      take: number;
    }): Promise<Array<Record<string, unknown>>>;
  };
  review: Deletable;
  $transaction<T>(operations: Array<Promise<T>>): Promise<T[]>;
  event: Deletable & {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  actor: Deletable;
  accountName: Deletable & {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      orderBy: { id: "asc" };
      take: number;
    }): Promise<Array<Record<string, unknown>>>;
  };
  evidenceBundle: Deletable;
  webhookDelivery: Deletable;
}

/** Run the sweep on an interval. Returns a stop function. */
export function scheduleRetentionSweep(
  delegate: RetentionDelegate,
  audit: AuditLog,
  intervalMs = 60 * 60 * 1000,
  streams: StreamRetention = new NoStreamRetention(),
): () => void {
  const timer = setInterval(() => {
    runRetentionSweep(delegate, audit, new Date(), streams)
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
