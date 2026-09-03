import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Customer user ids are salted-hashed per customer (CLAUDE.md rule 8). Two
 * customers who both have a user "bob" produce different hashes, so nothing
 * joins across customers without the customer's own key.
 */

export function newCustomerSalt(): string {
  return randomBytes(32).toString("hex");
}

export function hashUid(uid: string, customerSalt: string): string {
  return createHmac("sha256", Buffer.from(customerSalt, "hex")).update(uid).digest("hex");
}

export function hashUidOrNull(uid: string | null | undefined, customerSalt: string): string | null {
  if (uid === null || uid === undefined || uid === "") return null;
  return hashUid(uid, customerSalt);
}

/** Device and IP hints are hashed the same way before they are stored. */
export function hashHint(value: string, customerSalt: string): string {
  return hashUid(`hint:${value}`, customerSalt);
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** HMAC signature for webhooks in both directions. */
export function signPayload(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export interface VerifyOptions {
  toleranceSeconds?: number;
  now?: () => number;
}

/**
 * Constant-time signature check with a replay window. Returns a reason rather
 * than throwing, because the caller logs the reason as a customer-side fault.
 */
export function verifySignature(
  body: string,
  secret: string,
  timestamp: number,
  signature: string,
  opts: VerifyOptions = {},
): { ok: true } | { ok: false; reason: "stale" | "bad_signature" | "malformed" } {
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = (opts.now ?? Date.now)() / 1000;

  if (!Number.isFinite(timestamp)) return { ok: false, reason: "malformed" };
  if (Math.abs(now - timestamp) > tolerance) return { ok: false, reason: "stale" };
  if (!/^[a-f0-9]{64}$/i.test(signature)) return { ok: false, reason: "malformed" };

  const expected = Buffer.from(signPayload(body, secret, timestamp), "hex");
  const given = Buffer.from(signature.toLowerCase(), "hex");
  if (expected.length !== given.length) return { ok: false, reason: "bad_signature" };
  return timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: "bad_signature" };
}
