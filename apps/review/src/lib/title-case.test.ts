import { describe, expect, it } from "vitest";
import { isTitleCase, toTitleCase } from "./title-case";

describe("title case", () => {
  it("capitalises major words and keeps minor ones lower case in the middle", () => {
    expect(toTitleCase("keep an eye on it")).toBe("Keep an Eye on It");
    expect(toTitleCase("send alerts to your own system")).toBe("Send Alerts to Your Own System");
    expect(toTitleCase("back to the evidence log")).toBe("Back to the Evidence Log");
  });

  it("capitalises a minor word when it is first or last", () => {
    expect(toTitleCase("to do")).toBe("To Do");
    expect(toTitleCase("what it is for")).toBe("What It Is For");
  });

  it("leaves names, handles and codes as they are", () => {
    expect(isTitleCase("Open #mod-alerts")).toBe(true);
    expect(isTitleCase("Remove @Teens")).toBe(true);
    expect(isTitleCase("Open NCMEC's Report Form")).toBe(true);
  });

  it("flags sentence case", () => {
    expect(isTitleCase("Add phrases")).toBe(false);
    expect(isTitleCase("Save endpoint")).toBe(false);
    expect(isTitleCase("Don't Report")).toBe(true);
  });
});
