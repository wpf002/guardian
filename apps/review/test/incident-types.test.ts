import { describe, expect, it } from "vitest";
import { NCMEC_INCIDENT_TYPES as FROM_PACKAGE } from "@guardian/report";
import {
  INCIDENT_TYPE_NOTES,
  NCMEC_INCIDENT_TYPES as IN_CONSOLE,
} from "@/components/case/incident-types";

/**
 * The console keeps its own copy of the eight wire values, because the selector
 * is a client component and importing them from @guardian/report would pull the
 * lexicon loader, and with it node:fs, into the browser bundle. This is what
 * stops the copy drifting: the values are asserted equal, in order, every run.
 */
describe("the console's copy of the incident types", () => {
  it("is exactly the package's list, in the same order", () => {
    expect([...IN_CONSOLE]).toEqual([...FROM_PACKAGE]);
  });

  it("has a note for each one and no note for anything else", () => {
    expect(Object.keys(INCIDENT_TYPE_NOTES).sort()).toEqual([...IN_CONSOLE].sort());
  });
});
