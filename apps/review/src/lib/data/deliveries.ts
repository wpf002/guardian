/**
 * The webhook delivery queue, as an operator reads it.
 *
 * apps/ingest owns the queue and retries it; this is the view. Two things an
 * operator needs and had no way to see: which tiers never reached their own
 * endpoint, and how often a worker's result was dropped because another worker
 * had already reclaimed the row. The second one matters because a dropped
 * result means the customer got the tier twice, and how often it happens is the
 * signal that the batch and claim clocks are mismatched (ROADMAP P-13).
 *
 * Nothing here opens a payload. The dead-letter list reads the columns copied
 * out at enqueue, which is why they were copied out.
 */

import { getPrisma, isMockMode } from "../db";
import type { Session } from "../session";

export interface DeadLetterRow {
  id: string;
  kind: string;
  /** Host only. The full endpoint is a customer setting, not queue evidence. */
  host: string;
  tier: "T0" | "T1" | "T2" | "T3";
  attempt: number;
  /** The error class, never a message. A message can quote a response body. */
  lastError: string | null;
  lastStatusCode: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryHealth {
  /** Rows that will never be retried again without an operator requeueing them. */
  dead: DeadLetterRow[];
  deadCount: number;
  /** Rows waiting or mid-flight. A backlog is a different problem from a dead row. */
  pendingCount: number;
  deliveredCount: number;
  /**
   * Deliveries whose worker result was dropped because the claim had been
   * reclaimed. Each one is a POST the customer received and the row does not
   * record, which is to say a duplicate. Null when nothing counts them yet.
   */
  droppedResults: number | null;
  windowDays: number;
}

export const DELIVERY_WINDOW_DAYS = 30;

/** Host, or the raw string when it will not parse. Never the path or query. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable endpoint";
  }
}

export async function getDeliveryHealth(
  session: Session,
  limit = 20,
): Promise<DeliveryHealth> {
  const since = new Date(Date.now() - DELIVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  if (isMockMode()) {
    // Fixtures have no delivery rows. An empty queue is a real state and the
    // card says so, rather than inventing failures nobody caused.
    return {
      dead: [],
      deadCount: 0,
      pendingCount: 0,
      deliveredCount: 0,
      droppedResults: null,
      windowDays: DELIVERY_WINDOW_DAYS,
    };
  }

  const prisma = await getPrisma();
  const where = { customerId: session.customerId, createdAt: { gte: since } };
  const [dead, deadCount, pendingCount, deliveredCount] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where: { ...where, status: "dead" },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        kind: true,
        url: true,
        tier: true,
        attempt: true,
        lastError: true,
        lastStatusCode: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.webhookDelivery.count({ where: { ...where, status: "dead" } }),
    prisma.webhookDelivery.count({
      where: { ...where, status: { in: ["pending", "delivering", "failed"] } },
    }),
    prisma.webhookDelivery.count({ where: { ...where, status: "delivered" } }),
  ]);

  return {
    dead: dead.map((row) => ({
      id: row.id,
      kind: row.kind,
      host: hostOf(row.url),
      tier: row.tier,
      attempt: row.attempt,
      lastError: row.lastError,
      lastStatusCode: row.lastStatusCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    deadCount,
    pendingCount,
    deliveredCount,
    // The worker knows when it drops a result and nothing persists it yet. Null
    // rather than zero: zero would claim it never happens.
    droppedResults: null,
    windowDays: DELIVERY_WINDOW_DAYS,
  };
}

/**
 * Why a delivery is dead, in the operator's words. The stored value is a class
 * name so nothing quotes a response body; this is the translation, and an
 * unknown class falls through as itself rather than as "unknown error".
 */
export function deadLetterReason(row: DeadLetterRow): string {
  switch (row.lastError) {
    case "target_refused":
      return "The endpoint failed the target check when the attempt was made. Guardian will not send a signed tier to an address inside a private range.";
    case "redirected":
      return "The endpoint answered with a redirect. Redirects are never followed, because a redirect is how an endpoint that passed every check still chooses where the payload lands.";
    case "missing_webhook_secret":
      return "The customer record has no webhook secret, so nothing could be signed. Set one in settings and requeue.";
    case null:
      return `Gave up after ${row.attempt} attempts with no error recorded.`;
    default:
      return row.lastStatusCode === null
        ? `Gave up after ${row.attempt} attempts. Last failure: ${row.lastError}.`
        : `Gave up after ${row.attempt} attempts. Last response: HTTP ${row.lastStatusCode}.`;
  }
}
