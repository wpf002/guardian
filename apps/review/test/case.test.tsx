import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The page is a server component that reads through the data layer. Mock mode
// is on in the test setup, so the fixtures answer and nothing opens a database.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: (href: string) => {
    throw new Error(`redirect ${href}`);
  },
}));

const { default: CasePage } = await import("@/app/cases/[id]/page");
const { resetMockData } = await import("@/lib/mock/fixtures");
const { buildReportDraft, buildSignalList } = await import("@/components/case");
const { getCase, getTimeline } = await import("@/lib/data/cases");
const { mockSession } = await import("@/lib/auth");

async function renderCase(id: string) {
  const element = await CasePage({ params: Promise.resolve({ id }) });
  return render(element);
}

beforeEach(() => {
  resetMockData();
});

describe("the case detail at /cases/[id]", () => {
  it("renders the pattern above the fold, the evidence below it, and the version triple", async () => {
    await renderCase("pair_4f2a");

    expect(screen.getByRole("heading", { name: "Pair 4f2a" })).toBeTruthy();
    expect(screen.getAllByText(/asked who supervises the younger account/).length).toBeGreaterThan(0);

    // The tier is a word plus a meaning, and the critical signal is named.
    expect(screen.getByText("critical: threat template")).toBeTruthy();

    // Bands carry provenance and confidence, so a reviewer knows what the gap rests on.
    expect(screen.getByText(/16-17, server role, confidence 0\.42/)).toBeTruthy();

    // The version triple and the chain reference.
    expect(screen.getByText("model rules-v2")).toBeTruthy();
    expect(screen.getAllByText("lexicon v2").length).toBeGreaterThan(0);
    expect(screen.getByText("fusion rules-v2")).toBeTruthy();

    // Actor context is counts and elapsed time, never an adjective.
    expect(screen.getByText("3 accounts, 3 in a younger band")).toBeTruthy();

    // The evidence, and the media row that says there is nothing to open.
    expect(
      screen.getByText("Guardian holds no image and there is nothing here to open."),
    ).toBeTruthy();

    // The four verbs.
    for (const word of ["Dismiss", "Watch", "Confirm T2", "Propose T3"]) {
      expect(screen.getByRole("button", { name: new RegExp(word) })).toBeTruthy();
    }
  });

  it("lists each signal with the lexicon entry that rewrote the token, and gates the weight", async () => {
    await renderCase("pair_4f2a");

    expect(screen.getByText(/matched/)).toBeTruthy();
    expect(screen.getByText("migration.snapchat.emoji")).toBeTruthy();

    const show = screen.getByRole("button", { name: "Show the weights" });
    expect(screen.queryByText(/Fusion term 0\.31/)).toBeNull();
    fireEvent.click(show);
    expect(screen.getByText(/Fusion term 0\.31/)).toBeTruthy();
  });

  it("blocks confirm and propose until an excerpt has been rendered, then unblocks on a reveal", async () => {
    await renderCase("pair_4f2a");

    expect(screen.getByText("0 of 13 excerpts recorded as read by you")).toBeTruthy();
    expect(
      screen.getAllByText("No excerpt has been rendered to you yet. Open one in the timeline first."),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Confirm T2/ })).toHaveProperty("disabled", true);

    // Revealing a collapsed span is the viewedByHuman write path.
    fireEvent.click(screen.getByRole("button", { name: /threat language, 22 words/ }));

    await waitFor(() => {
      expect(screen.getByText("1 of 13 excerpts recorded as read by you")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Confirm T2/ })).toHaveProperty("disabled", false);
    expect(
      screen.queryByText("No excerpt has been rendered to you yet. Open one in the timeline first."),
    ).toBeNull();
  });

  it("refuses to propose a report where the tier rests on the actor score alone", async () => {
    await renderCase("pair_3c88");

    const blocked = screen.getAllByText(
      /This tier rests on the per-actor score alone, with no conversational fact on the pair\. A report cannot be proposed from it\./,
    );
    expect(blocked.length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Propose T3/ })).toHaveProperty("disabled", true);
  });

  it("shows the retention outcome rather than an error when the excerpts are gone", async () => {
    await renderCase("pair_3c88");
    expect(
      screen.getByText("The excerpts for this case were deleted under the retention rule."),
    ).toBeTruthy();
  });

  it("gives a resolved case the reopen path, and refuses it once a report was confirmed", async () => {
    await renderCase("pair_c5e1");
    expect(screen.getByRole("heading", { name: "This case is resolved" })).toBeTruthy();
    expect(
      screen.getByText(/A case that reached a reviewer-confirmed report is not reopened here/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen this case" })).toBeNull();
  });

  it("makes a case claimed by somebody else read only", async () => {
    await renderCase("pair_91c7");
    expect(
      screen.getByRole("heading", { name: "You are reading a case somebody else claimed" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your decision" })).toBeNull();
  });

  it("opens the T3 confirmation with its consequences, and holds the send until each one is met", async () => {
    await renderCase("pair_4f2a");
    fireEvent.click(screen.getByRole("button", { name: /threat language, 22 words/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Propose T3/ })).toHaveProperty("disabled", false);
    });

    fireEvent.click(screen.getByRole("button", { name: /Propose T3/ }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "This proposes a report. It does not create one, and it does not create tier T3.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText(/Only\s+their concurrence writes tier T3/)).toBeTruthy();
    expect(within(dialog).getByText(/one-year preservation under 18 USC 2258A/)).toBeTruthy();
    expect(within(dialog).getByText(/a report is drafted for the operator to file/)).toBeTruthy();
    expect(
      within(dialog).getByText("Do not message either account about this case."),
    ).toBeTruthy();

    expect(within(dialog).getByRole("button", { name: /Send to a second reviewer/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(dialog).getByText(/The timeline note is empty/)).toBeTruthy();
  });

  /**
   * DESIGN-UI 12: after a decision, focus lands on the confirmation region and
   * the next Tab reaches Undo. It never lands on nothing.
   */
  it("lands focus on the confirmation, announces it, and puts Undo first", async () => {
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<div aria-live="polite" id="guardian-live-region"></div>',
    );
    await renderCase("pair_4f2a");

    fireEvent.click(screen.getByRole("button", { name: /threat language, 22 words/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Confirm T2/ })).toHaveProperty("disabled", false);
    });

    fireEvent.change(screen.getByLabelText(/What in the timeline supports this/), {
      target: { value: "Supervision probe, then a migration ask 19 hours later." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Confirm T2/ }));
    fireEvent.click(screen.getByRole("button", { name: "Record this decision" }));

    const recorded = await screen.findByRole("region", { name: "Decision recorded" });
    expect(document.activeElement).toBe(recorded);
    expect(document.getElementById("guardian-live-region")?.textContent).toMatch(
      /You can reverse it for the next 60 seconds/,
    );

    // Undo is reachable, and it is the first control inside the region.
    const buttons = within(recorded).getAllByRole("button");
    expect(buttons[0]?.textContent).toBe("Undo");
  });

  /**
   * The reason list is an aria-activedescendant listbox. Without the combobox
   * role the highlight moves and nothing is spoken, so a reviewer can record a
   * decision under a reason they never heard.
   */
  it("declares the reason filter as a combobox that owns the listbox", async () => {
    await renderCase("pair_4f2a");
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));

    const filter = screen.getByRole("combobox", { name: "Filter reasons" });
    expect(filter.getAttribute("aria-expanded")).toBe("true");
    expect(filter.getAttribute("aria-haspopup")).toBe("listbox");
    expect(filter.getAttribute("aria-controls")).toBe("reasons-dismiss");
    expect(screen.getByRole("listbox").id).toBe("reasons-dismiss");
    expect(filter.getAttribute("aria-activedescendant")).toMatch(/^reasons-dismiss-/);
  });

  /**
   * A term that lowered the tier and a term that raised it must not draw the
   * same bar in the same direction: read by length alone, the negative term
   * looks like the second largest reason the case is here.
   */
  it("draws a negative fusion term as a subtraction, in words and in geometry", async () => {
    const { container } = await renderCase("pair_aa19");

    expect(screen.getByText(/pulled the tier down/)).toBeTruthy();
    expect(screen.getAllByText(/pushed the tier up/).length).toBeGreaterThan(0);

    const fills = Array.from(container.querySelectorAll('[class*="barFill"]'));
    const negative = fills.filter((fill) => fill.className.includes("barNegative"));
    expect(negative.length).toBe(1);
    expect(fills.length).toBeGreaterThan(negative.length);
  });

  it("gives an owner a drafted report that says Guardian submits nothing", async () => {
    await renderCase("pair_4f2a");
    expect(
      screen.getByRole("heading", { name: "Report draft, for filing at the CyberTipline" }),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open report.cybertip.org" });
    expect(link.getAttribute("href")).toBe("https://report.cybertip.org");
    expect(screen.getByRole("button", { name: "Download as .txt" })).toBeTruthy();
    expect(screen.getByText(/Guardian drafts this\. Guardian does not submit it/)).toBeTruthy();
  });
});

describe("the drafted bundle", () => {
  it("carries the completeness statement, the hash and no image path", async () => {
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

    expect(draft).toContain("Guardian has not submitted anything");
    expect(draft).toContain("read by nobody");
    expect(draft).toContain("Guardian holds no image. Only the hash was ever received.");
    expect(draft).toContain("model rules-v2, lexicon v2, fusion rules-v2");
  });
});

describe("buildSignalList", () => {
  it("orders critical signals first and says when no fusion term carries a signal's name", async () => {
    const session = mockSession();
    const detail = await getCase(session, "pair_4f2a");
    const timeline = await getTimeline(session, "pair_4f2a");
    const signals = buildSignalList(detail!, timeline);

    expect(signals[0]?.kind).toBe("threat_template");
    expect(signals[0]?.critical).toBe(true);
    expect(signals.find((s) => s.kind === "supervision_probe")?.weight).toBeNull();
    expect(
      signals.find((s) => s.kind === "off_platform_migration")?.lexicon[0]?.entry,
    ).toBe("migration.snapchat.emoji");
  });
});
