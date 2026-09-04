import { describe, expect, it } from "vitest";
import {
  AGE_BANDS,
  STATUTORY_BRACKETS,
  ageGapMultiplier,
  bandGap,
  crossesStatutoryBracket,
  isAdultBand,
  isMinorBand,
  sameBand,
  statutoryBracket,
} from "../src/index.js";

describe("age bands", () => {
  it("classifies minor and adult bands", () => {
    expect(isMinorBand("A9_12")).toBe(true);
    expect(isMinorBand("A16_17")).toBe(true);
    expect(isMinorBand("A18_20")).toBe(false);
    expect(isAdultBand("A21_PLUS")).toBe(true);
    expect(isAdultBand("UNKNOWN")).toBe(false);
  });

  it("returns null gap when a band is unknown rather than a silent zero", () => {
    expect(bandGap("UNKNOWN", "A9_12")).toBeNull();
    expect(bandGap("A21_PLUS", "A9_12")).toBe(4);
  });

  it("does not inflate same band teen traffic", () => {
    expect(sameBand("A13_15", "A13_15")).toBe(true);
    expect(ageGapMultiplier("A13_15", "A13_15")).toBeLessThan(1);
  });

  it("weights an adult talking to a young child highest", () => {
    const adultToChild = ageGapMultiplier("A21_PLUS", "A9_12");
    const adultToTeen = ageGapMultiplier("A21_PLUS", "A16_17");
    const teenToTeen = ageGapMultiplier("A13_15", "A13_15");
    expect(adultToChild).toBeGreaterThan(adultToTeen);
    expect(adultToTeen).toBeGreaterThan(teenToTeen);
  });

  it("discounts pairs where the target is not a minor", () => {
    expect(ageGapMultiplier("A21_PLUS", "A21_PLUS")).toBeLessThan(1);
  });
});

describe("statutory brackets", () => {
  it("maps each band into one of the four brackets", () => {
    expect(statutoryBracket("UNDER_9")).toBe("UNDER_13");
    expect(statutoryBracket("A9_12")).toBe("UNDER_13");
    expect(statutoryBracket("A13_15")).toBe("AGE_13_15");
    expect(statutoryBracket("A16_17")).toBe("AGE_16_17");
    expect(statutoryBracket("A18_20")).toBe("AGE_18_PLUS");
    expect(statutoryBracket("A21_PLUS")).toBe("AGE_18_PLUS");
  });

  it("keeps every band inside exactly one bracket, so nothing straddles a cut", () => {
    for (const band of AGE_BANDS) {
      const bracket = statutoryBracket(band);
      expect(STATUTORY_BRACKETS).toContain(bracket);
    }
    // One bracket per band is guaranteed by the Record type. What this line
    // catches is the other direction: a bracket no band can reach, which means
    // the bracket list and the band scheme have drifted apart.
    expect(new Set(AGE_BANDS.map(statutoryBracket)).size).toBe(STATUTORY_BRACKETS.length);
  });

  it("carries unknown through rather than guessing an adult bracket", () => {
    expect(statutoryBracket("UNKNOWN")).toBe("UNKNOWN");
    expect(crossesStatutoryBracket("UNKNOWN", "A9_12")).toBe(false);
    expect(crossesStatutoryBracket("A13_15", "UNKNOWN")).toBe(false);
  });

  it("reads an adult to under-13 pair as crossing and a same bracket pair as not", () => {
    expect(crossesStatutoryBracket("A21_PLUS", "A9_12")).toBe(true);
    expect(crossesStatutoryBracket("A18_20", "A21_PLUS")).toBe(false);
    expect(crossesStatutoryBracket("UNDER_9", "A9_12")).toBe(false);
    expect(crossesStatutoryBracket("A13_15", "A16_17")).toBe(true);
  });
});
