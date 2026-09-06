import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAccusatory } from "@guardian/schema";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const {
  buildReportDraft,
  derivedIncident,
  incidentSourceLine,
  INCIDENT_TYPE_NOTES,
  NCMEC_INCIDENT_TYPES,
  ReportDraft,
} = await import("@/components/case");
const { getCase, getTimeline } = await import("@/lib/data/cases");
const { mockSession } = await import("@/lib/auth");
const { resetMockData } = await import("@/lib/mock/fixtures");

beforeEach(() => {
  resetMockData();
});

/**
 * ROADMAP P-11. NCMEC takes one incidentType per report and routes on it. Three
 * of the eight are reachable from Guardian's signals; the other five are
 * reachable only because a person can choose them, which is what this adds.
 */
describe("derivedIncident", () => {
  it("derives a type from the recorded signals and names what drove it", async () => {
    const session = mockSession();
    const detail = await getCase(session, "pair_4f2a");
    const timeline = await getTimeline(session, "pair_4f2a");
    const choice = derivedIncident(detail!, timeline);

    expect(NCMEC_INCIDENT_TYPES).toContain(choice.incidentType);
    expect(choice.source).toBe("signals");
    expect(choice.drivenBy.length).toBeGreaterThan(0);
    expect(incidentSourceLine(choice)).toMatch(/derived from the recorded signals/);
  });

  it("says a fallback is a fallback rather than passing it off as a finding", () => {
    expect(incidentSourceLine({ incidentType: NCMEC_INCIDENT_TYPES[6], source: "default", drivenBy: [] })).toMatch(
      /fallback/,
    );
    expect(incidentSourceLine({ incidentType: NCMEC_INCIDENT_TYPES[6], source: "reviewer", drivenBy: [] })).toBe(
      "chosen by the reviewer",
    );
  });

  it("has a note for every one of the eight, and none of them describes a person", () => {
    for (const type of NCMEC_INCIDENT_TYPES) {
      const note = INCIDENT_TYPE_NOTES[type];
      expect(note).toBeTruthy();
      expect(isAccusatory(note)).toBe(false);
    }
  });
});

describe("the drafted report's incident type", () => {
  it("prints the type and where it came from", async () => {
    const session = mockSession();
    const detail = await getCase(session, "pair_4f2a");
    const timeline = await getTimeline(session, "pair_4f2a");

    const derived = buildReportDraft({
      detail: detail!,
      timeline,
      reviewerName: "A. Rivera",
      jurisdiction: "US TX",
      generatedAt: new Date("2026-09-04T09:14:00Z"),
    });
    expect(derived).toContain("Incident type");
    expect(derived).toContain("derived from the recorded signals");

    const chosen = buildReportDraft({
      detail: detail!,
      timeline,
      reviewerName: "A. Rivera",
      jurisdiction: "US TX",
      generatedAt: new Date("2026-09-04T09:14:00Z"),
      incident: { incidentType: "Child Sex Trafficking", source: "reviewer", drivenBy: [] },
    });
    expect(chosen).toContain("Child Sex Trafficking");
    expect(chosen).toContain("chosen by the reviewer");
  });
});

describe("the incident type control", () => {
  const base = {
    pairId: "pair_4f2a",
    draft: "ORIGINAL DRAFT",
    derivedIncidentType: "Online Enticement of Children for Sexual Acts" as const,
    incidentTypeDerived: true,
    readiness: {
      gaps: [],
      blockingCount: 0,
      readyToFile: true,
    },
    accounts: { actorUid: "a".repeat(64), targetUid: "b".repeat(64) },
    actorBandLabel: "21 and over",
    targetBandLabel: "13 to 15",
    reportedSubjectUid: "a".repeat(64),
    onExport: async () => ({ ok: true }),
    onDesignateSubject: async () => ({ draft: "REDESIGNATED DRAFT" }),
  };

  it("offers all eight types and rebuilds the draft on the server when one is chosen", async () => {
    const redraft = vi.fn(async () => ({ draft: "REBUILT DRAFT" }));
    render(<ReportDraft {...base} onIncidentType={redraft} />);

    const select = screen.getByLabelText("Incident type on this report") as HTMLSelectElement;
    expect(select.options).toHaveLength(8);
    expect(select.value).toBe(base.derivedIncidentType);

    fireEvent.change(select, { target: { value: "Child Sex Trafficking" } });
    await waitFor(() => {
      expect(redraft).toHaveBeenCalledWith("pair_4f2a", "Child Sex Trafficking");
    });
    expect((screen.getByLabelText("Drafted report text") as HTMLTextAreaElement).value).toBe(
      "REBUILT DRAFT",
    );
    expect(screen.getByText(/Chosen by you/)).toBeTruthy();
  });

  /**
   * The failure that matters: the select moved and the text did not. Filing
   * that text would file under the derived type while the reviewer believes
   * they chose another, so the component says so rather than looking fine.
   */
  it("says the text and the selection disagree when the rebuild fails", async () => {
    render(
      <ReportDraft
        {...base}
        onIncidentType={async () => {
          throw new Error("network");
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Incident type on this report"), {
      target: { value: "Child Sex Tourism" },
    });
    await waitFor(() => {
      expect(screen.getByText(/could not be rebuilt under that incident type/)).toBeTruthy();
    });
    expect((screen.getByLabelText("Drafted report text") as HTMLTextAreaElement).value).toBe(
      "ORIGINAL DRAFT",
    );
  });

  it("calls a fallback a fallback and asks for a choice before filing", () => {
    render(<ReportDraft {...base} incidentTypeDerived={false} onIncidentType={async () => ({ draft: "" })} />);
    expect(screen.getByText(/has nothing behind it/)).toBeTruthy();
  });
});
