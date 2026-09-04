import { describe, expect, it } from "vitest";
import { checkLiteralHost, isPrivateAddress } from "./webhook-target";

/**
 * The test-delivery button makes Guardian's own container issue a request to an
 * address a customer operator chose. Unguarded, that is a request-forgery
 * primitive pointed at Guardian's private network, and the reply is an oracle
 * for what is listening on it.
 */
describe("what a webhook URL may point at", () => {
  it("refuses loopback, private, link-local and unique-local addresses", () => {
    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "10.0.0.7",
      "172.16.4.4",
      "172.31.255.1",
      "192.168.1.1",
      "169.254.169.254", // the instance metadata endpoint
      "100.64.0.1",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it("allows public unicast space", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1::1"]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  it("refuses the names that only resolve inside a network", () => {
    for (const host of [
      "localhost",
      "vault.internal",
      "printer.local",
      "api.localhost",
      "postgres",
      "127.0.0.1",
      "[::1]",
    ]) {
      expect(checkLiteralHost(host).ok).toBe(false);
    }
  });

  it("allows a public hostname", () => {
    expect(checkLiteralHost("hooks.example.com").ok).toBe(true);
  });

  it("says why in one sentence, without naming what it found", () => {
    const refusal = checkLiteralHost("10.0.0.7");
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) {
      expect(refusal.reason).toMatch(/public https address/);
      expect(refusal.reason).not.toMatch(/10\.0\.0\.7/);
    }
  });
});
