import {
  signPayload,
  type DeliveryKind,
  type TierResult,
  type WebhookPayload,
} from "@guardian/schema";

/**
 * Action dispatch. The customer configured what a tier means on their service;
 * Guardian sends the tier and the reasons and never an assertion about a person
 * (CLAUDE.md rule 5).
 *
 * Delivery used to be one fetch whose result was discarded, which lost the tier
 * whenever the customer's endpoint was restarting. It now enqueues a durable
 * delivery row that a worker drains with a retry schedule and a dead-letter
 * view (apps/ingest/src/delivery.ts, ROADMAP phase 3).
 *
 * The queue is registered at startup rather than threaded through the worker,
 * because dispatch is called from scoreAndDispatch with a fixed signature and
 * the scorer and the delivery store are wired in different processes. With no
 * queue registered, dispatch falls back to the synchronous POST, which is what
 * the tests and the eval harness use. Signing is unchanged in both paths: HMAC
 * over timestamp and body, same two headers, so a customer already verifying
 * with packages/sdk-ts keeps working.
 */

export interface WebhookTarget {
  url: string;
  secret: string;
}

export interface DispatchResult {
  delivered: boolean;
  status?: number;
  error?: string;
  /** True when the tier was queued for delivery rather than sent inline. */
  queued?: boolean;
  /** Row id of the queued delivery, for the dead-letter view and the logs. */
  deliveryId?: string;
}

/**
 * The queue port. Implemented by apps/ingest's delivery store, which the scorer
 * does not depend on at build time; only this shape crosses the boundary.
 */
export interface DeliveryEnqueuer {
  enqueue(input: {
    customerId: string;
    kind: DeliveryKind;
    url: string;
    payload: WebhookPayload;
  }): Promise<{ id: string }>;
}

let queue: DeliveryEnqueuer | null = null;

/**
 * Register the delivery queue for this process. Called once at startup. Pass
 * null to go back to the synchronous path, which is what a test does when it
 * wants to assert on the request itself.
 */
export function useDeliveryQueue(next: DeliveryEnqueuer | null): void {
  queue = next;
}

export function currentDeliveryQueue(): DeliveryEnqueuer | null {
  return queue;
}

export function toWebhookPayload(result: TierResult): WebhookPayload {
  return {
    event: "tier.assigned",
    customerId: result.pair.customerId,
    actorUid: result.pair.actorUid,
    targetUid: result.pair.targetUid,
    tier: result.tier,
    rationale: result.rationale,
    criticalSignals: result.criticalSignals,
    versions: result.versions,
    scoredAt: result.scoredAt,
  };
}

/**
 * Hand the tier to the customer. Queued when a queue is registered, sent inline
 * otherwise.
 *
 * The queued path throws if the write fails, unlike the inline path, which
 * reports the failure in its result. That is deliberate: the caller in
 * worker.ts leaves the stream entry unacknowledged when scoring throws, so a
 * failed enqueue is retried from the queue. A duplicate tier is a nuisance; a
 * dropped one is the bug this replaced.
 */
export async function dispatch(
  target: WebhookTarget,
  payload: WebhookPayload,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<DispatchResult> {
  if (queue !== null) {
    const row = await queue.enqueue({
      customerId: payload.customerId,
      kind: payload.event,
      url: target.url,
      payload,
    });
    return { delivered: false, queued: true, deliveryId: row.id };
  }
  return dispatchNow(target, payload, fetchImpl, timeoutMs);
}

/**
 * One POST, with the result returned rather than retried. The synchronous path,
 * and the same code the delivery worker's attempt is modelled on.
 */
export async function dispatchNow(
  target: WebhookTarget,
  payload: WebhookPayload,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<DispatchResult> {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-guardian-timestamp": String(timestamp),
        "x-guardian-signature": signPayload(body, target.secret, timestamp),
      },
      body,
      signal: controller.signal,
    });
    return { delivered: res.ok, status: res.status };
  } catch (err) {
    return { delivered: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
