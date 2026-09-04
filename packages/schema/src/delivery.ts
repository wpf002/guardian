import { z } from "zod";
import { retentionClassSchema, tierSchema, webhookPayloadSchema } from "./types.js";

/**
 * Outbound webhook delivery (ROADMAP phase 3, "webhook delivery with retries
 * and a dead-letter view").
 *
 * A tier the customer needed must not disappear because one POST failed, so a
 * delivery is a durable row with its own schedule rather than a fire-and-forget
 * fetch. These are the canonical shapes. The attempt logic, the store and the
 * worker live in apps/ingest.
 *
 * Two rules shape the row. It carries a customerId and a retention class like
 * every other stored row (rule 7). And it carries the tier, the hashed
 * identifiers and the rationale, never message text: the payload is validated
 * against a strict schema on the way in, so a field carrying chat content
 * cannot be added to it by accident (rule 1, DESIGN.md 7).
 */

export const DELIVERY_STATUSES = [
  /** Queued and never attempted. */
  "pending",
  /** Claimed by a worker. Terminal only if that worker dies, and then it is reclaimed. */
  "delivering",
  /** 2xx from the customer. Done. */
  "delivered",
  /** An attempt failed and a retry is scheduled at nextAttemptAt. */
  "failed",
  /** Out of attempts, or a refusal that will not fix itself. The dead-letter view. */
  "dead",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);

/** Nothing reschedules a row in one of these. */
export const TERMINAL_DELIVERY_STATUSES: readonly DeliveryStatus[] = ["delivered", "dead"];

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return TERMINAL_DELIVERY_STATUSES.includes(status);
}

/** Statuses a worker may claim. A row in either is due when its clock says so. */
export const CLAIMABLE_DELIVERY_STATUSES: readonly DeliveryStatus[] = ["pending", "failed"];

/**
 * Webhook event kinds. One today. It is an enum rather than a free string so a
 * new outbound event has to be declared here, where the payload rules are.
 */
export const DELIVERY_KINDS = ["tier.assigned"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];
export const deliveryKindSchema = z.enum(DELIVERY_KINDS);

/**
 * What may be stored on a delivery row. Strict, so a caller cannot widen the
 * payload with a message excerpt on its way into the database. The underlying
 * WebhookPayload has no content field, and this is the guard that keeps it so.
 */
export const deliveryPayloadSchema = webhookPayloadSchema.strict();
export type DeliveryPayload = z.infer<typeof deliveryPayloadSchema>;

/**
 * Keys that would carry chat content or media. Checked recursively on enqueue
 * so a payload built by hand, rather than by toWebhookPayload, is refused at
 * the write rather than discovered in a database a year later.
 */
export const FORBIDDEN_PAYLOAD_KEYS: readonly string[] = [
  "text",
  "excerpt",
  "excerpts",
  "message",
  "messages",
  "content",
  "body",
  "transcript",
  "timeline",
  "media",
  "mediaBytes",
  "attachment",
  "attachments",
  "image",
  "video",
];

/** Every forbidden key found in the value, as a dotted path. Empty is clean. */
export function findForbiddenPayloadKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => findForbiddenPayloadKeys(entry, `${path}[${i}]`));
  }
  if (typeof value !== "object" || value === null) return [];

  const found: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const here = path === "" ? key : `${path}.${key}`;
    if (FORBIDDEN_PAYLOAD_KEYS.includes(key)) found.push(here);
    found.push(...findForbiddenPayloadKeys(entry, here));
  }
  return found;
}

/**
 * Throws rather than stripping. A silent removal would hide the fact that some
 * code path is trying to put chat content on a row that is allowed to outlive
 * the 24 hour text window.
 */
export function assertNoMessageText(payload: unknown, where: string): void {
  const found = findForbiddenPayloadKeys(payload);
  if (found.length === 0) return;
  throw new Error(
    `${where}: webhook payload carries ${found.join(", ")}. A delivery row holds the tier and the identifiers only (CLAUDE.md rule 1, DESIGN.md 7).`,
  );
}

/** A delivery row as stored. */
export const webhookDeliverySchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  kind: deliveryKindSchema,
  url: z.string().url(),
  payload: deliveryPayloadSchema,
  /**
   * Copied out of the payload so the dead-letter view can list and filter
   * without opening the json. Salted hashes, like everywhere else (rule 8).
   */
  actorUid: z.string(),
  targetUid: z.string().nullable(),
  tier: tierSchema,
  status: deliveryStatusSchema,
  /** Attempts made so far. 0 until the first worker picks it up. */
  attempt: z.number().int().min(0),
  lastStatusCode: z.number().int().nullable(),
  /**
   * The error class and any driver code, never its message. A message can quote
   * a url, a header or a response body.
   */
  lastError: z.string().max(200).nullable(),
  nextAttemptAt: z.coerce.date(),
  deliveredAt: z.coerce.date().nullable(),
  claimedAt: z.coerce.date().nullable(),
  claimedBy: z.string().nullable(),
  retention: retentionClassSchema,
  expiresAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

/** What a caller hands the queue. Everything else is derived at write time. */
export const deliveryEnqueueSchema = z
  .object({
    customerId: z.string().min(1),
    kind: deliveryKindSchema,
    url: z.string().url(),
    payload: deliveryPayloadSchema,
  })
  .strict();
export type DeliveryEnqueueInput = z.infer<typeof deliveryEnqueueSchema>;
