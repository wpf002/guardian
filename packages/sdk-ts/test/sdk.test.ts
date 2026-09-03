import { signPayload } from "@guardian/schema";
import { describe, expect, it, vi } from "vitest";
import { GuardianClient, GuardianMediaError, assertNoBytes } from "../src/index.js";

const event = {
  externalId: "m1",
  actorUid: "u1",
  targetUid: "u2",
  channel: "general",
  ts: new Date("2026-09-02T12:00:00Z"),
  text: "hello",
  actorBand: "A21_PLUS" as const,
  targetBand: "A9_12" as const,
  actorRole: "unknown" as const,
  provenance: { surface: "platform_sdk" as const, sourceId: "app-1" },
};

function clientWith(response: unknown, status = 202) {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } }),
  );
  const client = new GuardianClient({
    apiKey: "gk_1",
    webhookSecret: "whsec_1",
    baseUrl: "https://ingest.example",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl };
}

describe("send", () => {
  it("signs the request when a secret is configured", async () => {
    const { client, fetchImpl } = clientWith({ accepted: 1, rejected: [] });
    await client.send(event);
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-guardian-signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(headers["x-guardian-key"]).toBe("gk_1");
  });

  it("sends a batch under an events key", async () => {
    const { client, fetchImpl } = clientWith({ accepted: 2, rejected: [] });
    await client.sendBatch([event, { ...event, externalId: "m2" }]);
    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.events).toHaveLength(2);
  });

  it("surfaces a 207 as accepted plus per item errors", async () => {
    const { client } = clientWith({ accepted: 1, rejected: [{ index: 1, error: "ts: bad" }] }, 207);
    const result = await client.sendBatch([event, event]);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("throws on an api error", async () => {
    const { client } = clientWith({ error: "unknown api key" }, 401);
    await expect(client.send(event)).rejects.toThrow("unknown api key");
  });
});

describe("client side media refusal", () => {
  it("refuses a data uri before the request leaves the process", async () => {
    const { client, fetchImpl } = clientWith({ accepted: 0, rejected: [] });
    await expect(
      client.send({ ...event, text: "data:image/png;base64,iVBORw0KGgo=" }),
    ).rejects.toBeInstanceOf(GuardianMediaError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a long base64 run", () => {
    expect(() => assertNoBytes({ text: "A".repeat(600) })).toThrow(GuardianMediaError);
  });

  it("allows a sha256 hash", () => {
    expect(() => assertNoBytes({ media: { sha256: "a".repeat(64) } })).not.toThrow();
  });

  it("does not loop on a circular object", () => {
    const node: Record<string, unknown> = { a: 1 };
    node.self = node;
    expect(() => assertNoBytes(node)).not.toThrow();
  });
});

describe("webhook verification", () => {
  const payload = {
    event: "tier.assigned",
    customerId: "cus_1",
    actorUid: "a",
    targetUid: "b",
    tier: "T2",
    rationale: ["Supervision probing followed by a migration ask."],
    criticalSignals: [],
    versions: { modelVersion: "rules-v1", lexiconVersion: "v1", fusionVersion: "rules-v1" },
    scoredAt: "2026-09-02T12:00:00.000Z",
  };

  it("accepts a correctly signed webhook", () => {
    const { client } = clientWith({});
    const raw = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    const parsed = client.verifyWebhook(raw, {
      "x-guardian-timestamp": String(ts),
      "x-guardian-signature": signPayload(raw, "whsec_1", ts),
    });
    expect(parsed.tier).toBe("T2");
  });

  it("throws when the body was changed after signing", () => {
    const { client } = clientWith({});
    const raw = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayload(raw, "whsec_1", ts);
    expect(() =>
      client.verifyWebhook(JSON.stringify({ ...payload, tier: "T3" }), {
        "x-guardian-timestamp": String(ts),
        "x-guardian-signature": sig,
      }),
    ).toThrow(/bad_signature/);
  });

  it("throws when the headers are missing", () => {
    const { client } = clientWith({});
    expect(() => client.verifyWebhook("{}", {})).toThrow(/missing signature headers/);
  });
});
