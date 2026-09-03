import Fastify, { type FastifyInstance } from "fastify";
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
 * Order matters. Media rejection runs before parsing and before any logging,
 * so bytes are refused without ever being written anywhere.
 */

export interface ServerDeps {
  customers: CustomerStore;
  queue: EventQueue;
  audit: AuditLog;
  /** Body cap. A text event with a hash has no reason to be large. */
  maxBodyBytes?: number;
  logger?: boolean;
}

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

export function buildServer(deps: ServerDeps): FastifyInstance {
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  // Log level sits at warn so Fastify's per-request info lines never fire. A
  // request line can carry a channel name or a uid and nothing here needs to be
  // in a log file.
  const app = Fastify({
    logger: deps.logger ? { level: "warn" } : false,
    bodyLimit: maxBodyBytes,
  });

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

  app.post("/v1/events", async (request, reply) => {
    const contentTypeViolation = checkContentType(request.headers["content-type"]);
    if (contentTypeViolation) {
      return refuse(reply, deps, null, [contentTypeViolation]);
    }

    const wrapper = request.body as { raw?: string } | undefined;
    const raw = wrapper?.raw;
    if (typeof raw !== "string") {
      return reply.code(415).send({ error: "send application/json" });
    }

    const sizeViolation = checkBodySize(Buffer.byteLength(raw), maxBodyBytes);
    if (sizeViolation) return refuse(reply, deps, null, [sizeViolation]);

    const auth = await authenticate(request.headers, raw, deps.customers);
    if (!auth.ok) {
      return reply.code(auth.status).send({ error: auth.error });
    }
    const customer = auth.customer;

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

    return reply.code(rejected.length === 0 ? 202 : 207).send({
      accepted: accepted.length,
      rejected,
    });
  });

  return app;
}

function issueText(issue: { path: (string | number)[]; message: string }): string {
  return `${issue.path.join(".") || "body"}: ${issue.message}`;
}

type AuthResult =
  | { ok: true; customer: Customer }
  | { ok: false; status: number; error: string };

async function authenticate(
  headers: Record<string, unknown>,
  raw: string,
  customers: CustomerStore,
): Promise<AuthResult> {
  const apiKey = headerValue(headers, "x-guardian-key");
  if (!apiKey) return { ok: false, status: 401, error: "missing x-guardian-key" };

  const customer = await customers.byApiKey(apiKey);
  if (!customer) return { ok: false, status: 401, error: "unknown api key" };

  // The signature is optional for direct API calls and required for webhooks,
  // which is what the surface adapters use.
  const signature = headerValue(headers, "x-guardian-signature");
  const timestamp = headerValue(headers, "x-guardian-timestamp");
  if (signature || timestamp) {
    if (!signature || !timestamp) {
      return { ok: false, status: 401, error: "signature and timestamp must both be present" };
    }
    const verdict = verifySignature(raw, customer.webhookSecret, Number(timestamp), signature);
    if (!verdict.ok) {
      return { ok: false, status: 401, error: `signature ${verdict.reason}` };
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
 * queued. Text survives this step; the scorer drops it for T0 within 24h
 * (DESIGN.md 7).
 */
export function minimize(inbound: InboundEvent, customer: Customer): Event {
  const retention = retentionForTier("T0");
  const expiry = expiresAt(retention, inbound.ts) ?? new Date(inbound.ts.getTime() + 86_400_000);

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
    provenance: { ...inbound.provenance, receivedAt: new Date() },
    retention,
    expiresAt: expiry,
  };
}

async function refuse(
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
  deps: ServerDeps,
  customer: Customer | null,
  violations: ReturnType<typeof scanForMedia>,
): Promise<unknown> {
  const redacted = redactViolations(violations);

  // A customer-side violation is recorded against the customer, not the user.
  await deps.audit.append({
    kind: "customer.violation",
    customerId: customer?.id ?? "unknown",
    payload: { violations: redacted },
  });

  return reply.code(422).send({
    error: "media bytes are never accepted",
    detail:
      "Guardian stores hashes and verdicts only. Run PhotoDNA, Safer or the Content Safety API on your side and send the sha256 plus the verdict.",
    violations: redacted,
  });
}
