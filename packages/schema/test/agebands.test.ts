import { describe, expect, it } from "vitest";
import { ageGapMultiplier, bandGap, isAdultBand, isMinorBand, sameBand } from "../src/index.js";

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
