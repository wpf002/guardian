import { hostname } from "node:os";
import { createPrismaClient } from "@guardian/schema/db";
import {
  attemptDelivery,
  DEFAULT_BACKOFF,
  DEFAULT_CLAIM_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  describeDeliveryError,
  PrismaDeliveryStore,
  type AttemptDeps,
  type AttemptOutcome,
  type BackoffPolicy,
  type DeliveryPrismaLike,
  type DeliveryStore,
} from "./delivery.js";

/**
 * The drain loop for queued webhook deliveries.
 *
 * Claim due rows under a row lock, attempt each, let attemptDelivery write the
 * next schedule back, sleep, repeat. Several instances can run at once: the
 * claim is FOR UPDATE SKIP LOCKED, so two workers get disjoint sets and no
 * customer receives the same tier twice from one row.
 *
 * The loop stops on SIGINT and SIGTERM. Stopping means finishing the batch in
 * hand and then returning, rather than aborting a POST that may already have
 * been received; a row abandoned mid-attempt is reclaimed by its claim timeout
 * anyway, so the worst case is a duplicate POST, never a lost tier and never a
 * wrong row. The second half of that used to be untrue: a worker that overran
 * its claim could settle a row another worker had already delivered. Settling
 * is now fenced on still holding the claim, so a stale result is dropped.
 *
 * Two failures stop the loop rather than a row. A store error on the claim is
 * caught here and the pass returns empty, because a connection reset during a
 * failover or a migrate deploy must not exit a process that then restarts into
 * the same error. Anything else is a bug and is left to propagate.
 */

export interface DeliveryWorkerOptions {
  store: DeliveryStore;
  /** The customer's signing secret. Never stored on a delivery row. */
  secretFor: (customerId: string) => Promise<string | null> | string | null;
  fetchImpl?: typeof fetch;
  /** Stable per process, so a claim can be traced to the worker that took it. */
  workerName?: string;
  /** Rows claimed per pass. */
  batchSize?: number;
  /** Wait between passes when the last pass found nothing. */
  idleMs?: number;
  /** Wait between passes when the last pass was full, to yield to other workers. */
  busyMs?: number;
  policy?: BackoffPolicy;
  timeoutMs?: number;
  /**
   * The store's claim timeout, so a pass can stop attempting rows whose claim
   * has already gone stale. Must match the value the store was built with.
   */
  claimTimeoutMs?: number;
  /** Where a webhook url may point, checked immediately before each request. */
  checkTarget?: AttemptDeps["checkTarget"];
  now?: () => number;
  rand?: () => number;
  /** Injected so a test can drive the loop without real timers. */
  sleep?: (ms: number) => Promise<void>;
  onOutcome?: (outcome: AttemptOutcome) => void;
}

export const DELIVERY_WORKER_DEFAULTS = {
  batchSize: 25,
  idleMs: 1_000,
  busyMs: 50,
} as const;

export function defaultWorkerName(): string {
  return `${hostname()}-${process.pid}`;
}

/** One pass: claim what is due and attempt it. Returns the outcomes. */
export async function runDeliveryPass(opts: DeliveryWorkerOptions): Promise<AttemptOutcome[]> {
  const now = opts.now ?? Date.now;
  const worker = opts.workerName ?? defaultWorkerName();
  const batchSize = opts.batchSize ?? DELIVERY_WORKER_DEFAULTS.batchSize;
  const claimTimeoutMs = opts.claimTimeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS;
  const claimedAt = now();

  let claimed: Awaited<ReturnType<DeliveryStore["claimDue"]>>;
  try {
    claimed = await opts.store.claimDue(new Date(claimedAt), batchSize, worker);
  } catch (err) {
    // The store, not a customer. A transient Postgres error during a failover
    // used to travel out of here, past a runDeliveryWorker with no catch and a
    // main() with try/finally and no catch, into process.exit(1). One bad
    // moment stopped webhook delivery for every customer, and a supervisor
    // restarting into the same error made it a crash loop whose only signal was
    // a restart count. Sleep and try again instead.
    console.error(`delivery claim failed (${describeDeliveryError(err)})`);
    return [];
  }

  const outcomes: AttemptOutcome[] = [];

  for (const row of claimed) {
    // A whole batch is claimed under one clock and then attempted one at a
    // time, so a batch of slow endpoints can push the tail of the batch past
    // the claim its rows are holding. Those rows are reclaimable by another
    // worker now, so stop and let it have them rather than doing work whose
    // result the fence will drop.
    if (now() - claimedAt >= claimTimeoutMs) {
      console.error(
        `delivery pass gave up ${claimed.length - outcomes.length} claimed rows: the batch outran its ${claimTimeoutMs}ms claim`,
      );
      break;
    }
    try {
      const outcome = await attemptDelivery(opts.store, row, {
        fetchImpl: opts.fetchImpl,
        checkTarget: opts.checkTarget,
        secretFor: opts.secretFor,
        now,
        rand: opts.rand,
        policy: opts.policy ?? DEFAULT_BACKOFF,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
      outcomes.push(outcome);
      opts.onOutcome?.(outcome);
    } catch (err) {
      // The store threw, not the customer. The row stays claimed and its claim
      // timeout brings it back, which is the same path a crashed worker takes.
      // The class only: an error message can quote a url or a response body.
      console.error(`delivery ${row.id} could not be settled (${describeDeliveryError(err)})`);
    }
  }

  return outcomes;
}

/**
 * Loop until `shouldStop` says otherwise. Exported separately from main so a
 * test can run it with a fake clock and an injected fetch.
 */
export async function runDeliveryWorker(
  opts: DeliveryWorkerOptions,
  shouldStop: () => boolean,
): Promise<void> {
  const sleep = opts.sleep ?? realSleep;
  const idleMs = opts.idleMs ?? DELIVERY_WORKER_DEFAULTS.idleMs;
  const busyMs = opts.busyMs ?? DELIVERY_WORKER_DEFAULTS.busyMs;
  const batchSize = opts.batchSize ?? DELIVERY_WORKER_DEFAULTS.batchSize;

  while (!shouldStop()) {
    const outcomes = await runDeliveryPass(opts);
    if (shouldStop()) break;
    await sleep(outcomes.length >= batchSize ? busyMs : idleMs);
  }
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Webhook secrets, read from the customers table and cached for a short while.
 * Cached because the drain loop asks on every attempt and a burst of retries to
 * one customer would otherwise be a query each; short because a rotated secret
 * has to take effect without a restart.
 */
export interface SecretDelegate {
  findUnique(args: {
    where: { id: string };
    select: { webhookSecret: true };
  }): Promise<{ webhookSecret: string } | null>;
}

export const SECRET_CACHE_TTL_MS = 30_000;

export function customerSecretResolver(
  customers: SecretDelegate,
  ttlMs: number = SECRET_CACHE_TTL_MS,
  now: () => number = Date.now,
): (customerId: string) => Promise<string | null> {
  const cache = new Map<string, { secret: string | null; at: number }>();
  return async (customerId: string): Promise<string | null> => {
    const hit = cache.get(customerId);
    if (hit && now() - hit.at < ttlMs) return hit.secret;
    const row = await customers.findUnique({
      where: { id: customerId },
      select: { webhookSecret: true },
    });
    const secret = row?.webhookSecret ?? null;
    cache.set(customerId, { secret, at: now() });
    return secret;
  };
}

/**
 * Entrypoint. Environment: DATABASE_URL, plus the tuning knobs below.
 * Run with `node dist/delivery-worker.js`.
 */
async function main(): Promise<void> {
  const db = createPrismaClient(process.env.DATABASE_URL);
  const claimTimeoutMs = Number(process.env.DELIVERY_CLAIM_TIMEOUT_MS ?? DEFAULT_CLAIM_TIMEOUT_MS);
  const timeoutMs = Number(process.env.DELIVERY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  // The claim has to outlive the request it covers, or every slow send is
  // stolen from under itself. Refuse to start rather than run a configuration
  // whose every attempt races its own reclaim.
  if (!(timeoutMs < claimTimeoutMs)) {
    throw new Error(
      `DELIVERY_TIMEOUT_MS (${timeoutMs}) has to be shorter than DELIVERY_CLAIM_TIMEOUT_MS (${claimTimeoutMs}). A request that outlives its claim is reclaimed mid-flight.`,
    );
  }
  const store = new PrismaDeliveryStore(db as unknown as DeliveryPrismaLike, claimTimeoutMs);
  const secretFor = customerSecretResolver(
    (db as unknown as { customer: SecretDelegate }).customer,
  );

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(`delivery worker stopping on ${signal}`);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  const workerName = defaultWorkerName();
  console.log(`delivery worker ${workerName} starting`);
  try {
    await runDeliveryWorker(
      {
        store,
        secretFor,
        workerName,
        batchSize: Number(process.env.DELIVERY_BATCH_SIZE ?? DELIVERY_WORKER_DEFAULTS.batchSize),
        idleMs: Number(process.env.DELIVERY_IDLE_MS ?? DELIVERY_WORKER_DEFAULTS.idleMs),
        timeoutMs,
        claimTimeoutMs,
        onOutcome: (outcome) => {
          if (outcome.status === "dead") {
            console.error(
              `delivery ${outcome.id} dead after ${outcome.attempt} attempts (${outcome.error})`,
            );
          }
        },
      },
      () => stopping,
    );
  } finally {
    await db.$disconnect();
  }
  console.log("delivery worker stopped");
}

if (
  process.argv[1]?.endsWith("delivery-worker.js") ||
  process.argv[1]?.endsWith("delivery-worker.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
