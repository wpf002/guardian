import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isAccusatory } from "@guardian/schema";
import type { OpenProposal } from "@/lib/data/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { ConcurrencePanel } = await import("@/components/case/ConcurrencePanel");
const { DecisionPanel } = await import("@/components/case/DecisionPanel");
const { filingReadiness } = await import("@/components/case/filing");

const THEIRS: OpenProposal = {
  reviewId: "rvw_91c7_propose",
  proposerReviewerId: "rev_mo",
  proposerName: "M. Osei",
  reasonLabel: "Online enticement of a child for sexual acts",
  proposedAt: new Date("2026-09-07T09:00:00Z"),
  mine: false,
};

const MINE: OpenProposal = { ...THEIRS, proposerReviewerId: "rev_mock", mine: true };

function renderPanel(proposal: OpenProposal, readCount: number, timelineAvailable = true) {
  const onConcur = vi.fn().mockResolvedValue({
    ok: true,
    summary: "Upheld. Tier T3 is recorded and the excerpts are held for one year.",
    resultTier: "T3",
    state: "upheld",
    auditSeq: 42,
  });
  const onWithdraw = vi.fn().mockResolvedValue({ ok: true, summary: "Withdrawn.", auditSeq: 43 });
  const view = render(
    <ConcurrencePanel
      pairId="pair_91c7"
      proposal={proposal}
      timelineAvailable={timelineAvailable}
      readCount={readCount}
      onConcur={onConcur}
      onWithdraw={onWithdraw}
      leaveHref="/queue"
    />,
  );
  return { ...view, onConcur, onWithdraw };
}

describe("answering a proposal in the console", () => {
  /*
   * The read gate is the whole reason two reviewers are required. Pair
   * humanViewedAt is set by whoever read first and records nobody, so the panel
   * gates on this reviewer's own count and the server re-checks it against
   * their evidence.read entries on the chain.
   */
  it("offers no answer until an excerpt has been rendered to this reviewer", () => {
    renderPanel(THEIRS, 0);
    expect(screen.getByRole("button", { name: /Uphold/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Overturn/ })).toHaveProperty("disabled", true);
    expect(screen.getByText(/No excerpt has been rendered to you yet/)).toBeTruthy();
  });

  it("offers no answer when the timeline did not load", () => {
    renderPanel(THEIRS, 4, false);
    expect(screen.getByRole("button", { name: /Uphold/ })).toHaveProperty("disabled", true);
    expect(screen.getByText(/did not load/)).toBeTruthy();
  });

  it("upholds with an uphold reason, and names the proposal it answers", async () => {
    const { onConcur } = renderPanel(THEIRS, 4);
    fireEvent.click(screen.getByRole("button", { name: /Uphold/ }));

    const option = await screen.findByText("Same reading from the evidence");
    fireEvent.click(option);

    await waitFor(() => expect(onConcur).toHaveBeenCalledTimes(1));
    expect(onConcur.mock.calls[0]![0]).toMatchObject({
      pairId: "pair_91c7",
      proposalReviewId: "rvw_91c7_propose",
      proposerReviewerId: "rev_mo",
      upheld: true,
      reasonCode: "uphold.independent_agreement",
      viewedExcerptCount: 4,
    });
  });

  it("overturns with an overturn reason, and sends upheld false", async () => {
    const { onConcur } = renderPanel(THEIRS, 4);
    fireEvent.click(screen.getByRole("button", { name: /Overturn/ }));

    fireEvent.click(await screen.findByText("The evidence does not carry it"));

    await waitFor(() => expect(onConcur).toHaveBeenCalledTimes(1));
    expect(onConcur.mock.calls[0]![0]).toMatchObject({
      upheld: false,
      reasonCode: "overturn.evidence_does_not_support",
    });
  });

  it("never offers a propose reason to the second reviewer", async () => {
    renderPanel(THEIRS, 4);
    fireEvent.click(screen.getByRole("button", { name: /Uphold/ }));
    await screen.findByText("Same reading from the evidence");
    expect(screen.queryByText("Online enticement of a child for sexual acts", { selector: "span" }))
      .toBeNull();
    expect(screen.queryByText("Child sex trafficking")).toBeNull();
  });

  /*
   * The proposer gets no uphold and no overturn. The server refuses both, and
   * offering a control that always fails is worse than not offering it.
   */
  it("offers the proposer a withdrawal and nothing else", async () => {
    const { onWithdraw } = renderPanel(MINE, 4);
    expect(screen.queryByRole("button", { name: /Uphold/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Overturn/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Withdraw the proposal" }));
    await waitFor(() => expect(onWithdraw).toHaveBeenCalledTimes(1));
    expect(onWithdraw.mock.calls[0]![0]).toEqual({
      pairId: "pair_91c7",
      proposalReviewId: "rvw_91c7_propose",
    });
  });

  it("keeps what was typed when the write is refused", async () => {
    const onConcur = vi.fn().mockResolvedValue({ ok: false, error: "That proposal is no longer open." });
    render(
      <ConcurrencePanel
        pairId="pair_91c7"
        proposal={THEIRS}
        timelineAvailable
        readCount={4}
        onConcur={onConcur}
        onWithdraw={vi.fn()}
        leaveHref="/queue"
      />,
    );
    const note = screen.getByLabelText(/What in the timeline led you there/);
    fireEvent.change(note, { target: { value: "The migration ask lands nine minutes in." } });
    fireEvent.click(screen.getByRole("button", { name: /Uphold/ }));
    fireEvent.click(await screen.findByText("Same reading from the evidence"));

    await waitFor(() => expect(screen.getByText("That proposal is no longer open.")).toBeTruthy());
    expect((note as HTMLTextAreaElement).value).toBe(
      "The migration ask lands nine minutes in.",
    );
  });

  it("writes nothing about a person on either side of the panel", () => {
    const { container, unmount } = renderPanel(THEIRS, 4);
    expect(isAccusatory(container.textContent ?? "")).toBe(false);
    unmount();
    const second = renderPanel(MINE, 4);
    expect(isAccusatory(second.container.textContent ?? "")).toBe(false);
  });
});

/*
 * ROADMAP D-3, decided: a partition with one reviewer seat ends at the drafted
 * bundle and the operator files it themselves on the CyberTipline public form.
 *
 * A T3 needs two people and a 40-person server has one moderator, which is the
 * segment this product is for. The wrong answer is to leave Propose T3 live and
 * let them find out after they have made a proposal nobody can ever answer.
 */
describe("a partition with one reviewer seat", () => {
  function renderDecision(secondSeat: boolean) {
    return render(
      <DecisionPanel
        pairId="pair_4f2a"
        modelTier="T2"
        secondSeat={secondSeat}
        soleAutomatedBasis={false}
        timelineAvailable
        readCount={4}
        totalExcerpts={8}
        missing={[]}
        openedAt={Date.now()}
        onSubmit={vi.fn()}
        onUndo={vi.fn()}
        leaveHref="/queue"
      />,
    );
  }

  it("blocks the proposal and names the drafted bundle as the path", () => {
    renderDecision(false);
    expect(screen.getByRole("button", { name: /Propose T3/ })).toHaveProperty("disabled", true);
    expect(screen.getByText(/one reviewer seat, so a proposal here cannot be upheld/)).toBeTruthy();
    expect(screen.getByText(/the T3 path ends here/)).toBeTruthy();
    // Confirm still works. A one-seat operator can still record a T2.
    expect(screen.getByRole("button", { name: /Confirm T2/ })).toHaveProperty("disabled", false);
  });

  it("leaves the proposal live where there is a second seat", () => {
    renderDecision(true);
    expect(screen.getByRole("button", { name: /Propose T3/ })).toHaveProperty("disabled", false);
    expect(screen.queryByText(/the T3 path ends here/)).toBeNull();
  });

  it("says nothing about a person on either branch", () => {
    const { container, unmount } = renderDecision(false);
    expect(isAccusatory(container.textContent ?? "")).toBe(false);
    unmount();
    expect(isAccusatory(renderDecision(true).container.textContent ?? "")).toBe(false);
  });

  /*
   * The filing readiness card is the other place the operator reads it, and it
   * has to say the same thing: telling a one-seat operator to have a second
   * reviewer uphold it names a person who does not exist.
   */
  it("tells the filing card the same thing", () => {
    const detail = {
      reviewerConfirmedT3: false,
      reportedSubjectUid: "abc",
      queue: { criticalSignals: [] },
    } as never;
    const input = {
      detail,
      timeline: { state: "ready", rows: [], messageCount: 0, collapsedThirdParty: 0 },
      settings: { jurisdictionCountry: "US" },
      incident: { incidentType: "online_enticement", source: "signals" },
    } as never;

    const one = filingReadiness({ ...(input as object), secondSeat: false } as never);
    const two = filingReadiness({ ...(input as object), secondSeat: true } as never);
    const gapOf = (r: { gaps: Array<{ what: string; gather: string }> }) =>
      r.gaps.find((g) => g.what.includes("tier T3"))!.gather;

    expect(gapOf(one)).toMatch(/one reviewer seat/);
    expect(gapOf(one)).toMatch(/file it yourself/);
    expect(gapOf(two)).toMatch(/a second reviewer has to uphold it/);
  });
});
