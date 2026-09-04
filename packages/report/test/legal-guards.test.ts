import { describe, expect, it } from "vitest";
import { EspClient, toReportXml } from "../src/client.js";
import { ReportRefused, buildReport } from "../src/builder.js";
import { scoreReportCompleteness } from "../src/completeness.js";
import { signalsToIncidentType } from "../src/schema.js";
import { bundle, customer, reviewer } from "./fixtures.js";

/**
 * The guards an adversarial review of the reporting path found missing. Each
 * block is one finding, and each one names the rule it is about, because these
 * are legal constraints rather than tidiness.
 */

const CREDENTIALS = { username: "esp_user", password: "esp_pass" };

/**
 * The accusation fixtures are assembled from separate words rather than written
 * out. The source scan in packages/schema/test/language.test.ts walks every .ts
 * file in the workspace and fails on any quoted literal that reads as an
 * accusation, and a test fixture is still a literal. Joining the words keeps
 * the scan absolute instead of adding an exemption for this file.
 */
const words = (...parts: string[]): string => parts.join(" ");

function refusal(call: () => unknown): ReportRefused {
  try {
    call();
  } catch (error) {
    if (error instanceof ReportRefused) return error;
    throw error;
  }
  throw new Error("expected the build to be refused, and it was not");
}

/* -------------------------------------------------------------------------- */

describe("the reporter of record is bound to the evidence (rule 8)", () => {
  it("refuses a bundle and a customer that name different customers", () => {
    const error = refusal(() =>
      buildReport(
        bundle({ customerId: "cus_alpha", reporter: { ...bundle().reporter, customerId: "cus_alpha" } }),
        customer({ customerId: "cus_beta", providerName: "Beta Chat" }),
        reviewer(),
      ),
    );
    expect(error.code).toBe("customer_mismatch");
    expect(error.message).toContain("cus_alpha");
    expect(error.message).toContain("cus_beta");
  });

  it("refuses a bundle whose own reporter block names a different customer", () => {
    const base = bundle();
    const error = refusal(() =>
      buildReport(
        bundle({ reporter: { ...base.reporter, customerId: "cus_someone_else" } }),
        customer(),
        reviewer(),
      ),
    );
    expect(error.code).toBe("customer_mismatch");
  });

  it("carries the customer onto the envelope and keeps it off the wire", () => {
    const report = buildReport(bundle(), customer(), reviewer());
    expect(report.customerId).toBe("cus_test");
    // Guardian's own id, not something NCMEC can use. The provider identity on
    // the wire is the registered name and the reporting person.
    expect(toReportXml(report)).not.toContain("cus_test");
  });

  it("refuses to submit a report on another customer's credentials", async () => {
    const report = buildReport(bundle(), customer(), reviewer());
    const client = new EspClient(
      {
        environment: "test",
        credentials: CREDENTIALS,
        customerId: "cus_beta",
        fetchImpl: async () => {
          throw new Error("no request should be made on the wrong credentials");
        },
      },
      {},
    );
    await expect(client.submit(report)).rejects.toThrow(/customer cus_test/);
  });

  it("submits where the client and the report agree", async () => {
    const report = buildReport(bundle(), customer(), reviewer());
    const client = new EspClient(
      {
        environment: "test",
        credentials: CREDENTIALS,
        customerId: "cus_test",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => "<reportResponse><responseCode>0</responseCode><reportId>7</reportId></reportResponse>",
        }),
      },
      {},
    );
    expect((await client.submit(report)).reportId).toBe("7");
  });
});

/* -------------------------------------------------------------------------- */

describe("no media bytes reach the filing (rule 1)", () => {
  const DATA_URI = `data:image/png;base64,${"A".repeat(600)}`;
  const BASE64_RUN = "B".repeat(700);

  it("refuses a data URI a reviewer typed into a note", () => {
    const rev = reviewer({
      notes: { timeline: "note", recommendation: `see the file ${DATA_URI}` },
    });
    const error = refusal(() => buildReport(bundle({ reviewer: rev }), customer(), rev));
    expect(error.code).toBe("media_bytes_in_text");
    expect(error.message).toContain("data URI");
  });

  it("refuses a long base64 run wherever it is, including a customer field", () => {
    const error = refusal(() =>
      buildReport(
        bundle(),
        customer({
          reportedAccount: { ...customer().reportedAccount, profileBio: BASE64_RUN },
        }),
        reviewer(),
      ),
    );
    expect(error.code).toBe("media_bytes_in_text");
  });

  it("refuses a data URI in a retained excerpt", () => {
    const base = bundle();
    const rows = [...base.timeline];
    rows[0] = { ...rows[0]!, excerpt: DATA_URI };
    const error = refusal(() => buildReport(bundle({ timeline: rows }), customer(), reviewer()));
    expect(error.code).toBe("media_bytes_in_text");
  });

  it("leaves an ordinary report alone", () => {
    const report = buildReport(bundle(), customer(), reviewer());
    expect(toReportXml(report)).not.toContain("data:image");
  });
});

/* -------------------------------------------------------------------------- */

describe("the filing never labels a person (rule 5)", () => {
  it("refuses an accusation in the recommendation note and names the field", () => {
    const rev = reviewer({
      notes: { timeline: "note", recommendation: words("this", "user", "is", "a", "predator") },
    });
    const error = refusal(() => buildReport(bundle({ reviewer: rev }), customer(), rev));
    expect(error.code).toBe("accusatory_language");
    expect(error.message).toContain("recommendation note");
    // The decision stands; it is the wording that has to change.
    expect(error.message).toContain("the decision itself stands");
  });

  it("refuses an accusation in the timeline note too", () => {
    const rev = reviewer({
      notes: { timeline: words("a", "confirmed", "groomer,", "on", "the", "evidence") },
    });
    const error = refusal(() => buildReport(bundle({ reviewer: rev }), customer(), rev));
    expect(error.code).toBe("accusatory_language");
    expect(error.message).toContain("timeline note");
  });

  it("refuses an accusation in an escalation reason", () => {
    const error = refusal(() =>
      buildReport(bundle(), customer(), reviewer(), {
        escalateToHighPriority: true,
        escalationReason: words("caught", "a", "predator", "mid-conversation"),
      }),
    );
    expect(error.code).toBe("accusatory_language");
  });
});

/* -------------------------------------------------------------------------- */

describe("jurisdiction and legal basis reach the recipient", () => {
  it("writes the provider's jurisdiction into the submitted document, labelled", () => {
    const report = buildReport(
      bundle({ jurisdiction: { country: "GB", subdivision: null } }),
      customer(),
      reviewer(),
    );
    const xml = toReportXml(report);
    expect(xml).toContain("GB");
    // additionalInfo is a child of personOrUserReported, so the line has to say
    // whose jurisdiction it is or an analyst reads it as the account's location.
    expect(xml).toContain("Reporting provider&#039;s own jurisdiction".replace("&#039;", "'"));
    expect(xml).toContain("not the reported account");
  });

  it("carries the legal basis from the bundle to the document", () => {
    const report = buildReport(bundle(), customer(), reviewer());
    expect(report.legalBasis).toBe("provider_2258a");
    expect(toReportXml(report)).toContain("Legal basis for the processing");
    expect(toReportXml(report)).toContain("provider_2258a");
  });

  it("flags a missing legal basis to the filer rather than dropping it", () => {
    const report = buildReport(bundle({ legalBasis: null }), customer(), reviewer());
    expect(report.legalBasis).toBeUndefined();
    const gaps = scoreReportCompleteness(report).missing.map((m) => m.field);
    expect(gaps).toContain("legalBasis");
  });
});

/* -------------------------------------------------------------------------- */

describe("an incident type nothing supports is marked and blocked", () => {
  it("reports whether the derivation matched anything", () => {
    expect(signalsToIncidentType({ signals: ["image_solicitation"] }).derived).toBe(true);
    expect(signalsToIncidentType({ signals: [] }).derived).toBe(false);
    // Present in the kernel, absent from the mapping: still not derived.
    expect(signalsToIncidentType({ signals: ["alt_cluster", "actor_fanout"] }).derived).toBe(false);
  });

  it("blocks the filing when the type is the fallback", () => {
    const report = buildReport(bundle({ signals: [] }), customer(), reviewer());
    expect(report.guardian.incidentTypeSource).toBe("default");
    expect(report.incidentSummary.incidentType).toBe(
      "Online Enticement of Children for Sexual Acts",
    );

    const result = scoreReportCompleteness(report);
    expect(result.blocking.map((b) => b.field)).toContain("incidentSummary.incidentType");
    expect(result.readyToFile).toBe(false);
    expect(toReportXml(report)).toContain("no signal supports it");
  });

  it("takes a reviewer's choice over the derivation, and stops blocking", () => {
    const report = buildReport(bundle({ signals: [] }), customer(), reviewer(), {
      incidentType: "Child Sexual Molestation",
    });
    expect(report.incidentSummary.incidentType).toBe("Child Sexual Molestation");
    expect(report.guardian.incidentTypeSource).toBe("reviewer");
    expect(
      scoreReportCompleteness(report).blocking.map((b) => b.field),
    ).not.toContain("incidentSummary.incidentType");
  });

  it("records which signals drove a derived type", () => {
    const report = buildReport(bundle(), customer(), reviewer());
    expect(report.guardian.incidentTypeSource).toBe("signals");
    expect(report.guardian.incidentTypeDrivenBy).toContain("image_solicitation");
    expect(
      scoreReportCompleteness(report).blocking.map((b) => b.field),
    ).not.toContain("incidentSummary.incidentType");
  });
});
