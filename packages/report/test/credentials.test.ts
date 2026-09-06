import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CredentialError,
  credentialKey,
  espClientForCustomer,
  hasSealedCredentials,
  keyId,
  openCredentials,
  sealCredentials,
} from "../src/credentials.js";

const KEY = randomBytes(32);
const OTHER = randomBytes(32);
const CREDS = { username: "esp-user", password: "esp-pass" };

function row(customerId: string, key = KEY) {
  const sealed = sealCredentials(customerId, CREDS, key);
  return {
    id: customerId,
    ncmecCredentialCiphertext: sealed.ciphertext,
    ncmecCredentialKeyId: sealed.keyId,
  };
}

describe("the deployment key", () => {
  it("reads hex and base64, and refuses anything that is not 32 bytes", () => {
    expect(credentialKey({ NCMEC_CREDENTIAL_KEY: KEY.toString("hex") })).toEqual(KEY);
    expect(credentialKey({ NCMEC_CREDENTIAL_KEY: KEY.toString("base64") })).toEqual(KEY);
    expect(() => credentialKey({ NCMEC_CREDENTIAL_KEY: "abcd" })).toThrow(/32 bytes/);
    expect(() => credentialKey({})).toThrow(/NCMEC_CREDENTIAL_KEY is not set/);
  });
});

describe("sealing", () => {
  it("round trips, and puts neither the username nor the password in the blob", () => {
    const sealed = sealCredentials("cus_1", CREDS, KEY);
    expect(sealed.ciphertext).not.toContain("esp-user");
    expect(sealed.ciphertext).not.toContain("esp-pass");
    expect(sealed.keyId).toBe(keyId(KEY));
    expect(
      openCredentials({ id: "cus_1", ncmecCredentialCiphertext: sealed.ciphertext, ncmecCredentialKeyId: sealed.keyId }, KEY),
    ).toEqual(CREDS);
  });

  it("seals the same credentials to different bytes each time", () => {
    const a = sealCredentials("cus_1", CREDS, KEY).ciphertext;
    const b = sealCredentials("cus_1", CREDS, KEY).ciphertext;
    expect(a).not.toBe(b);
  });
});

describe("refusals", () => {
  /**
   * The point of authenticating the customer id. Two customers share a
   * database, and a row copied from one to the other must not become a working
   * credential for the customer it was copied to.
   */
  it("refuses a blob that was sealed for a different customer", () => {
    const stolen = row("cus_1");
    expect(() => openCredentials({ ...stolen, id: "cus_2" }, KEY)).toThrow(CredentialError);
    try {
      openCredentials({ ...stolen, id: "cus_2" }, KEY);
    } catch (err) {
      expect((err as CredentialError).code).toBe("cannot_open");
    }
  });

  it("names the key a row was sealed with rather than reporting corruption", () => {
    const sealed = row("cus_1");
    try {
      openCredentials(sealed, OTHER);
      throw new Error("should have refused");
    } catch (err) {
      expect((err as CredentialError).code).toBe("key_mismatch");
      expect((err as CredentialError).message).toContain(keyId(KEY));
      expect((err as CredentialError).message).toContain(keyId(OTHER));
    }
  });

  it("refuses a tampered blob sealed with the key it claims", () => {
    const sealed = row("cus_1");
    const parts = sealed.ncmecCredentialCiphertext.split(".");
    parts[2] = Buffer.from("rewritten payload").toString("base64url");
    const tampered = { ...sealed, ncmecCredentialCiphertext: parts.join(".") };
    try {
      openCredentials(tampered, KEY);
      throw new Error("should have refused");
    } catch (err) {
      expect((err as CredentialError).code).toBe("cannot_open");
    }
  });

  it("says a customer with nothing on file is drafted rather than submitted", () => {
    expect(hasSealedCredentials({ id: "cus_1" })).toBe(false);
    try {
      openCredentials({ id: "cus_1" }, KEY);
      throw new Error("should have refused");
    } catch (err) {
      expect((err as CredentialError).code).toBe("not_sealed");
      expect((err as CredentialError).message).toMatch(/drafted, not submitted/);
    }
  });

  it("refuses a blob that is not this seal version", () => {
    try {
      openCredentials({ id: "cus_1", ncmecCredentialCiphertext: "gcv9.a.b.c" }, KEY);
      throw new Error("should have refused");
    } catch (err) {
      expect((err as CredentialError).code).toBe("malformed");
    }
  });
});

describe("espClientForCustomer", () => {
  it("builds a client bound to that customer, in test mode by default", () => {
    const client = espClientForCustomer(
      row("cus_1"),
      { fetchImpl: async () => new Response("", { status: 200 }) },
      { NCMEC_CREDENTIAL_KEY: KEY.toString("hex") },
    );
    expect(client.customerId).toBe("cus_1");
    expect(client.isProduction).toBe(false);
  });

  it("refuses before constructing a client when the credentials cannot be opened", () => {
    expect(() =>
      espClientForCustomer(row("cus_1"), {}, { NCMEC_CREDENTIAL_KEY: OTHER.toString("hex") }),
    ).toThrow(/sealed with key/);
  });
});
