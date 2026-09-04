import { describe, expect, it } from "vitest";
import {
  MediaBytesInText,
  assertNoMediaBytesInText,
  findMediaBytesInText,
  hasMediaBytesInText,
  looksLikeMediaBytes,
} from "../src/media-text.js";

/**
 * The edge scans customer-submitted events. This scans everything else: the
 * reviewer notes typed into the console and the customer-supplied strings the
 * report builder assembles, neither of which ever crosses the edge.
 */
describe("media bytes in free text", () => {
  const DATA_URI = `data:image/png;base64,${"A".repeat(64)}`;

  it("catches a data URI that is the whole value", () => {
    expect(looksLikeMediaBytes(DATA_URI)).toBe(true);
    expect(findMediaBytesInText({ note: DATA_URI })[0]?.reason).toBe("data_uri");
  });

  it("catches one pasted into the middle of a sentence", () => {
    // Anchoring is right for a field whose whole value is the URI and wrong for
    // a note, which is where this scanner runs.
    expect(hasMediaBytesInText({ note: `here is the file ${DATA_URI} have a look` })).toBe(true);
  });

  it("catches a long base64 run in any field at any depth", () => {
    const found = findMediaBytesInText({ a: { b: [{ c: "Q".repeat(600) }] } });
    expect(found[0]?.reason).toBe("base64_run");
    expect(found[0]?.at).toBe("a.b[0].c");
  });

  it("leaves ordinary prose alone, including prose about media", () => {
    expect(
      hasMediaBytesInText({
        note: "The account sent an image; the operator's scanner returned no_match on the sha256.",
        hash: "a".repeat(64),
        url: "https://example.test/data:image-explainer",
      }),
    ).toBe(false);
  });

  /**
   * The Python SDK had this exact bug: an id-keyed cycle guard let CPython
   * reuse a freed dict's address, so a sibling was skipped unscanned. Holding
   * live references is what makes the two SDKs agree, and this walk uses the
   * same approach.
   */
  it("scans every sibling rather than skipping one that looks like another", () => {
    const found = findMediaBytesInText({ a: { note: "clean" }, b: { note: DATA_URI } });
    expect(found.map((f) => f.at)).toEqual(["b.note"]);
  });

  it("terminates on a self-referential structure", () => {
    const cyclic: Record<string, unknown> = { note: "clean" };
    cyclic.self = cyclic;
    expect(hasMediaBytesInText(cyclic)).toBe(false);
  });

  it("throws with the path named, rather than stripping", () => {
    try {
      assertNoMediaBytesInText({ notes: { recommendation: DATA_URI } }, "recordDecision");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaBytesInText);
      expect((error as Error).message).toContain("notes.recommendation");
      expect((error as Error).message).toContain("rule 1");
    }
  });
});
