import { signPayload, type TierResult, type WebhookPayload } from "@guardian/schema";

/**
 * Action dispatch. The customer configured what a tier means on their service;
 * Guardian sends the tier and the reasons and never an assertion about a person
 * (CLAUDE.md rule 5).
 */

export interface WebhookTarget {
  url: string;
  secret: string;
}

export interface DispatchResult {
  delivered: boolean;
  status?: number;
  error?: string;
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

export async function dispatch(
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
