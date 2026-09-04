import { describe, expect, it } from "vitest";
import { isAccusatory } from "@guardian/schema";
import { buildReport } from "../src/builder.js";
import { scoreReportCompleteness } from "../src/completeness.js";
import { MEDIA_HASH, bundle, customer, reviewer, row } from "./fixtures.js";

const full = () => buildReport(bundle(), customer(), reviewer());

describe("jurisdiction determinability", () => {
  it("is true on an IP capture with a timezone-explicit timestamp", () => {
    const result = scoreReportCompleteness(full());
    expect(result.jurisdictionDeterminable).toBe(true);
    expect(result.jurisdictionBasis).toBe("ip_capture_with_timestamp");
  });

  it("catches the report nobody can route, which is the 10 percent case", () => {
    const report = buildReport(
      bundle({ jurisdiction: null }),
      customer({
        reportedAccount: { espIdentifier: "user-88213", ipCaptureEvent: [] },
        victimAccount: { espIdentifier: "user-44190" },
      }),
      reviewer(),
    );
    const result = scoreReportCompleteness(report);

    expect(result.jurisdictionDeterminable).toBe(false);
    expect(result.jurisdictionBasis).toBe("none");
    expect(result.blocking.map((m) => m.field)).toContain(
      "personOrUserReported.ipCaptureEvent",
    );
    expect(result.gatherList.join(" ")).toMatch(/IP capture|country code/);
    expect(result.readyToFile).toBe(false);
  });

  it("does not accept the provider's own jurisdiction as a determination", () => {
    const report = buildReport(
      bundle(),
      customer({
        reportedAccount: { espIdentifier: "user-88213", ipCaptureEvent: [] },
      }),
      reviewer(),
    );
    const result = scoreReportCompleteness(report);
    expect(result.jurisdictionBasis).toBe("provider_jurisdiction_only");
    expect(result.jurisdictionDeterminable).toBe(false);
  });

  it("falls back to an estimated location when there is no IP", () => {
    const report = buildReport(
      bundle(),
      customer({
        reportedAccount: {
          espIdentifier: "user-88213",
          ipCaptureEvent: [],
          estimatedLocation: { city: "Austin", region: "TX", countryCode: "US" },
        },
      }),
      reviewer(),
    );
    const result = scoreReportCompleteness(report);
    expect(result.jurisdictionBasis).toBe("estimated_location");
    expect(result.jurisdictionDeterminable).toBe(true);
  });

  it("flags an IP with no timestamp, because an unresolvable IP is not a location", () => {
    const report = buildReport(
      bundle(),
      customer({
        reportedAccount: {
          espIdentifier: "user-88213",
          ipCaptureEvent: [
            { ipAddress: "203.0.113.24", eventName: "Login", dateTime: "2026-08-01T12:15:00-05:00" },
            { ipAddress: "203.0.113.99", eventName: "Login" },
          ],
        },
      }),
      reviewer(),
    );
    expect(scoreReportCompleteness(report).missing.map((m) => m.field)).toContain(
      "ipCaptureEvent.dateTime",
    );
  });
});

describe("the other things NCMEC and Stanford call out", () => {
  it("treats a salted hash as no identifier at all", () => {
    const report = buildReport(bundle(), customer({ reportedAccount: undefined }), reviewer());
    const result = scoreReportCompleteness(report);
    const finding = result.blocking.find((m) => m.field === "personOrUserReported.espIdentifier");
    expect(finding).toBeDefined();
    expect(finding!.why).toMatch(/salted hash/);
  });

  it("blocks a report nobody read", () => {
    const b = bundle({
      timeline: bundle().timeline.map((r) => ({ ...r, viewedByHuman: false })),
    });
    const result = scoreReportCompleteness(buildReport(b, customer(), reviewer()));
    expect(result.blocking.map((m) => m.field)).toContain("guardian.excerptsViewedByHuman");
  });

  it("blocks a hash-only report with no excerpts", () => {
    const b = bundle({
      timeline: [
        row("2026-08-01T10:00:00.000Z", "target_to_actor", null, {
          mediaSha256: MEDIA_HASH,
          knownCsamVerdict: "match",
        }),
      ],
    });
    const result = scoreReportCompleteness(buildReport(b, customer(), reviewer()));
    expect(result.blocking.map((m) => m.field)).toContain("excerpts");
  });

  it("flags a truncated excerpt window, which NCMEC names as a top complaint", () => {
    const b = bundle({
      timeline: [
        row("2026-08-01T10:00:00.000Z", "actor_to_target", "one"),
        row("2026-08-01T10:01:00.000Z", "actor_to_target", "two"),
      ],
    });
    const result = scoreReportCompleteness(buildReport(b, customer(), reviewer()));
    expect(result.missing.some((m) => m.field === "excerpts" && m.severity === "degrading")).toBe(
      true,
    );
  });

  it("flags a missing reviewer note, the field investigators most want", () => {
    const d = reviewer({ notes: { timeline: "x", outsideContext: "y", recommendation: null } });
    const report = buildReport(bundle({ reviewer: d }), customer(), d);
    expect(scoreReportCompleteness(report).missing.map((m) => m.field)).toContain(
      "guardian.reviewerContext",
    );
  });

  it("flags a media hash with no scanner verdict beside it", () => {
    const b = bundle({
      timeline: [
        ...bundle().timeline,
        row("2026-08-01T13:00:00.000Z", "target_to_actor", null, {
          mediaSha256: MEDIA_HASH,
          knownCsamVerdict: "not_run",
        }),
      ],
    });
    const result = scoreReportCompleteness(buildReport(b, customer(), reviewer()));
    expect(result.missing.map((m) => m.field)).toContain("mediaHashes[0].operatorVerdict");
  });

  it("blocks a report with no way to reach the reporting provider", () => {
    const report = buildReport(
      bundle(),
      customer({ reportingPerson: { firstName: "Dana", lastName: "Okafor" } }),
      reviewer(),
    );
    expect(scoreReportCompleteness(report).blocking.map((m) => m.field)).toContain(
      "reporter.reportingPerson.email",
    );
  });
});

describe("the score itself", () => {
  it("scores the complete report higher than the unroutable one", () => {
    const good = scoreReportCompleteness(full()).score;
    const bad = scoreReportCompleteness(
      buildReport(
        bundle({ jurisdiction: null }),
        customer({ reportedAccount: { ipCaptureEvent: [] }, victimAccount: {} }),
        reviewer(),
      ),
    ).score;
    expect(good).toBeGreaterThan(bad);
    expect(bad).toBeLessThan(60);
  });

  it("stays inside 0 to 100", () => {
    const result = scoreReportCompleteness(
      buildReport(
        bundle({ jurisdiction: null, auditHead: "" }),
        customer({
          reportingPerson: {},
          reportedAccount: { ipCaptureEvent: [] },
          victimAccount: {},
        }),
        reviewer({ notes: null, concurringReviewerId: null }),
      ),
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("names fields and gaps, never a person", () => {
    for (const finding of scoreReportCompleteness(full()).missing) {
      expect(isAccusatory(finding.why)).toBe(false);
      expect(isAccusatory(finding.gather)).toBe(false);
    }
  });

  it("caps the gather list so a reviewer gets a list, not a wall", () => {
    const result = scoreReportCompleteness(
      buildReport(
        bundle({ jurisdiction: null }),
        customer({ reportingPerson: {}, reportedAccount: { ipCaptureEvent: [] }, victimAccount: {} }),
        reviewer({ notes: null, concurringReviewerId: null }),
      ),
    );
    expect(result.gatherList.length).toBeLessThanOrEqual(6);
  });
});
