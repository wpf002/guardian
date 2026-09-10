import { describe, expect, it } from "vitest";
import { isAccusatory } from "@guardian/schema";
import { deadLetterReason, hostOf, type DeadLetterRow } from "@/lib/data/deliveries";

function row(overrides: Partial<DeadLetterRow> = {}): DeadLetterRow {
  return {
    id: "wd_1",
    kind: "tier.assigned",
    host: "customer.example",
    tier: "T2",
    attempt: 8,
    lastError: "http_500",
    lastStatusCode: 500,
    createdAt: new Date("2026-09-04T10:00:00Z"),
    updatedAt: new Date("2026-09-04T12:00:00Z"),
    ...overrides,
  };
}

/**
 * The dead-letter view lists a host and never a path or a query. An endpoint
 * url can carry a token in its query string, and this list is read by more
 * people than the settings page that set it.
 */
describe("hostOf", () => {
  it("keeps the host and drops the path, the query and the credentials", () => {
    expect(hostOf("https://customer.example/hooks/guardian?token=secret")).toBe("customer.example");
    expect(hostOf("https://customer.example:8443/x")).toBe("customer.example:8443");
  });

  it("says so rather than throwing on something that is not a url", () => {
    expect(hostOf("not a url")).toBe("unparseable endpoint");
  });
});

describe("deadLetterReason", () => {
  it("translates each stored class into the operator's words", () => {
    expect(deadLetterReason(row({ lastError: "target_refused" }))).toMatch(/private range/);
    expect(deadLetterReason(row({ lastError: "redirected" }))).toMatch(/never followed/);
    expect(deadLetterReason(row({ lastError: "missing_webhook_secret" }))).toMatch(/settings/);
  });

  it("falls through to the status code rather than inventing a cause", () => {
    expect(deadLetterReason(row())).toBe("Gave up after 8 attempts. Last response: HTTP 500.");
    expect(deadLetterReason(row({ lastStatusCode: null, lastError: "ECONNRESET" }))).toBe(
      "Gave up after 8 attempts. Last failure: ECONNRESET.",
    );
    expect(deadLetterReason(row({ lastError: null }))).toMatch(/no error recorded/);
  });

  it("says nothing about a person in any branch", () => {
    for (const error of ["target_refused", "redirected", "missing_webhook_secret", "http_500", null]) {
      expect(isAccusatory(deadLetterReason(row({ lastError: error })))).toBe(false);
    }
  });
});

/*
 * The chain export panel's own tests went with the Reporting page it lived on.
 * Exporting the chain for counsel is still reachable, from the Evidence Log's
 * Check the Record card, and audit.test.tsx covers it there.
 */
