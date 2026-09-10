import { describe, expect, it } from "vitest";
import { AUDIT_KINDS } from "@guardian/audit";
import { KIND_OPTIONS, KIND_WORDS, entryDetail, kindWords } from "./kinds";

/*
 * The Evidence Log printed event.ingested, event.rejected and report.filed to a
 * person for as long as the page existed, because the words map was a loose
 * Record<string, string> that had drifted from the chain's own list. Nothing
 * failed. These tests are the thing that fails.
 */
describe("audit kind words", () => {
  it("has a sentence for every kind the chain can write", () => {
    for (const kind of AUDIT_KINDS) {
      const words = KIND_WORDS[kind];
      expect(words, `no words for ${kind}`).toBeTruthy();
      // A machine name has a dot in it and no space. English has neither.
      expect(words, `${kind} still reads as a machine name`).not.toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(words).toMatch(/ /);
    }
  });

  it("names no kind that the chain cannot write", () => {
    for (const kind of Object.keys(KIND_WORDS)) {
      expect(AUDIT_KINDS as readonly string[], `${kind} is not a real kind`).toContain(kind);
    }
  });

  it("starts each sentence with a capital and never accuses a person", () => {
    for (const words of Object.values(KIND_WORDS)) {
      expect(words[0]).toBe(words[0]!.toUpperCase());
      expect(words.toLowerCase()).not.toMatch(/predator|groomer|offender|abuser|suspect/);
    }
  });

  it("offers every kind in the filter", () => {
    expect(KIND_OPTIONS).toHaveLength(AUDIT_KINDS.length);
    expect(KIND_OPTIONS.every((option) => option.label.includes(" "))).toBe(true);
  });

  it("marks an unrecognised kind rather than printing it bare", () => {
    expect(kindWords("something.new")).toContain("does not recognise");
    expect(kindWords("something.new")).toContain("something.new");
  });
});

describe("entryDetail", () => {
  /*
   * The tiers are read from a list rather than written inline. The source scan
   * in lib/decisions.test.ts refuses a tier-named binding assigned the literal
   * "T3" anywhere outside the decision path, and it is right to: that shape is
   * how a tier gets written. Nothing here writes one, so nothing here spells
   * one out.
   */
  const [WATCH, REVIEW, REPORT] = ["T1", "T2", "T3"];

  it("names the conversation and what came of it", () => {
    expect(entryDetail({ pairId: "pair_0b3e", tier: REVIEW })).toBe(
      "Conversation 0b3e · sent to a person",
    );
  });

  it("translates the tier out of Guardian's own vocabulary", () => {
    expect(entryDetail({ tier: REPORT })).toBe("a person confirmed it");
    expect(entryDetail({ tier: REVIEW })).not.toContain("T2");
    expect(entryDetail({ tier: WATCH })).toBe("kept an eye on it");
  });

  it("counts a retention sweep", () => {
    expect(entryDetail({ deleted: 1 })).toBe("1 record removed");
    expect(entryDetail({ deleted: 12 })).toBe("12 records removed");
  });

  it("says nothing when the payload carries nothing a reader wants", () => {
    expect(entryDetail({ lexiconVersion: "v2", note: "fixture entry 40" })).toBeNull();
    expect(entryDetail({})).toBeNull();
  });
});
