import {
  assertNoMessageText,
  deliveryEnqueueSchema,
  escalateRetention,
  expiresAt as retentionExpiresAt,
  retentionForTier,
  signPayload,
  webhookDeliverySchema,
  type DeliveryEnqueueInput,
  type DeliveryStatus,
  type RetentionClass,
  type WebhookDelivery,
} from "@guardian/schema";
import { checkWebhookTarget, type TargetCheck } from "@guardian/schema/webhook-target";

/**
 * Reliable webhook delivery (ROADMAP phase 3).
 *
 * The scorer used to POST the tier once and forget the result, which loses the
 * tier whenever the customer's endpoint is restarting. A delivery is now a row
 * with a schedule: enqueue writes it, a worker claims it under a row lock,
 * attempts it, and either marks it delivered or writes the next attempt time
 * back. Eight attempts and it is dead, which is what the reviewer console's
 * dead-letter view lists.
 *
 * Three constraints run through the module.
 *
 *   1. A delivery row carries a customerId and a retention class like every
 *      other stored row (rule 7), and it holds the tier, the salted-hash uids
 *      and the rationale, never message text (rule 1). The payload is validated
 *      against a strict schema on the way in.
 *   2. The signing stays HMAC over timestamp and body, with the same two
 *      headers, so a customer already verifying with packages/sdk-ts keeps
 *      working across this change.
 *   3. The signing secret is never copied onto a delivery row. It is resolved
 *      from the customer at send time.
 */

export const DELIVERY_HEADERS = {
  timestamp: "x-guardian-timestamp",
  signature: "x-guardian-signature",
} as const;

export interface BackoffPolicy {
  baseMs: number;
  factor: number;
  /** Ceiling on any single wait, including one a Retry-After header asks for. */
  capMs: number;
  /** Attempts after which a retryable failure becomes dead. */
  maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  baseMs: 1_000,
  factor: 2,
  capMs: 60 * 60 * 1_000,
  maxAttempts: 8,
};

export const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * How long a claim may sit before another worker may take the row. Longer than
 * the request timeout, so a slow send is never stolen from under itself, and
 * short enough that a worker killed mid-attempt frees its rows in a minute.
 */
export const DEFAULT_CLAIM_TIMEOUT_MS = 60_000;

/**
 * Equal jitter. The nominal wait doubles per attempt up to the cap, and the
 * actual wait is half of it plus a random half. Full jitter would let a retry
 * land almost immediately after the failure it is backing off from; no jitter
 * would synchronise every queued delivery to one customer into the same second
 * when their endpoint comes back.
 *
 * With the default policy the cap is not reached inside eight attempts. It
 * bounds a Retry-After a customer sends, and any policy configured with more
 * attempts than the default.
 */
export function backoffMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF,
  rand: () => number = Math.random,
): number {
  const n = Math.max(1, Math.floor(attempt));
  const nominal = Math.min(policy.capMs, policy.baseMs * Math.pow(policy.factor, n - 1));
  return Math.round(nominal / 2 + (nominal / 2) * rand());
}

export type StatusVerdict = "delivered" | "retry" | "dead";

/**
 * 2xx is delivered. 408, 429 and 5xx are the endpoint saying "not now", so they
 * retry. Every other 4xx is the endpoint saying the request is wrong, and a 400
 * or a 403 will not fix itself by being sent again; retrying it just burns the
 * schedule and hides the misconfiguration from the dead-letter view.
 *
 * A 3xx is dead, and the request is sent with redirect: "manual" so that this
 * branch is actually reached. Following a redirect would hand the customer's
 * endpoint a way to walk the signed POST somewhere the https and private-space
 * checks never looked: a 307 to http://169.254.169.254 preserves the method,
 * the body and the x-guardian signature headers, and the outcome comes back to
 * the operator through the dead-letter view. Where the redirect is opaque the
 * status reads 0, so isRedirect covers that too.
 */
export function classifyStatus(status: number): StatusVerdict {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 408 || status === 429) return "retry";
  if (status >= 500) return "retry";
  return "dead";
}

/**
 * True for a response the fetch did not follow. `type` is "opaqueredirect" on a
 * real Response and absent on the plain objects the tests use, so both shapes
 * are recognised.
 */
export function isRedirect(res: { status: number; type?: string }): boolean {
  if (res.type === "opaqueredirect") return true;
  return res.status >= 300 && res.status < 400;
}

/**
 * Retry-After, in either of its two forms: delay in seconds, or an HTTP date.
 * Clamped to [0, capMs] so a customer cannot park a row for a week. Returns
 * null when the header is absent or unparseable, and the caller falls back to
 * the backoff schedule.
 */
export function parseRetryAfter(
  header: string | null | undefined,
  nowMs: number,
  capMs: number = DEFAULT_BACKOFF.capMs,
): number | null {
  if (header === null || header === undefined) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;

  if (/^\d+$/.test(trimmed)) return clampDelay(Number(trimmed) * 1_000, capMs);

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return clampDelay(at - nowMs, capMs);
}

function clampDelay(ms: number, capMs: number): number | null {
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.min(capMs, ms));
}

/**
 * Error class and any driver code, never the message. A fetch error message
 * quotes the url, and a customer's url can carry a token in a query string.
 */
export function describeDeliveryError(err: unknown): string {
  if (typeof err !== "object" || err === null) return "Error";
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  const base = typeof name === "string" && name.length > 0 ? name : "Error";
  return (typeof code === "string" ? `${base} ${code}` : base).slice(0, 200);
}

/**
 * A delivery row is kept for a month so a customer can see what failed, and for
 * a year once it carries a reviewer-confirmed T3, which is under the 18 USC
 * 2258A preservation duty like everything else about that case.
 */
export function retentionForDelivery(tier: WebhookDelivery["tier"]): RetentionClass {
  return escalateRetention("WATCH_30D", retentionForTier(tier));
}

export interface DeliveryPatch {
  status: DeliveryStatus;
  attempt: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: Date;
  deliveredAt: Date | null;
}

/**
 * The slice of storage this module needs. Two implementations below: Postgres
 * for the service, memory for the tests and the eval harness.
 */
export interface DeliveryStore {
  enqueue(input: DeliveryEnqueueInput, now?: Date): Promise<WebhookDelivery>;
  /**
   * Take up to `limit` due rows and mark them delivering, so a second worker
   * running the same query gets none of them. Also reclaims rows whose claim
   * has gone stale, which is how a crashed worker's rows come back.
   */
  claimDue(now: Date, limit: number, worker: string): Promise<WebhookDelivery[]>;
  /**
   * Write the result of an attempt back, but only while this worker still holds
   * the claim. `heldBy` is the claimedBy the worker read off the row it was
   * handed; a stale claim has since been reclaimed by somebody else and that
   * worker's result is the live one. Returns false when the write did not land,
   * which means this result is stale and is dropped rather than retried.
   *
   * Without the predicate a worker that overran the claim timeout could
   * overwrite a delivered row back to failed, resurrecting it for a second
   * send with an attempt counter that had gone backwards, or mark delivered a
   * row nobody ever got a 2xx for. Pass null for a row that was never claimed.
   */
  settle(id: string, patch: DeliveryPatch, heldBy: string | null): Promise<boolean>;
  get(id: string): Promise<WebhookDelivery | null>;
  deadLetters(customerId: string, limit: number): Promise<WebhookDelivery[]>;
  requeue(id: string, at: Date): Promise<WebhookDelivery | null>;
}

/** Queue one delivery. Returns the row, so a caller can log its id. */
export async function enqueueDelivery(
  store: DeliveryStore,
  input: DeliveryEnqueueInput,
  now: Date = new Date(),
): Promise<WebhookDelivery> {
  const parsed = deliveryEnqueueSchema.parse(input);
  // The strict schema already refuses an unknown field. This names the offence
  // when one is nested, and it is the line to read when asking whether a
  // delivery row can hold chat content.
  assertNoMessageText(parsed.payload, "enqueueDelivery");
  return store.enqueue(parsed, now);
}

export interface AttemptDeps {
  fetchImpl?: typeof fetch;
  /**
   * Where the URL is allowed to point, checked immediately before the request.
   * Defaults to the real check. The save-time check in the settings page sees
   * the name the operator typed and not what it resolves to an hour later, so
   * this is the one that closes DNS rebinding on a queued row. Injectable so a
   * test can drive the loop against a loopback endpoint.
   */
  checkTarget?: (url: URL) => Promise<TargetCheck> | TargetCheck;
  /**
   * The customer's webhook secret. Resolved per attempt rather than stored on
   * the row, so rotating a secret takes effect on the next attempt and a table
   * dump is not a set of live signing keys.
   */
  secretFor: (customerId: string) => Promise<string | null> | string | null;
  now?: () => number;
  rand?: () => number;
  policy?: BackoffPolicy;
  timeoutMs?: number;
}

export interface AttemptOutcome {
  id: string;
  status: DeliveryStatus;
  attempt: number;
  statusCode: number | null;
  error: string | null;
  nextAttemptAt: Date;
  /** Milliseconds until the next attempt. 0 on a terminal outcome. */
  delayMs: number;
  /**
   * False when the claim had already been reclaimed by another worker, so this
   * result was dropped and the row reads whatever that worker wrote. The
   * attempt still happened, which is why the outcome is returned rather than
   * swallowed: a dropped result is a duplicate POST, and the operator should be
   * able to see how often it happens.
   */
  settled: boolean;
}

/**
 * One attempt at one delivery, and the schedule that follows from it. The
 * caller has already claimed the row.
 */
export async function attemptDelivery(
  store: DeliveryStore,
  row: WebhookDelivery,
  deps: AttemptDeps,
): Promise<AttemptOutcome> {
  const policy = deps.policy ?? DEFAULT_BACKOFF;
  const now = deps.now ?? Date.now;
  const rand = deps.rand ?? Math.random;
  const doFetch = deps.fetchImpl ?? fetch;
  const checkTarget = deps.checkTarget ?? checkWebhookTarget;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempt = row.attempt + 1;

  // Before anything is signed or sent. The row holds a url string copied at
  // enqueue; the operating system re-resolves that name on every attempt and
  // nothing else inspects the answer, so a name that answered publicly when it
  // was saved and answers privately now would otherwise take the signed tier
  // into Guardian's own network. Dead rather than retried: a refused target is
  // a configuration fact, and eight attempts at it is eight probes.
  const target = await resolveTarget(row.url, checkTarget);
  if (!target.ok) {
    return settleWith(
      store,
      row,
      {
        status: "dead",
        attempt,
        lastStatusCode: null,
        lastError: "target_refused",
        nextAttemptAt: new Date(now()),
        deliveredAt: null,
      },
      0,
    );
  }

  const secret = await deps.secretFor(row.customerId);
  if (secret === null || secret === "") {
    // Nothing about waiting produces a secret. Dead, and visible in the
    // dead-letter view where an operator can fix the customer row.
    return settleWith(
      store,
      row,
      {
        status: "dead",
        attempt,
        lastStatusCode: null,
        lastError: "missing_webhook_secret",
        nextAttemptAt: new Date(now()),
        deliveredAt: null,
      },
      0,
    );
  }

  const body = JSON.stringify(row.payload);
  const startedAt = now();
  const timestamp = Math.floor(startedAt / 1_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let statusCode: number | null = null;
  let verdict: StatusVerdict;
  let error: string | null = null;
  let retryAfterMs: number | null = null;

  try {
    const res = await doFetch(row.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DELIVERY_HEADERS.timestamp]: String(timestamp),
        [DELIVERY_HEADERS.signature]: signPayload(body, secret, timestamp),
      },
      body,
      // Never followed. See classifyStatus: a redirect is the one way an
      // endpoint that passed every target check can still choose where the
      // signed payload lands.
      redirect: "manual",
      signal: controller.signal,
    });
    statusCode = res.status;
    if (isRedirect(res)) {
      verdict = "dead";
      error = "redirected";
    } else {
      verdict = classifyStatus(res.status);
      if (verdict === "retry") {
        retryAfterMs = parseRetryAfter(headerOf(res, "retry-after"), now(), policy.capMs);
      }
    }
  } catch (err) {
    // A timeout and a refused connection are both the endpoint being away.
    verdict = "retry";
    error = describeDeliveryError(err);
  } finally {
    clearTimeout(timer);
  }

  if (verdict === "delivered") {
    const at = new Date(now());
    return settleWith(
      store,
      row,
      {
        status: "delivered",
        attempt,
        lastStatusCode: statusCode,
        lastError: null,
        nextAttemptAt: at,
        deliveredAt: at,
      },
      0,
    );
  }

  const detail = error ?? (statusCode === null ? "unknown" : `http_${statusCode}`);

  if (verdict === "dead" || attempt >= policy.maxAttempts) {
    return settleWith(
      store,
      row,
      {
        status: "dead",
        attempt,
        lastStatusCode: statusCode,
        lastError: detail,
        nextAttemptAt: new Date(now()),
        deliveredAt: null,
      },
      0,
    );
  }

  // Retry-After raises the wait, never lowers it. A shedding load balancer can
  // answer 429 with "0", and an HTTP-date form needs only a little clock skew
  // to parse as zero, and either would collapse the whole eight-attempt budget
  // into a couple of seconds and dead-letter every queued tier for that
  // customer. Honouring a longer wait is the point of the header; honouring a
  // shorter one than the schedule is never useful.
  const scheduled = backoffMs(attempt, policy, rand);
  const delay = Math.max(scheduled, retryAfterMs ?? 0);
  return settleWith(
    store,
    row,
    {
      status: "failed",
      attempt,
      lastStatusCode: statusCode,
      lastError: detail,
      nextAttemptAt: new Date(now() + delay),
      deliveredAt: null,
    },
    delay,
  );
}

/**
 * Parse the stored url and run the target check over it. An unparseable url is
 * a refusal rather than a throw: the row was written with whatever string the
 * enqueue carried, and a bad one belongs in the dead-letter view where an
 * operator can see it, not as an exception that stops the pass.
 */
async function resolveTarget(
  url: string,
  check: (url: URL) => Promise<TargetCheck> | TargetCheck,
): Promise<TargetCheck> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "That endpoint is not a URL Guardian can send to." };
  }
  return check(parsed);
}

/** First value of a header, tolerating a fake response that carries a plain object. */
function headerOf(res: Response, name: string): string | null {
  const headers: unknown = res.headers;
  if (headers === null || headers === undefined) return null;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const bag = headers as Record<string, unknown>;
  const value = bag[name] ?? bag[name.toLowerCase()];
  return typeof value === "string" ? value : null;
}

async function settleWith(
  store: DeliveryStore,
  row: WebhookDelivery,
  patch: DeliveryPatch,
  delayMs: number,
): Promise<AttemptOutcome> {
  const landed = await store.settle(row.id, patch, row.claimedBy);
  return {
    id: row.id,
    status: patch.status,
    attempt: patch.attempt,
    statusCode: patch.lastStatusCode,
    error: patch.lastError,
    nextAttemptAt: patch.nextAttemptAt,
    delayMs,
    settled: landed,
  };
}

export const DEAD_LETTER_PAGE = 100;

/**
 * Deliveries that ran out of attempts or were refused outright, newest first.
 * The read behind the reviewer console's dead-letter view. Scoped to one
 * customer: nothing here joins across customers (rule 8).
 */
export function listDeadLetters(
  store: DeliveryStore,
  customerId: string,
  limit: number = DEAD_LETTER_PAGE,
): Promise<WebhookDelivery[]> {
  return store.deadLetters(customerId, Math.max(1, Math.min(limit, 1_000)));
}

/**
 * Put a dead delivery back on the queue, due now, with the attempt counter
 * reset so it gets the full schedule again. Returns null when the row is gone,
 * and leaves a row that is not dead alone: redelivering something already in
 * flight is how a customer gets the same tier twice.
 */
export function redeliver(
  store: DeliveryStore,
  id: string,
  at: Date = new Date(),
): Promise<WebhookDelivery | null> {
  return store.requeue(id, at);
}

/* ------------------------------------------------------------------ stores */

function derive(input: DeliveryEnqueueInput, now: Date, id: string): WebhookDelivery {
  return {
    id,
    customerId: input.customerId,
    kind: input.kind,
    url: input.url,
    payload: input.payload,
    actorUid: input.payload.actorUid,
    targetUid: input.payload.targetUid ?? null,
    tier: input.payload.tier,
    status: "pending",
    attempt: 0,
    lastStatusCode: null,
    lastError: null,
    nextAttemptAt: now,
    deliveredAt: null,
    claimedAt: null,
    claimedBy: null,
    retention: retentionForDelivery(input.payload.tier),
    expiresAt: retentionExpiresAt(retentionForDelivery(input.payload.tier), now),
    createdAt: now,
    updatedAt: now,
  };
}

/** In-memory store for tests and the eval harness. */
export class MemoryDeliveryStore implements DeliveryStore {
  readonly rows = new Map<string, WebhookDelivery>();
  private seq = 0;
  claimTimeoutMs = DEFAULT_CLAIM_TIMEOUT_MS;

  async enqueue(input: DeliveryEnqueueInput, now: Date = new Date()): Promise<WebhookDelivery> {
    this.seq += 1;
    const row = derive(input, now, `wd_${this.seq}`);
    this.rows.set(row.id, row);
    return { ...row };
  }

  /**
   * The memory twin of FOR UPDATE SKIP LOCKED. Claiming flips the status in the
   * same pass that selects, so a second caller sees no claimable row. Async
   * only in signature: nothing awaits between the read and the write, so two
   * concurrent callers cannot interleave.
   */
  async claimDue(now: Date, limit: number, worker: string): Promise<WebhookDelivery[]> {
    const staleBefore = now.getTime() - this.claimTimeoutMs;
    const due = [...this.rows.values()]
      .filter((row) => isClaimable(row, now, staleBefore))
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
      .slice(0, limit);

    return due.map((row) => {
      const claimed: WebhookDelivery = {
        ...row,
        status: "delivering",
        claimedAt: now,
        claimedBy: worker,
        updatedAt: now,
      };
      this.rows.set(row.id, claimed);
      return { ...claimed };
    });
  }

  async settle(id: string, patch: DeliveryPatch, heldBy: string | null): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row) return false;
    // The same predicate the Prisma store applies, so the twin models the real
    // store on the case that matters rather than only on the happy path.
    if (heldBy !== null && (row.claimedBy !== heldBy || row.status !== "delivering")) {
      return false;
    }
    this.rows.set(id, {
      ...row,
      status: patch.status,
      attempt: patch.attempt,
      lastStatusCode: patch.lastStatusCode,
      lastError: patch.lastError,
      nextAttemptAt: patch.nextAttemptAt,
      deliveredAt: patch.deliveredAt,
      claimedAt: null,
      claimedBy: null,
      updatedAt: patch.nextAttemptAt,
    });
    return true;
  }

  async get(id: string): Promise<WebhookDelivery | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async deadLetters(customerId: string, limit: number): Promise<WebhookDelivery[]> {
    return [...this.rows.values()]
      .filter((row) => row.customerId === customerId && row.status === "dead")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }

  async requeue(id: string, at: Date): Promise<WebhookDelivery | null> {
    const row = this.rows.get(id);
    if (!row || row.status !== "dead") return null;
    const next: WebhookDelivery = {
      ...row,
      status: "pending",
      attempt: 0,
      lastError: null,
      lastStatusCode: null,
      nextAttemptAt: at,
      claimedAt: null,
      claimedBy: null,
      updatedAt: at,
    };
    this.rows.set(id, next);
    return { ...next };
  }
}

function isClaimable(row: WebhookDelivery, now: Date, staleBefore: number): boolean {
  if (row.status === "pending" || row.status === "failed") {
    return row.nextAttemptAt.getTime() <= now.getTime();
  }
  // A claim nobody released. The worker holding it is gone.
  return row.status === "delivering" && (row.claimedAt?.getTime() ?? 0) <= staleBefore;
}

/* ------------------------------------------------------------------ prisma */

/**
 * The slice of the generated client this store needs, written out rather than
 * imported, so the module typechecks without the generated model and can be
 * tested against a fake. Same pattern as prisma-customers.ts.
 */
export interface DeliveryDelegate {
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    take?: number;
  }): Promise<Array<Record<string, unknown>>>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

export interface DeliveryPrismaLike {
  webhookDelivery: DeliveryDelegate;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/**
 * The claim. Postgres does the locking: the inner select takes a row lock on
 * the due rows and skips any row another worker already holds, so two workers
 * running this at the same instant get disjoint sets and nothing is sent twice.
 *
 * The status literals are constants in this file, not input, so they are inline
 * with an explicit enum cast; only the clocks and the limit are parameters.
 */
const CLAIM_SQL = `
UPDATE "webhook_deliveries" AS d
SET "status" = 'delivering'::"DeliveryStatus",
    "claimedAt" = $1,
    "claimedBy" = $2,
    "updatedAt" = $1
WHERE d."id" IN (
  SELECT c."id" FROM "webhook_deliveries" AS c
  WHERE (c."status" IN ('pending'::"DeliveryStatus", 'failed'::"DeliveryStatus")
         AND c."nextAttemptAt" <= $1)
     OR (c."status" = 'delivering'::"DeliveryStatus" AND c."claimedAt" <= $3)
  ORDER BY c."nextAttemptAt" ASC
  LIMIT $4
  FOR UPDATE SKIP LOCKED
)
RETURNING d.*
`;

export class PrismaDeliveryStore implements DeliveryStore {
  constructor(
    private readonly db: DeliveryPrismaLike,
    private readonly claimTimeoutMs: number = DEFAULT_CLAIM_TIMEOUT_MS,
  ) {}

  async enqueue(input: DeliveryEnqueueInput, now: Date = new Date()): Promise<WebhookDelivery> {
    const draft = derive(input, now, "");
    const row = await this.db.webhookDelivery.create({
      data: {
        customerId: draft.customerId,
        kind: draft.kind,
        url: draft.url,
        payload: draft.payload,
        actorUid: draft.actorUid,
        targetUid: draft.targetUid,
        tier: draft.tier,
        status: draft.status,
        attempt: 0,
        nextAttemptAt: draft.nextAttemptAt,
        retention: draft.retention,
        expiresAt: draft.expiresAt,
      },
    });
    return toDelivery(row);
  }

  async claimDue(now: Date, limit: number, worker: string): Promise<WebhookDelivery[]> {
    const staleBefore = new Date(now.getTime() - this.claimTimeoutMs);
    const rows = await this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      CLAIM_SQL,
      now,
      worker,
      staleBefore,
      limit,
    );

    // Parsed one row at a time. The claim UPDATE has already committed by the
    // time this runs, so a single unparseable row throwing out of the map would
    // strand the whole claimed batch at status delivering until the claim
    // timeout, and would take the worker process down with it on every restart:
    // CLAIM_SQL has no customer predicate and orders by nextAttemptAt, so the
    // poison row sorts first on every pass and no customer gets any delivery.
    // A row this store cannot read is dead with a reason instead, which puts it
    // in the dead-letter view and out of the claim set.
    const out: WebhookDelivery[] = [];
    for (const raw of rows) {
      try {
        out.push(toDelivery(raw));
      } catch {
        const id = typeof raw.id === "string" ? raw.id : null;
        if (id === null) continue;
        await this.db.webhookDelivery.updateMany({
          where: { id },
          data: {
            status: "dead",
            lastError: "unparseable_row",
            claimedAt: null,
            claimedBy: null,
          },
        });
      }
    }
    return out;
  }

  async settle(id: string, patch: DeliveryPatch, heldBy: string | null): Promise<boolean> {
    // Fenced on the claim, the way requeue is fenced on the row still being
    // dead. count === 0 means another worker reclaimed this row while the
    // attempt was in flight and has already written its own result.
    const { count } = await this.db.webhookDelivery.updateMany({
      where: heldBy === null ? { id } : { id, claimedBy: heldBy, status: "delivering" },
      data: {
        status: patch.status,
        attempt: patch.attempt,
        lastStatusCode: patch.lastStatusCode,
        lastError: patch.lastError,
        nextAttemptAt: patch.nextAttemptAt,
        deliveredAt: patch.deliveredAt,
        claimedAt: null,
        claimedBy: null,
      },
    });
    return count > 0;
  }

  async get(id: string): Promise<WebhookDelivery | null> {
    const row = await this.db.webhookDelivery.findUnique({ where: { id } });
    return row ? toDelivery(row) : null;
  }

  async deadLetters(customerId: string, limit: number): Promise<WebhookDelivery[]> {
    const rows = await this.db.webhookDelivery.findMany({
      where: { customerId, status: "dead" },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toDelivery);
  }

  async requeue(id: string, at: Date): Promise<WebhookDelivery | null> {
    // Conditional on the row still being dead, so a redeliver racing a worker
    // cannot reset a row that is already back in flight.
    const { count } = await this.db.webhookDelivery.updateMany({
      where: { id, status: "dead" },
      data: {
        status: "pending",
        attempt: 0,
        lastError: null,
        lastStatusCode: null,
        nextAttemptAt: at,
        claimedAt: null,
        claimedBy: null,
      },
    });
    if (count === 0) return null;
    return this.get(id);
  }
}

/**
 * Parse a database row into the canonical shape. The strict payload schema runs
 * here too, so a row carrying a field it should not is a loud failure on read
 * rather than a quiet POST of chat content to a customer.
 */
export function toDelivery(row: Record<string, unknown>): WebhookDelivery {
  return webhookDeliverySchema.parse(row);
}
