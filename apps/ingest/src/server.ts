import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  expiresAt,
  hashHint,
  hashUid,
  hashUidOrNull,
  inboundEventSchema,
  retentionForTier,
  verifySignature,
  type Event,
  type InboundEvent,
} from "@guardian/schema";
import type { AuditLog } from "@guardian/audit";
import type { Customer, CustomerStore } from "./customers.js";
import { checkBodySize, checkContentType, redactViolations, scanForMedia } from "./media-guard.js";
import type { EventQueue } from "./queue.js";

/**
 * The ingest edge (DESIGN.md 7). Auth per customer, schema validation, media
 * rejection, PII minimization, and a canonical Event onto the queue.
 *
 * Order matters. The key is resolved first because it is the cheapest step
 * and because every refusal that writes (a rule 1 violation goes into the
 * audit chain and the violations table) must be attributed to a customer.
 * Media rejection then runs before parsing and before any logging, so bytes
 * are refused without ever being written anywhere. A request that fails
 * before authentication gets a status code and a counter and nothing else.
 */

export interface ServerDeps {
  customers: CustomerStore;
  queue: EventQueue;
  audit: AuditLog;
  /**
   * Called for every refusal that happens before a key was resolved: a
   * missing or unknown key, a bad signature, a rate limit.
   * Receives a fixed reason and nothing from the request. Default is a
   * counter on the server plus a warn line.
   */
  onPreAuthRefusal?: (reason: PreAuthRefusal) => void;
  /**
   * Per customer cap on /v1/events, applied once the key resolved. Defaults to
   * RATE_LIMIT_DEFAULT. This is the quota; one customer exhausting it never
   * costs another customer a request.
   */
  rateLimit?: RateLimitOptions | false;
  /**
   * Per source address cap, applied before authentication. A brake on an
   * anonymous flood only. Defaults to PRE_AUTH_RATE_LIMIT_DEFAULT.
   */
  preAuthRateLimit?: RateLimitOptions | false;
  /**
   * What Fastify should trust for request.ip. Behind a proxy the TCP peer is
   * the proxy, so set this to the number of hops or the proxy's addresses,
   * never `true`: `true` takes the client's own X-Forwarded-For header.
   */
  trustProxy?: string[] | string | number;
  /**
   * Optional table-backed record of refusals, written alongside the audit
   * entry. Receives the redacted violations only: reason, path, detail.
   */
  violations?: {
    record(
      customerId: string,
      violations: Array<{ reason: string; at: string; detail: string }>,
    ): Promise<void>;
  };
  /** Body cap. A text event with a hash has no reason to be large. */
  maxBodyBytes?: number;
  logger?: boolean;
}

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export type PreAuthRefusal =
  | "missing_key"
  | "unknown_key"
  | "bad_signature"
  | "rate_limited";

export interface RateLimitOptions {
  /** Requests allowed per key (a customer id, or a source address) per window. */
  max: number;
  windowMs: number;
}

/**
 * A customer batches up to 500 events per request, so a legitimate source
 * rarely needs more than a few requests a second. The quota is per customer
 * and in process.
 */
export const RATE_LIMIT_DEFAULT: RateLimitOptions = { max: 600, windowMs: 60_000 };

/**
 * The pre-authentication brake, per source address. It is deliberately much
 * looser than the per-customer quota: behind a platform proxy every customer
 * arrives from the same peer address, so a tight bucket here would let one
 * anonymous flood refuse every real customer's batches. The quota that matters
 * is the per-customer one, which an unauthenticated caller cannot reach.
 */
export const PRE_AUTH_RATE_LIMIT_DEFAULT: RateLimitOptions = { max: 3_000, windowMs: 60_000 };

/** Counters the server exposes for whoever scrapes them. Never request content. */
export interface IngestCounters {
  preAuthRefusals: Record<PreAuthRefusal, number>;
  /** Authenticated requests refused by the per-customer quota. */
  rateLimited: number;
  queueFull: number;
  auditAppendFailures: number;
}

declare module "fastify" {
  interface FastifyInstance {
    counters: IngestCounters;
  }
}

function emptyCounters(): IngestCounters {
  return {
    preAuthRefusals: {
      missing_key: 0,
      unknown_key: 0,
      bad_signature: 0,
      rate_limited: 0,
    },
    rateLimited: 0,
    queueFull: 0,
    auditAppendFailures: 0,
  };
}

/**
 * Fixed window counter. Entries expire with the window, so memory is bounded
 * by the number of distinct keys seen per window. The window is fixed rather
 * than sliding, so up to twice `max` can land across a boundary; that is
 * acceptable for a brake and a quota, neither of which is a billing meter.
 */
export class SourceRateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly opts: RateLimitOptions,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Returns true when the request is allowed. */
  allow(source: string): boolean {
    const now = this.now();
    const entry = this.hits.get(source);
    if (!entry || now - entry.windowStart >= this.opts.windowMs) {
      if (this.hits.size > 10_000) this.sweep(now);
      this.hits.set(source, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.opts.max;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.hits) {
      if (now - entry.windowStart >= this.opts.windowMs) this.hits.delete(key);
    }
  }
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  // Log level sits at warn so Fastify's per-request info lines never fire. A
  // request line can carry a channel name or a uid and nothing here needs to be
  // in a log file.
  const options: FastifyServerOptions = {
    logger: deps.logger ? { level: "warn" } : false,
    bodyLimit: maxBodyBytes,
  };
  // Off unless the deployment names its proxy. request.ip is only used for the
  // pre-auth brake, and an unbounded trustProxy would let any caller pick
  // their own bucket with a header. A number is a hop count, which Fastify
  // accepts at runtime but does not carry in its option type.
  if (deps.trustProxy !== undefined) {
    options.trustProxy = deps.trustProxy as FastifyServerOptions["trustProxy"];
  }
  const app = Fastify(options);

  app.addContentTypeParser("*", (_req, payload, done) => {
    // Anything that is not JSON is refused before a parser touches it.
    payload.resume();
    done(null, undefined);
  });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, { raw: body as string });
    },
  );

  app.get("/health", async () => ({ ok: true }));

  const counters = emptyCounters();
  app.decorate("counters", counters);
  // Two buckets. The pre-auth one is keyed on the source address, which behind
  // a proxy is shared by every customer, so it is only a flood brake. The
  // quota is keyed on the customer id resolved from the key, so one customer
  // can never spend another customer's budget.
  const preAuthLimiter =
    deps.preAuthRateLimit === false
      ? null
      : new SourceRateLimiter(deps.preAuthRateLimit ?? PRE_AUTH_RATE_LIMIT_DEFAULT);
  const customerLimiter =
    deps.rateLimit === false ? null : new SourceRateLimiter(deps.rateLimit ?? RATE_LIMIT_DEFAULT);

  const preAuthRefused = (reason: PreAuthRefusal): void => {
    counters.preAuthRefusals[reason] += 1;
    if (deps.onPreAuthRefusal) {
      deps.onPreAuthRefusal(reason);
    } else {
      // A fixed string. No address, no key, no body.
      app.log.warn({ reason }, "ingest refused a request before authentication");
    }
  };

  app.post("/v1/events", async (request, reply) => {
    // Nothing before this line writes anywhere. An unauthenticated caller
    // gets a status code and a counter increment and never a row in the
    // audit chain, which is append-only and shared with every customer.
    if (preAuthLimiter && !preAuthLimiter.allow(request.ip)) {
      preAuthRefused("rate_limited");
      return reply.code(429).header("retry-after", "60").send({ error: "too many requests" });
    }

    const wrapper = request.body as { raw?: string } | undefined;
    const raw = typeof wrapper?.raw === "string" ? wrapper.raw : null;

    // The key is a sha256 and one indexed read, cheaper than any refusal that
    // writes, so it goes first. The signature is checked over the bytes the
    // JSON parser kept; a non-JSON body has none, so a signed binary request
    // fails here rather than reaching the media guard.
    const auth = await authenticate(request.headers, raw ?? "", deps.customers);
    if (!auth.ok) {
      preAuthRefused(auth.reason);
      return reply.code(auth.status).send({ error: auth.error });
    }
    const customer = auth.customer;

    // The quota, now that there is a customer to charge it to.
    if (customerLimiter && !customerLimiter.allow(customer.id)) {
      counters.rateLimited += 1;
      return reply
        .code(429)
        .header("retry-after", "60")
        .send({ error: "too many requests for this customer" });
    }

    const contentTypeViolation = checkContentType(request.headers["content-type"]);
    if (contentTypeViolation) {
      return refuse(reply, deps, customer, [contentTypeViolation]);
    }

    if (raw === null) {
      return reply.code(415).send({ error: "send application/json" });
    }

    const sizeViolation = checkBodySize(Buffer.byteLength(raw), maxBodyBytes);
    if (sizeViolation) return refuse(reply, deps, customer, [sizeViolation]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply.code(400).send({ error: "body is not valid json" });
    }

    // Rule 1. Runs on the parsed shape before validation, so a payload that is
    // otherwise well formed but carries bytes is still refused.
    const violations = scanForMedia(parsed);
    if (violations.length > 0) {
      return refuse(reply, deps, customer, violations);
    }

    const batch = Array.isArray((parsed as { events?: unknown }).events)
      ? (parsed as { events: unknown[] }).events
      : [parsed];

    if (batch.length > 500) {
      return reply.code(413).send({ error: "at most 500 events per request" });
    }

    // Backpressure per partition. A customer whose stream is near its cap is
    // told to retry rather than having its oldest unscored events trimmed.
    if (deps.queue.isFull && (await deps.queue.isFull(customer.id))) {
      counters.queueFull += 1;
      return reply
        .code(429)
        .header("retry-after", "30")
        .send({ error: "event queue for this customer is full, retry later" });
    }

    const accepted: string[] = [];
    const rejected: Array<{ index: number; error: string }> = [];

    for (const [index, item] of batch.entries()) {
      const result = inboundEventSchema.safeParse(item);
      if (!result.success) {
        rejected.push({ index, error: result.error.issues.map(issueText).join("; ") });
        continue;
      }
      const event = minimize(result.data, customer);
      await deps.queue.publish(customer.id, event);
      accepted.push(event.externalId);
    }

    // The events are on the stream by now. A chain append that fails here is
    // reported as a gap and counted, not turned into a 500: a 500 makes the
    // customer retry a batch the scorer is already consuming, and a replayed
    // batch is worse for the pair state than a missing ingest entry.
    let audited = true;
    try {
      await deps.audit.append({
        kind: "event.ingested",
        customerId: customer.id,
        payload: {
          accepted: accepted.length,
          rejected: rejected.length,
          // External ids only. No text, no uids, hashed or otherwise.
          externalIds: accepted.slice(0, 50),
        },
      });
    } catch {
      audited = false;
      counters.auditAppendFailures += 1;
      app.log.warn({ customerId: customer.id }, "event.ingested audit append failed after publish");
    }

    return reply.code(rejected.length === 0 ? 202 : 207).send({
      accepted: accepted.length,
      rejected,
      ...(audited ? {} : { audited: false }),
    });
  });

  return app;
}

function issueText(issue: { path: (string | number)[]; message: string }): string {
  return `${issue.path.join(".") || "body"}: ${issue.message}`;
}

type AuthResult =
  | { ok: true; customer: Customer }
  | { ok: false; status: number; error: string; reason: PreAuthRefusal };

async function authenticate(
  headers: Record<string, unknown>,
  raw: string,
  customers: CustomerStore,
): Promise<AuthResult> {
  const apiKey = headerValue(headers, "x-guardian-key");
  if (!apiKey) return { ok: false, status: 401, error: "missing x-guardian-key", reason: "missing_key" };

  const customer = await customers.byApiKey(apiKey);
  if (!customer) return { ok: false, status: 401, error: "unknown api key", reason: "unknown_key" };

  // The signature is optional for direct API calls and required for webhooks,
  // which is what the surface adapters use.
  const signature = headerValue(headers, "x-guardian-signature");
  const timestamp = headerValue(headers, "x-guardian-timestamp");
  if (signature || timestamp) {
    if (!signature || !timestamp) {
      return {
        ok: false,
        status: 401,
        error: "signature and timestamp must both be present",
        reason: "bad_signature",
      };
    }
    const verdict = verifySignature(raw, customer.webhookSecret, Number(timestamp), signature);
    if (!verdict.ok) {
      return { ok: false, status: 401, error: `signature ${verdict.reason}`, reason: "bad_signature" };
    }
  }

  // The customer id always comes from the key, never from the body, so a
  // caller cannot write into another customer's partition.
  return { ok: true, customer };
}

function headerValue(headers: Record<string, unknown>, name: string): string | null {
  const value = headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

/**
 * PII minimization. Uids and device hints are replaced with per-customer salted
 * hashes, and the retention class and expiry are stamped before the event is
 * queued, both from the receiving clock. Text survives this step; the scorer
 * drops it for T0 within 24h (DESIGN.md 7).
 */
export function minimize(inbound: InboundEvent, customer: Customer, receivedAt = new Date()): Event {
  const retention = retentionForTier("T0");
  // Retention runs from receipt, never from the customer's own ts. The clock
  // that governs deletion has to be ours (rule 7); inboundEventSchema bounds
  // how far ahead ts may sit, and a backdated ts must not shorten the window
  // either.
  const expiry = expiresAt(retention, receivedAt) ?? new Date(receivedAt.getTime() + 86_400_000);

  return {
    externalId: inbound.externalId,
    customerId: customer.id,
    actorUid: hashUid(inbound.actorUid, customer.idSalt),
    targetUid: hashUidOrNull(inbound.targetUid, customer.idSalt),
    channel: inbound.channel,
    ts: inbound.ts,
    text: inbound.text ?? null,
    media: inbound.media ?? null,
    actorBand: inbound.actorBand,
    targetBand: inbound.targetBand,
    actorRole: inbound.actorRole,
    actorAccountAgeHours: inbound.actorAccountAgeHours ?? null,
    deviceHints: inbound.deviceHints
      ? {
          deviceIdHash: inbound.deviceHints.deviceIdHash
            ? hashHint(inbound.deviceHints.deviceIdHash, customer.idSalt)
            : undefined,
          ipHash: inbound.deviceHints.ipHash
            ? hashHint(inbound.deviceHints.ipHash, customer.idSalt)
            : undefined,
        }
      : null,
    provenance: { ...inbound.provenance, receivedAt },
    retention,
    expiresAt: expiry,
  };
}

/**
 * Record and answer a rule 1 refusal. Only ever reached with an authenticated
 * customer: the chain and the violations table record who sent bytes, and an
 * anonymous caller must not be able to append to either.
 */
async function refuse(
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
  deps: ServerDeps,
  customer: Customer,
  violations: ReturnType<typeof scanForMedia>,
): Promise<unknown> {
  const redacted = redactViolations(violations);

  // A customer-side violation is recorded against the customer, not the user.
  await deps.audit.append({
    kind: "customer.violation",
    customerId: customer.id,
    payload: { violations: redacted },
  });

  if (deps.violations) {
    await deps.violations.record(customer.id, redacted);
  }

  return reply.code(422).send({
    error: "media bytes are never accepted",
    detail:
      "Guardian stores hashes and verdicts only. Run PhotoDNA, Safer or the Content Safety API on your side and send the sha256 plus the verdict.",
    violations: redacted,
  });
}
