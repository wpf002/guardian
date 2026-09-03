import { describe, expect, it } from "vitest";
import { escalateRetention, expiresAt, retentionForTier, textRetainedForTier } from "../src/index.js";

describe("retention", () => {
  it("maps tiers to classes", () => {
    expect(retentionForTier("T0")).toBe("EPHEMERAL_24H");
    expect(retentionForTier("T1")).toBe("WATCH_30D");
    expect(retentionForTier("T3")).toBe("CASE_1Y");
  });

  it("drops raw text for T0 only", () => {
    expect(textRetainedForTier("T0")).toBe(false);
    expect(textRetainedForTier("T1")).toBe(true);
  });

  it("only ratchets up so a later low score cannot shorten a case", () => {
    expect(escalateRetention("CASE_1Y", "EPHEMERAL_24H")).toBe("CASE_1Y");
    expect(escalateRetention("EPHEMERAL_24H", "CASE_1Y")).toBe("CASE_1Y");
    expect(escalateRetention("CASE_1Y", "LEGAL_HOLD")).toBe("LEGAL_HOLD");
  });

  it("gives no expiry for a legal hold", () => {
    expect(expiresAt("LEGAL_HOLD")).toBeNull();
  });

  it("expires ephemeral rows within 24 hours", () => {
    const from = new Date("2026-09-02T00:00:00Z");
    expect(expiresAt("EPHEMERAL_24H", from)?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });
});
