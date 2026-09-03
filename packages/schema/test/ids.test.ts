import { describe, expect, it } from "vitest";
import { hashUid, newCustomerSalt, signPayload, verifySignature } from "../src/index.js";

describe("identifier hashing", () => {
  it("gives different hashes for the same uid across customers", () => {
    const a = newCustomerSalt();
    const b = newCustomerSalt();
    expect(hashUid("user-1", a)).not.toBe(hashUid("user-1", b));
  });

  it("is stable within a customer", () => {
    const salt = newCustomerSalt();
    expect(hashUid("user-1", salt)).toBe(hashUid("user-1", salt));
  });

  it("does not leak the raw uid", () => {
    const salt = newCustomerSalt();
    expect(hashUid("bob@example.com", salt)).not.toContain("bob");
  });
});

describe("webhook signatures", () => {
  const secret = "shh";
  const body = JSON.stringify({ event: "tier.assigned" });
  const ts = 1_800_000_000;
  const now = () => ts * 1000;

  it("accepts a good signature", () => {
    const sig = signPayload(body, secret, ts);
    expect(verifySignature(body, secret, ts, sig, { now })).toEqual({ ok: true });
  });

  it("rejects a tampered body", () => {
    const sig = signPayload(body, secret, ts);
    const result = verifySignature(`${body} `, secret, ts, sig, { now });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a replayed timestamp outside the window", () => {
    const old = ts - 10_000;
    const sig = signPayload(body, secret, old);
    expect(verifySignature(body, secret, old, sig, { now })).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a malformed signature without comparing", () => {
    expect(verifySignature(body, secret, ts, "nope", { now })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
