import { describe, expect, it } from "vitest";
import {
  CRITICAL_SIGNALS,
  customerComplianceSchema,
  evidenceTimelineRowSchema,
  feedbackAttributionSchema,
  formatJurisdiction,
  inboundEventSchema,
  isActorScoreSoleBasis,
  isCriticalSignal,
  jurisdictionSchema,
  mediaRefSchema,
  signalHitSchema,
  tierResultSchema,
  treatAsPrivateMessaging,
} from "../src/index.js";

const base = {
  externalId: "m1",
  actorUid: "u1",
  targetUid: "u2",
  channel: "general",
  ts: "2026-09-02T00:00:00Z",
  provenance: { surface: "discord", sourceId: "guild-1" },
};

describe("inbound event schema", () => {
  it("accepts a minimal text event", () => {
    const parsed = inboundEventSchema.parse({ ...base, text: "hi" });
    expect(parsed.actorBand).toBe("UNKNOWN");
    expect(parsed.actorRole).toBe("unknown");
  });

  it("rejects unknown fields so media bytes cannot ride along", () => {
    expect(() =>
      inboundEventSchema.parse({ ...base, imageBase64: "aGVsbG8=" }),
    ).toThrow();
    expect(() => inboundEventSchema.parse({ ...base, attachments: [{ data: "..." }] })).toThrow();
  });

  it("accepts a media hash but has no field for bytes", () => {
    const parsed = inboundEventSchema.parse({
      ...base,
      media: { sha256: "a".repeat(64), knownCsamVerdict: "no_match", kind: "image" },
    });
    expect(parsed.media?.sha256).toHaveLength(64);
    expect(() => mediaRefSchema.parse({ sha256: "a".repeat(64), bytes: "AAAA" })).toThrow();
  });

  it("rejects a malformed digest", () => {
    expect(() => inboundEventSchema.parse({ ...base, media: { sha256: "nope" } })).toThrow();
  });
});

describe("critical signals", () => {
  it("matches the documented forcing signals", () => {
    expect([...CRITICAL_SIGNALS].sort()).toEqual(
      [
        "coercion_nonfinancial",
        "known_csam_hash",
        "meetup_logistics",
        "payment_after_media",
        "threat_template",
      ].sort(),
    );
    expect(isCriticalSignal("economic_bait")).toBe(false);
  });
});

describe("age band confidence and provenance", () => {
  it("accepts them beside the band without making them mandatory", () => {
    const parsed = inboundEventSchema.parse({
      ...base,
      actorBand: "A21_PLUS",
      actorBandConfidence: 0.92,
      actorBandProvenance: "government_id",
      targetBand: "A13_15",
      targetBandProvenance: "server_role",
    });
    expect(parsed.actorBandConfidence).toBe(0.92);
    expect(parsed.actorBandProvenance).toBe("government_id");
    expect(parsed.targetBandConfidence ?? null).toBeNull();

    // An integration written before these fields existed still parses.
    expect(inboundEventSchema.parse({ ...base }).actorBandProvenance ?? null).toBeNull();
  });

  it("rejects a confidence outside 0 to 1 and a provenance it does not know", () => {
    expect(() => inboundEventSchema.parse({ ...base, actorBandConfidence: 1.4 })).toThrow();
    expect(() => inboundEventSchema.parse({ ...base, actorBandConfidence: -0.1 })).toThrow();
    expect(() => inboundEventSchema.parse({ ...base, targetBandProvenance: "vibes" })).toThrow();
  });
});

describe("channel visibility", () => {
  it("takes the three values and nothing else", () => {
    expect(inboundEventSchema.parse({ ...base, channelVisibility: "group" }).channelVisibility).toBe(
      "group",
    );
    expect(() => inboundEventSchema.parse({ ...base, channelVisibility: "secret" })).toThrow();
  });

  it("treats an unstated channel as private, so the stricter rule applies", () => {
    expect(treatAsPrivateMessaging(undefined)).toBe(true);
    expect(treatAsPrivateMessaging(null)).toBe(true);
    expect(treatAsPrivateMessaging("private")).toBe(true);
    expect(treatAsPrivateMessaging("group")).toBe(true);
    expect(treatAsPrivateMessaging("public")).toBe(false);
  });
});

describe("viewedByHuman", () => {
  const hit = { kind: "secrecy_instruction", stage: "migrate", weight: 1, ts: "2026-09-02T00:00:00Z" };

  it("is false on a hit the kernel wrote and on a row stored before the field existed", () => {
    expect(signalHitSchema.parse(hit).viewedByHuman).toBe(false);
    expect(signalHitSchema.parse({ ...hit, viewedByHuman: true }).viewedByHuman).toBe(true);
  });

  it("is false on a fresh timeline row", () => {
    const row = evidenceTimelineRowSchema.parse({
      ts: "2026-09-02T00:00:00Z",
      channel: "general",
      direction: "actor_to_target",
      excerpt: "an excerpt",
      mediaSha256: null,
      knownCsamVerdict: null,
      stage: "migrate",
      signals: ["off_platform_migration"],
    });
    expect(row.viewedByHuman).toBe(false);
  });
});

describe("sole automated basis", () => {
  it("defaults to false rather than to an unanswered field", () => {
    expect(tierResultSchema.shape.soleAutomatedBasis.parse(undefined)).toBe(false);
  });

  it("is true only when a tier above T0 rests on the actor score alone", () => {
    const none = { pairSignals: [], criticalSignals: [] } as const;
    expect(isActorScoreSoleBasis({ tier: "T2", ...none })).toBe(true);
    expect(isActorScoreSoleBasis({ tier: "T0", ...none })).toBe(false);
    expect(
      isActorScoreSoleBasis({
        tier: "T2",
        pairSignals: [signalHitSchema.parse(hitFixture())],
        criticalSignals: [],
      }),
    ).toBe(false);
    expect(
      isActorScoreSoleBasis({ tier: "T2", pairSignals: [], criticalSignals: ["threat_template"] }),
    ).toBe(false);
  });
});

describe("jurisdiction and legal basis", () => {
  it("takes an ISO country and a bare subdivision suffix", () => {
    const j = jurisdictionSchema.parse({ country: "US", subdivision: "TX" });
    expect(formatJurisdiction(j)).toBe("US-TX");
    expect(formatJurisdiction(jurisdictionSchema.parse({ country: "IE" }))).toBe("IE");
  });

  it("rejects a lowercase country and a subdivision that repeats it", () => {
    expect(() => jurisdictionSchema.parse({ country: "us" })).toThrow();
    expect(() => jurisdictionSchema.parse({ country: "USA" })).toThrow();
    expect(() => jurisdictionSchema.parse({ country: "US", subdivision: "US-TX" })).toThrow();
  });

  it("leaves an unset basis unset rather than claiming one", () => {
    const parsed = customerComplianceSchema.parse({});
    expect(parsed.legalBasis ?? null).toBeNull();
    expect(customerComplianceSchema.parse({ legalBasis: "operator_authority" }).legalBasis).toBe(
      "operator_authority",
    );
    expect(() => customerComplianceSchema.parse({ legalBasis: "because_we_can" })).toThrow();
  });
});

describe("feedback attribution", () => {
  it("records who wrote a candidate, and defaults to unknown rather than to a reviewer", () => {
    const parsed = feedbackAttributionSchema.parse({ at: "2026-09-02T00:00:00Z" });
    expect(parsed.source).toBe("unknown");
    expect(feedbackAttributionSchema.parse({ at: "2026-09-02T00:00:00Z", source: "moderator" }).source).toBe(
      "moderator",
    );
    expect(() => feedbackAttributionSchema.parse({ at: "2026-09-02T00:00:00Z", source: "anon" })).toThrow();
  });
});

function hitFixture() {
  return { kind: "secrecy_instruction", stage: "migrate", weight: 1, ts: "2026-09-02T00:00:00Z" };
}
