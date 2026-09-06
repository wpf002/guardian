import { beforeEach, describe, expect, it } from "vitest";
import { isAccusatory } from "@guardian/schema";

const { buildReportDraft, filingHeadline, filingReadiness } = await import("@/components/case");
const { getCase, getTimeline } = await import("@/lib/data/cases");
const { getCustomerSettings } = await import("@/lib/data/settings");
const { mockSession } = await import("@/lib/auth");
const { resetMockData } = await import("@/lib/mock/fixtures");

const ENTICEMENT = "Online Enticement of Children for Sexual Acts" as const;

beforeEach(() => {
  resetMockData();
});

async function readiness(pairId: string, overrides: Record<string, unknown> = {}) {
  const session = mockSession();
  const detail = await getCase(session, pairId);
  const timeline = await getTimeline(session, pairId);
  const settings = await getCustomerSettings(session);
  return filingReadiness({
    detail: detail!,
    timeline,
    settings: settings ? { ...settings, ...overrides } : null,
    incident: { incidentType: ENTICEMENT, source: "signals", drivenBy: ["threat_template"] },
  });
}

/**
 * ROADMAP P-6. The console shows the report side: what a recipient needs to
 * route and act on the filing. The bundle's own completeness score travels with
 * the bundle, and two scores on one card would only make a reviewer pick.
 */
describe("filingReadiness", () => {
  it("ranks the operator's own gaps by what they cost the filing", async () => {
    const result = await readiness("pair_4f2a");
    const bySeverity = new Map(result.gaps.map((gap) => [gap.what, gap.severity]));

    // The fixture customer has done the local setup and none of the NCMEC
    // registration, which is the ordinary state. Registration is missing, so
    // the report is drafted for the public form rather than blocked.
    expect(bySeverity.get("No provider name as registered with NCMEC")).toBe("degrading");
    expect(bySeverity.get("No named point of contact")).toBe("degrading");
    expect(bySeverity.get("No ESP identifier")).toBe("enriching");

    // The timezone is set on this customer, so it is not a gap.
    expect(bySeverity.has("No timezone on the customer record")).toBe(false);

    // And the one thing that does block: nobody has read the excerpts yet.
    expect(bySeverity.get("No excerpt has been read by a person")).toBe("blocking");
    expect(result.readyToFile).toBe(false);
  });

  it("blocks on a jurisdiction nobody set, because that is the number NCMEC publishes", async () => {
    const result = await readiness("pair_4f2a", { jurisdictionCountry: null });
    const gap = result.gaps.find((g) => g.what === "No jurisdiction on the customer record");
    expect(gap?.severity).toBe("blocking");
    expect(result.readyToFile).toBe(false);
    expect(filingHeadline(result)).toMatch(/has to be fixed|have to be fixed/);
  });

  it("blocks on a fallback incident type", async () => {
    const session = mockSession();
    const detail = await getCase(session, "pair_4f2a");
    const timeline = await getTimeline(session, "pair_4f2a");
    const settings = await getCustomerSettings(session);
    const result = filingReadiness({
      detail: detail!,
      timeline,
      settings,
      incident: { incidentType: ENTICEMENT, source: "default", drivenBy: [] },
    });
    expect(result.gaps.some((g) => g.what === "The incident type is a fallback")).toBe(true);
    expect(result.blockingCount).toBeGreaterThan(0);
  });

  /**
   * Rule 6 and the private-search claim both rest on a person having read the
   * material, so a report from a case nobody opened is not filable.
   */
  it("blocks when no excerpt has been read by a person", async () => {
    const session = mockSession();
    const detail = await getCase(session, "pair_4f2a");
    const timeline = await getTimeline(session, "pair_4f2a");
    const settings = await getCustomerSettings(session);
    const result = filingReadiness({
      detail: { ...detail!, humanViewedAt: null },
      timeline,
      settings,
      incident: { incidentType: ENTICEMENT, source: "signals", drivenBy: ["threat_template"] },
    });
    expect(result.gaps.some((g) => g.what === "No excerpt has been read by a person")).toBe(true);
  });

  it("blocks when the excerpts are already gone under the retention rule", async () => {
    const result = await readiness("pair_3c88");
    expect(result.gaps.some((g) => g.what === "No excerpts to attach")).toBe(true);
  });

  it("reads an unreadable settings row as nothing on file rather than as fine", async () => {
    const session = mockSession();
    const detail = await getCase(session, "pair_4f2a");
    const timeline = await getTimeline(session, "pair_4f2a");
    const result = filingReadiness({
      detail: detail!,
      timeline,
      settings: null,
      incident: { incidentType: ENTICEMENT, source: "signals", drivenBy: ["threat_template"] },
    });
    expect(result.blockingCount).toBeGreaterThan(0);
    expect(result.readyToFile).toBe(false);
  });

  it("says nothing about a person in any gap or headline", async () => {
    for (const pairId of ["pair_4f2a", "pair_3c88"]) {
      const result = await readiness(pairId);
      expect(isAccusatory(filingHeadline(result))).toBe(false);
      for (const gap of result.gaps) {
        expect(isAccusatory(`${gap.what}. ${gap.gather}`)).toBe(false);
      }
    }
  });
});

/**
 * ROADMAP P-9. The kernel has carried channelVisibility since the compliance
 * provenance work and nothing read it. It is on the timeline and on the filing
 * now, because a line said in an open channel and the same line said in a DM
 * are different facts, and Regulation (EU) 2026/1881 treats them differently.
 */
describe("channel visibility", () => {
  it("reaches the console timeline", async () => {
    const timeline = await getTimeline(mockSession(), "pair_4f2a");
    expect(timeline.state).toBe("ready");
    if (timeline.state !== "ready") return;
    for (const row of timeline.rows) {
      expect(["public", "private", "group", null]).toContain(row.channelVisibility);
    }
  });

  it("is on every excerpt in the filing, and says so when it was not stated", async () => {
    const session = mockSession();
    const detail = await getCase(session, "pair_4f2a");
    const timeline = await getTimeline(session, "pair_4f2a");
    const draft = buildReportDraft({
      detail: detail!,
      timeline,
      reviewerName: "A. Rivera",
      jurisdiction: "US TX",
      generatedAt: new Date("2026-09-04T09:14:00Z"),
    });
    expect(draft).toContain("public channel");

    if (timeline.state !== "ready") return;
    const unstated = {
      ...timeline,
      rows: timeline.rows.map((row) => ({ ...row, channelVisibility: null })),
    };
    const withoutIt = buildReportDraft({
      detail: detail!,
      timeline: unstated,
      reviewerName: "A. Rivera",
      jurisdiction: "US TX",
      generatedAt: new Date("2026-09-04T09:14:00Z"),
    });
    expect(withoutIt).toContain("channel visibility not stated");
  });
});
