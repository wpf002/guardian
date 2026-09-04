import { describe, expect, it } from "vitest";
import { isAccusatory } from "@guardian/schema";
import { ReportRefused, buildReport } from "../src/builder.js";
import { signalsToIncidentType } from "../src/schema.js";
import { MEDIA_HASH, bundle, customer, reviewer, row } from "./fixtures.js";

describe("buildReport, rule 6", () => {
  it("refuses to build from a bundle that is not T3", () => {
    for (const tier of ["T0", "T1", "T2"] as const) {
      const call = () => buildReport(bundle({ tier }), customer(), reviewer());
      expect(call).toThrow(ReportRefused);
      try {
        call();
      } catch (error) {
        expect((error as ReportRefused).code).toBe("not_t3");
      }
    }
  });

  it("refuses when the reviewer decision did not itself produce T3", () => {
    const call = () =>
      buildReport(
        bundle({ reviewer: reviewer({ resultTier: "T2" }) }),
        customer(),
        reviewer({ resultTier: "T2" }),
      );
    expect(call).toThrow(/not T3/);
  });

  it("refuses a dismiss or a watch even at T3", () => {
    for (const decision of ["dismiss", "watch"] as const) {
      const d = reviewer({ decision });
      expect(() => buildReport(bundle({ reviewer: d }), customer(), d)).toThrow(
        ReportRefused,
      );
    }
  });

  it("builds from confirm and from report", () => {
    for (const decision of ["confirm", "report"] as const) {
      const d = reviewer({ decision });
      const report = buildReport(bundle({ reviewer: d }), customer(), d);
      expect(report.guardian.tier).toBe("T3");
      expect(report.guardian.decision).toBe(decision);
    }
  });

  it("refuses when the bundle names a different reviewer than the decision", () => {
    const call = () =>
      buildReport(
        bundle({ reviewer: reviewer({ reviewerId: "rev_someone_else" }) }),
        customer(),
        reviewer(),
      );
    expect(call).toThrow(ReportRefused);
    try {
      call();
    } catch (error) {
      expect((error as ReportRefused).code).toBe("reviewer_mismatch");
    }
  });
});

describe("buildReport, rule 1", () => {
  it("refuses when a timeline row carrying media has no sha256", () => {
    const b = bundle({
      timeline: [
        row("2026-08-01T10:00:00.000Z", "actor_to_target", "here"),
        row("2026-08-01T10:05:00.000Z", "target_to_actor", null, {
          mediaSha256: null,
          knownCsamVerdict: "no_match",
        }),
      ],
    });
    const call = () => buildReport(b, customer(), reviewer());
    expect(call).toThrow(ReportRefused);
    try {
      call();
    } catch (error) {
      expect((error as ReportRefused).code).toBe("media_row_without_hash");
      expect((error as ReportRefused).message).toMatch(/hash-only/);
    }
  });

  it("refuses when a row announces media only through its signal and has no hash", () => {
    const b = bundle({
      timeline: [
        row("2026-08-01T10:00:00.000Z", "target_to_actor", null, {
          mediaSha256: null,
          knownCsamVerdict: null,
          signals: ["known_csam_hash"],
        }),
      ],
    });
    const call = () => buildReport(b, customer(), reviewer());
    expect(call).toThrow(ReportRefused);
    try {
      call();
    } catch (error) {
      expect((error as ReportRefused).code).toBe("media_row_without_hash");
    }
  });

  it("carries media as a hash plus the operator verdict, with no attachment path", () => {
    const b = bundle({
      timeline: [
        row("2026-08-01T10:00:00.000Z", "actor_to_target", "send it"),
        row("2026-08-01T10:05:00.000Z", "target_to_actor", null, {
          mediaSha256: MEDIA_HASH,
          knownCsamVerdict: "match",
        }),
      ],
    });
    const report = buildReport(b, customer(), reviewer());

    expect(report.mediaHashes).toHaveLength(1);
    expect(report.mediaHashes[0]!.sha256).toBe(MEDIA_HASH);
    expect(report.mediaHashes[0]!.operatorVerdict).toBe("match");
    expect(report.mediaHashes[0]!.operatorScanner).toBe("PhotoDNA run by the provider");
    // Guardian never opens a file, so this is false unless the operator says so.
    expect(report.mediaHashes[0]!.fileViewedByEsp).toBe(false);
    // No bytes, no attachment, no upload field anywhere in the envelope.
    expect(JSON.stringify(report)).not.toMatch(/"(bytes|attachment|fileContent|upload)"/);
  });

  it("deduplicates a hash that appears on more than one row", () => {
    const b = bundle({
      timeline: [
        row("2026-08-01T10:00:00.000Z", "target_to_actor", null, {
          mediaSha256: MEDIA_HASH,
          knownCsamVerdict: "match",
        }),
        row("2026-08-01T10:30:00.000Z", "actor_to_target", null, {
          mediaSha256: MEDIA_HASH,
          knownCsamVerdict: "match",
        }),
      ],
    });
    expect(buildReport(b, customer(), reviewer()).mediaHashes).toHaveLength(1);
  });

  it("does not treat a text row with no media as a media row", () => {
    expect(() => buildReport(bundle(), customer(), reviewer())).not.toThrow();
    expect(buildReport(bundle(), customer(), reviewer()).mediaHashes).toEqual([]);
  });
});

describe("buildReport, what the report carries", () => {
  const report = buildReport(bundle(), customer(), reviewer());

  it("anchors to the audit chain and the version triple", () => {
    expect(report.guardian.auditHead).toBe("d".repeat(64));
    expect(report.guardian.modelVersion).toBe("kernel-v0");
    expect(report.guardian.lexiconVersion).toBe("v2");
    expect(report.guardian.fusionVersion).toBe("rules-v2");
    expect(report.narrative).toContain("d".repeat(64));
  });

  it("carries the per-excerpt human-viewed flags rather than one flag", () => {
    expect(report.excerpts).toHaveLength(6);
    expect(report.excerpts.every((e) => e.viewedByHuman)).toBe(true);
    expect(report.guardian.excerptsViewedByHuman).toBe(6);
    expect(report.guardian.excerptsTotal).toBe(6);
  });

  it("does not widen a per-row flag the reviewer never set", () => {
    const b = bundle({
      timeline: [
        row("2026-08-01T10:00:00.000Z", "actor_to_target", "one", { viewedByHuman: true }),
        row("2026-08-01T10:01:00.000Z", "actor_to_target", "two", { viewedByHuman: false }),
      ],
    });
    const built = buildReport(b, customer(), reviewer());
    expect(built.excerpts.map((e) => e.viewedByHuman)).toEqual([true, false]);
    expect(built.guardian.excerptsViewedByHuman).toBe(1);
  });

  it("carries both reviewers and the reviewer's contextual note", () => {
    expect(report.guardian.reviewerId).toBe("rev_alice");
    expect(report.guardian.concurringReviewerId).toBe("rev_bob");
    expect(report.guardian.reviewerContext).toMatch(/compression from first contact/);
  });

  it("copies the customer's jurisdiction so it cannot be lost in transit", () => {
    expect(report.jurisdiction).toEqual({ country: "US", subdivision: "TX" });
  });

  it("never reaches production by omission", () => {
    expect(report.environment).toBe("test");
    expect(buildReport(bundle(), customer({ environment: undefined }), reviewer()).environment).toBe(
      "test",
    );
  });

  it("uses ISO 8601 with an explicit offset everywhere", () => {
    expect(report.incidentSummary.incidentDateTime).toMatch(/Z$/);
    expect(report.excerpts.every((e) => /Z$/.test(e.ts))).toBe(true);
  });

  it("writes nothing that characterises a person", () => {
    expect(isAccusatory(report.narrative)).toBe(false);
    expect(isAccusatory(report.incidentSummary.incidentDateTimeDescription ?? "")).toBe(false);
    expect(isAccusatory(report.reporter.filedByAgent)).toBe(false);
  });
});

describe("signalsToIncidentType", () => {
  it("defaults to online enticement", () => {
    expect(signalsToIncidentType({ signals: [] }).incidentType).toBe(
      "Online Enticement of Children for Sexual Acts",
    );
  });

  it("annotates sextortion when a demand follows a solicitation", () => {
    const result = signalsToIncidentType({
      signals: ["image_solicitation", "payment_after_media"],
    });
    expect(result.annotations).toContain("sextortion");
    expect(result.annotations).toContain("csamSolicitation");
  });

  it("does not annotate sextortion on a demand with no solicitation behind it", () => {
    expect(
      signalsToIncidentType({ signals: ["payment_after_media"] }).annotations,
    ).not.toContain("sextortion");
  });

  it("reaches trafficking only on economic bait plus a meetup plan", () => {
    expect(signalsToIncidentType({ signals: ["economic_bait"] }).incidentType).toBe(
      "Online Enticement of Children for Sexual Acts",
    );
    expect(signalsToIncidentType({ signals: ["meetup_logistics"] }).incidentType).toBe(
      "Online Enticement of Children for Sexual Acts",
    );
    expect(
      signalsToIncidentType({ signals: ["economic_bait", "meetup_logistics"] }).incidentType,
    ).toBe("Child Sex Trafficking");
  });

  it("reaches the CSAM type only from the operator's own verdict, never from a signal", () => {
    expect(
      signalsToIncidentType({ signals: ["image_solicitation"], knownCsamVerdicts: ["no_match"] })
        .incidentType,
    ).toBe("Online Enticement of Children for Sexual Acts");
    expect(
      signalsToIncidentType({ signals: ["image_solicitation"], knownCsamVerdicts: ["match"] })
        .incidentType,
    ).toBe("Child Pornography (possession, manufacture, and distribution)");
  });

  it("annotates a minor-to-minor interaction only when both bands are minor", () => {
    expect(signalsToIncidentType({ signals: [], minorToMinor: true }).annotations).toContain(
      "minorToMinorInteraction",
    );
    // An unknown band is not a claim, so the builder does not derive one.
    const b = bundle({
      timeline: [
        row("2026-08-01T10:00:00.000Z", "actor_to_target", "hi", {
          actorAge: { band: "UNKNOWN", confidence: null, provenance: "unknown" },
          targetAge: { band: "UNKNOWN", confidence: null, provenance: "unknown" },
        }),
      ],
    });
    expect(
      buildReport(b, customer(), reviewer()).incidentSummary.reportAnnotations,
    ).not.toContain("minorToMinorInteraction");
  });
});
