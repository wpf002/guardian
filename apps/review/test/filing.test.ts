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

    // The fixture customer has set a country and a time zone and nothing else,
    // which is the ordinary state. A name and a contact help; neither blocks.
    expect(bySeverity.get("Your organization's name isn't set")).toBe("degrading");
    expect(bySeverity.get("There's no contact person")).toBe("degrading");

    // The time zone is set on this customer, so it is not a gap.
    expect(bySeverity.has("Your time zone isn't set")).toBe(false);

    // A Discord server owner files at NCMEC's public form, which needs no
    // registration and no counsel-settled legal basis (docs/V1.md section 4).
    // Neither gap is listed, because nobody on a Discord server can close it.
    expect([...bySeverity.keys()].some((what) => /ESP|legal basis/i.test(what))).toBe(false);

    // And the one thing that does block: nobody has read the messages yet.
    expect(bySeverity.get("Nobody has read the messages")).toBe("blocking");
    expect(result.readyToFile).toBe(false);
  });

  it("blocks on a jurisdiction nobody set, because that is the number NCMEC publishes", async () => {
    const result = await readiness("pair_4f2a", { jurisdictionCountry: null });
    const gap = result.gaps.find((g) => g.what === "Your country isn't set");
    expect(gap?.severity).toBe("blocking");
    expect(result.readyToFile).toBe(false);
    expect(filingHeadline(result)).toMatch(/to fix before you send this/);
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
    expect(result.gaps.some((g) => g.what === "The kind of report isn't picked")).toBe(true);
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
    expect(result.gaps.some((g) => g.what === "Nobody has read the messages")).toBe(true);
  });

  it("blocks when the excerpts are already gone under the retention rule", async () => {
    const result = await readiness("pair_3c88");
    expect(result.gaps.some((g) => g.what === "The messages were deleted")).toBe(true);
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

/**
 * CLAUDE.md rule 5 on the phase-1 path. The drafted bundle is what a Discord
 * owner actually files at the public form, and it used to print "Hashed actor
 * id" and label one account "Older-band account" with nobody having decided
 * anything. NCMEC displays the reported account as the suspect, and the actor
 * is whichever side the detectors scored.
 *
 * ROADMAP S4 is why that is not a technicality: the fan-out and threat
 * detectors fire on accounts in a minor band on purpose, because people who do
 * this were disproportionately victims themselves. The account Guardian scored
 * is sometimes the child.
 */
describe("who the drafted report is about", () => {
  it("blocks a filing until somebody says", async () => {
    const result = await readiness("pair_4f2a");
    const gap = result.gaps.find(
      (g) => g.what === "No account is picked",
    );
    expect(gap?.severity).toBe("blocking");
    expect(gap?.gather).toMatch(/sometimes the child/);
  });

  it("prints both accounts neutrally and names neither, until one is designated", async () => {
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

    expect(draft).toContain("First account");
    expect(draft).toContain("Second account");
    expect(draft).toContain("WHO THIS REPORT IS ABOUT: not yet decided");
    expect(draft).toMatch(/Guardian does not decide it/);
    // The old wording named one side. Neither label may come back.
    expect(draft).not.toContain("Hashed actor id");
    expect(draft).not.toContain("Older-band account");
    // Both ids are present, so a filer can tell the two apart.
    expect(draft).toContain(detail!.accounts.actorUid);
    expect(draft).toContain(detail!.accounts.targetUid);
  });

  it("marks the designated account, and says the filer named it", async () => {
    const session = mockSession();
    const detail = await getCase(session, "pair_4f2a");
    const timeline = await getTimeline(session, "pair_4f2a");

    // The reviewer names the second account, which is what a support-posture
    // case looks like: the account Guardian scored is not the subject.
    const draft = buildReportDraft({
      detail: { ...detail!, reportedSubjectUid: detail!.accounts.targetUid },
      timeline,
      reviewerName: "A. Rivera",
      jurisdiction: "US TX",
      generatedAt: new Date("2026-09-04T09:14:00Z"),
    });

    expect(draft).toContain("Second account (you named this one)");
    expect(draft).not.toContain("First account (you named this one)");
    expect(draft).toContain("You designated it; Guardian did not");
  });

  it("stops blocking once an account is designated", async () => {
    const session = mockSession();
    const detail = await getCase(session, "pair_4f2a");
    const timeline = await getTimeline(session, "pair_4f2a");
    const settings = await getCustomerSettings(session);
    const result = filingReadiness({
      detail: { ...detail!, reportedSubjectUid: detail!.accounts.actorUid },
      timeline,
      settings,
      incident: { incidentType: ENTICEMENT, source: "signals", drivenBy: ["threat_template"] },
    });
    expect(
      result.gaps.some((g) => g.what === "No account is picked"),
    ).toBe(false);
  });
});
