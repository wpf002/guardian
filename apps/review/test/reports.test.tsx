import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAccusatory } from "@guardian/schema";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ReportTrail } = await import("@/components/case");
const { getReportRollup, getReportTrail } = await import("@/lib/data/reports");
const { mockSession } = await import("@/lib/auth");
const { resetMockData } = await import("@/lib/mock/fixtures");
const { appendAudit } = await import("@/lib/data/audit");

beforeEach(() => {
  resetMockData();
});

/**
 * The reporting half of the product, from the reporter's side. Guardian cannot
 * supply an NCMEC outcome, because NCMEC publishes none to the reporter. What
 * it can supply is what it holds, and the trail has to say plainly where its
 * knowledge ends rather than leaving a reader to assume somebody is watching.
 */
describe("the report trail", () => {
  it("says nothing has been filed for a case nothing left", async () => {
    const trail = await getReportTrail(mockSession(), "pair_91c7");
    expect(trail.events).toEqual([]);
    expect(trail.headline).toMatch(/Nothing has been filed/);
    expect(trail.ncmecReportId).toBeNull();
    expect(trail.preserveUntil).toBeNull();
  });

  it("reads an export off the chain and says Guardian cannot follow it", async () => {
    // The fixtures already record one export against this pair, which is the
    // state a Discord owner's case is in: the draft left, and there is no
    // further step Guardian can see.
    const trail = await getReportTrail(mockSession(), "pair_4f2a");
    expect(trail.events).toHaveLength(1);
    expect(trail.events[0]!.stage).toBe("draft_exported");
    expect(trail.events[0]!.auditSeq).toBe(16);
    expect(trail.headline).toMatch(/Guardian does not know whether it was filed/);
  });

  it("counts a second export on the same case rather than replacing the first", async () => {
    const session = mockSession();
    await appendAudit(session, {
      kind: "bundle.exported",
      payload: { pairId: "pair_4f2a", method: "download", submittedByGuardian: false },
    });
    const trail = await getReportTrail(session, "pair_4f2a");
    expect(trail.events).toHaveLength(2);
    expect(trail.events.every((e) => e.stage === "draft_exported")).toBe(true);
    // Oldest first: the sequence is the content.
    expect(trail.events[0]!.at.getTime()).toBeLessThanOrEqual(trail.events[1]!.at.getTime());
  });

  it("keeps another case's export out of this case's trail", async () => {
    const session = mockSession();
    const before = await getReportTrail(session, "pair_91c7");
    await appendAudit(session, {
      kind: "bundle.exported",
      payload: { pairId: "pair_3c88", method: "copy" },
    });
    const after = await getReportTrail(session, "pair_91c7");
    expect(after.events).toEqual(before.events);
  });

  it("renders the trail, how long to keep records, and that NCMEC never reports back", () => {
    const { container } = render(
      <ReportTrail
        trail={{
          pairId: "pair_4f2a",
          ncmecReportId: "ncmec-42",
          preserveUntil: new Date("2027-09-04T10:00:00Z"),
          headline: "This case was reported to the CyberTipline.",
          events: [
            {
              stage: "draft_exported",
              at: new Date("2026-09-04T10:00:00Z"),
              what: "An owner took the drafted report out of the console.",
              auditSeq: 12,
            },
            {
              stage: "submitted",
              at: new Date("2026-09-04T11:00:00Z"),
              what: "Submitted to the CyberTipline. NCMEC report ncmec-42.",
              auditSeq: null,
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "This Report" })).toBeTruthy();
    expect(screen.getByText("Submitted to the CyberTipline. NCMEC report ncmec-42.")).toBeTruthy();
    // A date a person reads, not an ISO stamp, and no link to a record number.
    expect(screen.getByText(/Keep your own records of this until/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /chain entry/ })).toBeNull();
    expect(screen.getByText("NCMEC doesn't tell reporters what happens next.")).toBeTruthy();
    expect(isAccusatory(container.textContent ?? "")).toBe(false);
  });
});

describe("the reporting rollup", () => {
  it("counts what left, and nothing about what came of it", async () => {
    const session = mockSession();

    const before = (await getReportRollup(session)).draftsExported;
    await appendAudit(session, {
      kind: "bundle.exported",
      payload: { pairId: "pair_4f2a", method: "download" },
    });

    const rollup = await getReportRollup(session);
    expect(rollup.draftsExported).toBe(before + 1);
    // Nothing counts an outcome, because there is no outcome to count.
    expect(rollup.drafted).toBe(0);
    expect(rollup.submitted).toBe(0);
    expect(rollup.underPreservation).toBe(0);
  });
});
