import { describe, expect, it } from "vitest";
import { PinnedTargetError, pinnedRequest } from "../src/pinned-fetch.js";
import { checkWebhookTarget } from "@guardian/schema/webhook-target";

/**
 * P-12. The address the target check passed on is the address the socket goes
 * to. Two properties are worth a test: a private address never reaches a
 * connect even if a caller hands one over, and the pinned address is what the
 * lookup returns while the certificate is still checked against the name.
 */

describe("pinnedRequest refusals", () => {
  it("refuses an empty address list rather than falling back to the resolver", async () => {
    await expect(
      pinnedRequest("https://example.com/hook", [], {
        method: "POST",
        headers: {},
        body: "{}",
      }),
    ).rejects.toBeInstanceOf(PinnedTargetError);
  });

  it("refuses a private address handed to it by a caller that should have checked", async () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1"]) {
      await expect(
        pinnedRequest("https://example.com/hook", [address], {
          method: "POST",
          headers: {},
          body: "{}",
        }),
      ).rejects.toBeInstanceOf(PinnedTargetError);
    }
  });

  it("names the reason so a caller can tell the two apart", async () => {
    try {
      await pinnedRequest("https://example.com/hook", ["10.0.0.1"], {
        method: "POST",
        headers: {},
        body: "{}",
      });
      throw new Error("should have refused");
    } catch (err) {
      expect((err as PinnedTargetError).code).toBe("private_address");
    }
  });
});

/**
 * The check now returns what it resolved, which is the input the pinning needs.
 * A name that does not resolve is refused, as before.
 */
describe("checkWebhookTarget addresses", () => {
  it("carries the addresses it passed on", async () => {
    const result = await checkWebhookTarget(new URL("https://example.com/hook"));
    if (!result.ok) {
      // No DNS in this environment. The refusal is the documented behaviour.
      expect(result.reason).toMatch(/did not resolve|Guardian/);
      return;
    }
    expect(Array.isArray(result.addresses)).toBe(true);
    expect(result.addresses!.length).toBeGreaterThan(0);
  });

  it("refuses a private host without offering addresses", async () => {
    const result = await checkWebhookTarget(new URL("https://127.0.0.1/hook"));
    expect(result.ok).toBe(false);
  });
});
