import {
  inboundEventSchema,
  signPayload,
  verifySignature,
  webhookPayloadSchema,
  type InboundEvent,
  type WebhookPayload,
} from "@guardian/schema";

/**
 * Customer-facing SDK. Two jobs: send events, and verify the webhook that comes
 * back. It refuses to send media bytes on the client side too, so a customer
 * finds out at their own call site rather than from a 422.
 */

export class GuardianMediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianMediaError";
  }
}

export class GuardianApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "GuardianApiError";
  }
}

export interface GuardianClientOptions {
  apiKey: string;
  /** Shared secret. When set, every request is signed. */
  webhookSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface SendResult {
  accepted: number;
  rejected: Array<{ index: number; error: string }>;
}

const DATA_URI = /^data:(image|video|application\/octet-stream)/i;
const BASE64_BLOB = /[A-Za-z0-9+/]{512,}={0,2}/;

export class GuardianClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GuardianClientOptions) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:3001").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async send(event: InboundEvent): Promise<SendResult> {
    return this.sendBatch([event]);
  }

  async sendBatch(events: InboundEvent[]): Promise<SendResult> {
    for (const [index, event] of events.entries()) {
      assertNoBytes(event, index);
      inboundEventSchema.parse(event);
    }

    const body = JSON.stringify(events.length === 1 ? events[0] : { events });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-guardian-key": this.options.apiKey,
    };

    if (this.options.webhookSecret) {
      const ts = Math.floor(Date.now() / 1000);
      headers["x-guardian-timestamp"] = String(ts);
      headers["x-guardian-signature"] = signPayload(body, this.options.webhookSecret, ts);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/v1/events`, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => ({}))) as SendResult & { error?: string };
      if (!res.ok && res.status !== 207) {
        throw new GuardianApiError(json.error ?? `ingest returned ${res.status}`, res.status, json);
      }
      return { accepted: json.accepted ?? 0, rejected: json.rejected ?? [] };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Verify an inbound webhook. Returns the parsed payload or throws, so a
   * customer cannot accidentally act on an unverified tier.
   */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookPayload {
    const secret = this.options.webhookSecret;
    if (!secret) throw new Error("webhookSecret is required to verify webhooks");

    const signature = headers["x-guardian-signature"];
    const timestamp = headers["x-guardian-timestamp"];
    if (!signature || !timestamp) throw new Error("missing signature headers");

    const verdict = verifySignature(rawBody, secret, Number(timestamp), signature);
    if (!verdict.ok) throw new Error(`webhook signature ${verdict.reason}`);

    return webhookPayloadSchema.parse(JSON.parse(rawBody));
  }
}

/**
 * Client-side enforcement of rule 1. The event type has no field for bytes, but
 * a customer can still put a data URI in `text`, so this checks the values too.
 */
export function assertNoBytes(event: unknown, index = 0): void {
  const seen = new Set<unknown>();
  walk(event, "$");

  function walk(node: unknown, path: string): void {
    if (typeof node === "string") {
      if (DATA_URI.test(node.trim())) {
        throw new GuardianMediaError(
          `event ${index} at ${path} carries a data URI. Guardian accepts a sha256 hash and your own scanner's verdict, never bytes.`,
        );
      }
      if (BASE64_BLOB.test(node)) {
        throw new GuardianMediaError(
          `event ${index} at ${path} carries a long base64 run. Send media.sha256 instead.`,
        );
      }
      return;
    }
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walk(value, `${path}.${key}`);
    }
  }
}

export { inboundEventSchema, webhookPayloadSchema } from "@guardian/schema";
export type {
  AgeBand,
  InboundEvent,
  MediaRef,
  Provenance,
  Tier,
  WebhookPayload,
} from "@guardian/schema";
