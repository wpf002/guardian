import { describe, expect, it } from "vitest";
import { CRITICAL_SIGNALS, inboundEventSchema, isCriticalSignal, mediaRefSchema } from "../src/index.js";

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
  it("matches the four documented forcing signals", () => {
    expect([...CRITICAL_SIGNALS].sort()).toEqual(
      ["known_csam_hash", "meetup_logistics", "payment_after_media", "threat_template"].sort(),
    );
    expect(isCriticalSignal("economic_bait")).toBe(false);
  });
});
