import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { EspClient, type EspClientOptions, type EspCredentials } from "./client.js";

/**
 * Per-customer NCMEC credentials, sealed at rest.
 *
 * NCMEC issues CyberTipline credentials to an electronic service provider, not
 * to Guardian. Guardian files as the provider's agent, which means it holds
 * somebody else's credentials, for as many somebodies as it has customers. The
 * environment-variable pair the client falls back to is one customer per
 * deployment and cannot be anything else.
 *
 * The shape here is a sealed blob on the customer row plus a deployment key
 * that never goes near the database. Three properties are deliberate:
 *
 * - The customer id is authenticated data, so a blob copied onto another
 *   customer's row does not open. A stolen row is not a usable credential
 *   without the key, and a misfiled row is not a usable credential at all.
 * - The key id travels with the blob, so a rotation reads as a rotation
 *   ("sealed with key 3f2a, this deployment holds 91c7") rather than as an
 *   authentication failure that looks like corruption.
 * - Nothing here logs, returns or stringifies a plaintext credential. The
 *   error paths name the customer and the key id and stop.
 */

/** Sealed form. Stored as one string in Customer.ncmecCredentialCiphertext. */
const SEAL_VERSION = "gcv1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export class CredentialError extends Error {
  constructor(
    readonly code:
      | "no_key"
      | "bad_key"
      | "key_mismatch"
      | "not_sealed"
      | "malformed"
      | "cannot_open"
      | "customer_mismatch",
    message: string,
  ) {
    super(message);
    this.name = "CredentialError";
  }
}

/**
 * The deployment key. Hex or base64, 32 bytes either way. Read from the
 * environment rather than a file so it can be a platform secret, and validated
 * on the way in so a short or mistyped key fails at startup rather than at the
 * first report.
 */
export function credentialKey(
  env: Record<string, string | undefined> = process.env,
): Buffer {
  const raw = env.NCMEC_CREDENTIAL_KEY;
  if (!raw) {
    throw new CredentialError(
      "no_key",
      "NCMEC_CREDENTIAL_KEY is not set. It seals each customer's own CyberTipline credentials at rest, and without it Guardian cannot open any of them.",
    );
  }
  const decoded = /^[0-9a-fA-F]+$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (decoded.length !== KEY_BYTES) {
    throw new CredentialError(
      "bad_key",
      `NCMEC_CREDENTIAL_KEY must decode to ${KEY_BYTES} bytes, got ${decoded.length}.`,
    );
  }
  return decoded;
}

/** Short, stable name for a key. Not a secret: it is a prefix of a digest. */
export function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export interface SealedCredential {
  /** Goes in Customer.ncmecCredentialCiphertext. */
  ciphertext: string;
  /** Goes in Customer.ncmecCredentialKeyId. */
  keyId: string;
}

/**
 * Seal a customer's credentials. The customer id is authenticated but not
 * encrypted: it is already the row's own key, and binding it is what stops a
 * blob being moved between rows.
 */
export function sealCredentials(
  customerId: string,
  credentials: EspCredentials,
  key: Buffer,
): SealedCredential {
  if (!customerId) throw new CredentialError("customer_mismatch", "customerId is required to seal.");
  if (!credentials.username || !credentials.password) {
    throw new CredentialError("malformed", "Both a username and a password are required.");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${SEAL_VERSION}:${customerId}`, "utf8"));
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ u: credentials.username, p: credentials.password }), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: [
      SEAL_VERSION,
      iv.toString("base64url"),
      body.toString("base64url"),
      tag.toString("base64url"),
    ].join("."),
    keyId: keyId(key),
  };
}

/** The customer columns this reads. Kept structural so no generated type leaks. */
export interface SealedCredentialRow {
  id: string;
  ncmecCredentialCiphertext?: string | null;
  ncmecCredentialKeyId?: string | null;
}

/**
 * Open a customer's credentials. Refuses on a key the row was not sealed with,
 * before attempting to decrypt, so the operator is told which key is missing
 * rather than being handed a generic authentication failure.
 */
export function openCredentials(row: SealedCredentialRow, key: Buffer): EspCredentials {
  const sealed = row.ncmecCredentialCiphertext ?? null;
  if (sealed === null) {
    throw new CredentialError(
      "not_sealed",
      `Customer ${row.id} has no CyberTipline credentials on file. A report for them is drafted, not submitted.`,
    );
  }
  const held = keyId(key);
  const sealedWith = row.ncmecCredentialKeyId ?? null;
  if (sealedWith !== null && !constantTimeEquals(sealedWith, held)) {
    throw new CredentialError(
      "key_mismatch",
      `Customer ${row.id}'s credentials were sealed with key ${sealedWith}; this deployment holds ${held}. Re-seal them under the current key.`,
    );
  }

  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== SEAL_VERSION) {
    throw new CredentialError("malformed", `Customer ${row.id}'s sealed credential is not ${SEAL_VERSION}.`);
  }
  const [, ivPart, bodyPart, tagPart] = parts as [string, string, string, string];

  let plaintext: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAAD(Buffer.from(`${SEAL_VERSION}:${row.id}`, "utf8"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(bodyPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // The tag covers the customer id, so this is either the wrong key, a
    // tampered row, or a blob that belongs to a different customer. The
    // message says all three rather than guessing between them.
    throw new CredentialError(
      "cannot_open",
      `Customer ${row.id}'s sealed credential did not authenticate. Either the key is wrong, the row was altered, or the blob belongs to another customer.`,
    );
  }

  const parsed = JSON.parse(plaintext) as { u?: unknown; p?: unknown };
  if (typeof parsed.u !== "string" || typeof parsed.p !== "string") {
    throw new CredentialError("malformed", `Customer ${row.id}'s sealed credential decoded to the wrong shape.`);
  }
  return { username: parsed.u, password: parsed.p };
}

/** True when the customer can file through their own credentials. */
export function hasSealedCredentials(row: SealedCredentialRow): boolean {
  return (row.ncmecCredentialCiphertext ?? null) !== null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Build a client that files as one customer, using that customer's own
 * credentials. This is the path a multi-customer deployment takes; the
 * environment-variable fallback inside EspClient stays for the single-customer
 * case and for local development.
 *
 * The client is constructed with the customer id, so its own refusal on a
 * report belonging to somebody else still applies. Two checks, one on the
 * sealed blob and one on the report, and the blob is checked first because the
 * cheaper refusal is the one that never decrypts anything.
 */
export function espClientForCustomer(
  row: SealedCredentialRow,
  options: Omit<EspClientOptions, "credentials" | "customerId"> = {},
  env: Record<string, string | undefined> = process.env,
): EspClient {
  const credentials = openCredentials(row, credentialKey(env));
  return new EspClient({ ...options, credentials, customerId: row.id }, env);
}
