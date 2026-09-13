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
  it("says what happened, who was in it and how far it went, above the conversation", async () => {
    const { container } = await renderCase("pair_4f2a");

    // The heading is what happened. No pair id anywhere.
    expect(screen.getByRole("heading", {
        level: 1,
        name: "Asked whether anyone checks these messages, then asked to move to Snapchat",
      })).toBeTruthy();
    expect(container.textContent).not.toMatch(/Pair 4f2a/);

    // Both accounts and their ages, in words.
    const summary = within(screen.getByRole("region", { name: "What happened" }));
    expect(summary.getByText("ryan_xx99")).toBeTruthy();
    expect(summary.getByText("16 to 17")).toBeTruthy();

    // The conversation names the same account the same way. It used to label
    // the speaker "t", and briefly a hashed id while the summary said ryan_xx99.
    const conversation = within(screen.getByRole("region", { name: "The Conversation" }));
    expect(conversation.getAllByText("ryan_xx99").length).toBeGreaterThan(0);
    expect(screen.getByText(/asked whether anyone checks the younger one's phone/)).toBeTruthy();

    // How far it went, as steps a person would name.
    const steps = within(screen.getByRole("list", { name: "What has happened so far" }));
    expect(steps.getByText("Asked whether anyone is watching")).toBeTruthy();

    // The conversation, with names instead of speaker tags, and an image in words.
    expect(screen.getByRole("heading", { name: "The Conversation" })).toBeTruthy();
    expect(screen.getByText("Guardian never keeps images.")).toBeTruthy();

    // The four choices.
    for (const word of ["Not a Concern", "Keep an Eye on It", "This Is a Concern", "Report It"]) {
      expect(screen.getByRole("button", { name: new RegExp(word) })).toBeTruthy();
    }
  });

  /*
   * Seven panels sat above the conversation: a severity strip with the tier code
   * and confidence figures, a fusion-weight chart, the lexicon entries that
   * fired, a stage ladder with elapsed hours, account statistics with a salted
   * hash, the tier policy, and a version triple. All of it is still recorded.
   */
  it("prints none of the scoring internals", async () => {
    const { container } = await renderCase("pair_4f2a");
    const text = container.textContent ?? "";
    for (const internal of [/model rules-v2/, /fusion/i, /confidence 0\.\d/, /Fan-out/, /Show the Weights/, /lexicon v2/, /T[0-3]\b/]) {
      expect(text).not.toMatch(internal);
    }
  });

  it("blocks confirm and propose until an excerpt has been rendered, then unblocks on a reveal", async () => {
    await renderCase("pair_4f2a");

    expect(screen.getAllByText("Read the conversation above first.")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /This Is a Concern/ })).toHaveProperty("disabled", true);

    // Showing a hidden message is the write path for "a person read this".
    fireEvent.click(screen.getByRole("button", { name: "Show a threat" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /This Is a Concern/ })).toHaveProperty("disabled", false);
    });
    expect(screen.queryByText("Read the conversation above first.")).toBeNull();
  });

  it("refuses to propose a report where the tier rests on the actor score alone", async () => {
    await renderCase("pair_3c88");

    expect(screen.getByText(/It's here because of what the older account did in other conversations/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Report It/ })).toHaveProperty("disabled", true);
  });

  it("shows the retention outcome rather than an error when the excerpts are gone", async () => {
    await renderCase("pair_3c88");
    expect(screen.getByText("These messages were deleted on schedule.")).toBeTruthy();
  });

  it("gives a resolved case the reopen path, and refuses it once a report was confirmed", async () => {
    await renderCase("pair_c5e1");
    expect(screen.getByRole("heading", { name: "Decided" })).toBeTruthy();
    expect(screen.getByText("This was reported, so it can't be reopened here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });

  /*
   * ROADMAP 2c. A relayed player has no age, and the strip has to say so rather
   * than print "unknown, unknown, no confidence published" beside a tier, which
   * reads as three fields of evidence.
   */
  it("says plainly when Guardian has no age for either account", async () => {
    const { resetMockData, getMockData } = await import("@/lib/mock/fixtures");
    resetMockData();
    const data = await getMockData();
    const pair = data.pairs.find((p) => p.queue.pairId === "pair_4f2a")!;
    pair.queue.actorBand = { band: "UNKNOWN", confidence: null, provenance: "unknown" };
    pair.queue.targetBand = { band: "UNKNOWN", confidence: null, provenance: "unknown" };

    const { container } = await renderCase("pair_4f2a");
    expect(container.textContent).toContain("Guardian doesn't know how old either account is");
    expect(container.textContent).toContain("age played no part in this");
    expect(container.textContent).not.toContain("no confidence published");
  });

  /*
   * ROADMAP 2b.3. "They replied to the child" and "they were the only two
   * people in the channel" are different sentences to put in front of somebody
   * about to propose a federal report, and adjacency can be wrong in a way a
   * reply cannot: two people posting in a quiet channel are not necessarily
   * talking to each other.
   */
  it("says a reply was a reply", async () => {
    const { container } = await renderCase("pair_4f2a");
    expect(container.textContent).toContain("They were replying to each other.");
  });

  it("warns when the pair was inferred from who else was in the channel", async () => {
    const { resetMockData, getMockData } = await import("@/lib/mock/fixtures");
    resetMockData();
    const data = await getMockData();
    data.pairs.find((p) => p.queue.pairId === "pair_4f2a")!.queue.targetSource = "adjacency";

    const { container } = await renderCase("pair_4f2a");
    expect(container.textContent).toContain("because nobody else was talking in the channel");
    expect(container.textContent).toContain("read the messages to check it's really one conversation");
  });

  it("says so when nothing recorded how the pair was made", async () => {
    const { resetMockData, getMockData } = await import("@/lib/mock/fixtures");
    resetMockData();
    const data = await getMockData();
    data.pairs.find((p) => p.queue.pairId === "pair_4f2a")!.queue.targetSource = null;

    const { container } = await renderCase("pair_4f2a");
    expect(container.textContent).toContain("Guardian didn't record how it knew these two were talking.");
  });

  it("makes a case claimed by somebody else read only", async () => {
    await renderCase("pair_0b3e");
    expect(
      screen.getByRole("heading", { name: "Someone else is looking at this" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Your decision" })).toBeNull();
  });

  /*
   * A proposal outranks a claim.
   *
   * 91c7 is claimed by M. Osei and proposed for report by M. Osei. Once they
   * have proposed, they are finished with the case and it is waiting on
   * somebody else, so the claim is the stale fact. Answering it is not taking
   * it from them, and a read-only view here would leave the T3 unreachable.
   */
  it("offers the concurrence on a claimed case that carries an open proposal", async () => {
    await renderCase("pair_91c7");
    expect(screen.getByRole("heading", { name: "Do you agree this should be reported?" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Someone else is looking at this" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your decision" })).toBeNull();
  });

  it("opens the report dialog, and holds the send until each step is done", async () => {
    await renderCase("pair_4f2a");
    fireEvent.click(screen.getByRole("button", { name: "Show a threat" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Report It/ })).toHaveProperty("disabled", false);
    });

    fireEvent.click(screen.getByRole("button", { name: /Report It/ }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Nothing is reported until someone else on your team reads this and agrees."),
    ).toBeTruthy();
    expect(within(dialog).getByText("Don't message either account about this.")).toBeTruthy();
    // NCMEC's own page says to call 911 for immediate danger. This used to say
    // a report "does not go to the police".
    expect(within(dialog).getByText(/If a child is in danger right now, call 911/)).toBeTruthy();
    expect(within(dialog).queryByText(/does not go to the police/)).toBeNull();

    expect(within(dialog).getByRole("button", { name: /Ask a Teammate to Agree/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(within(dialog).getByText(/Say what in the conversation made you decide/)).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Show a threat" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /This Is a Concern/ })).toHaveProperty("disabled", false);
    });

    fireEvent.change(screen.getByLabelText(/What in the conversation made you decide/), {
      target: { value: "Asked who checks the phone, then asked to move to Snapchat." },
    });
    fireEvent.click(screen.getByRole("button", { name: /This Is a Concern/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save Decision" }));

    const recorded = await screen.findByRole("region", { name: "Decision recorded" });
    expect(document.activeElement).toBe(recorded);
    expect(document.getElementById("guardian-live-region")?.textContent).toMatch(
      /You can undo this for the next 60 seconds/,
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
    fireEvent.click(screen.getByRole("button", { name: /Not a Concern/ }));

    const filter = screen.getByRole("combobox", { name: "Search the reasons" });
    expect(filter.getAttribute("aria-expanded")).toBe("true");
    expect(filter.getAttribute("aria-haspopup")).toBe("listbox");
    expect(filter.getAttribute("aria-controls")).toBe("reasons-dismiss");
    expect(screen.getByRole("listbox").id).toBe("reasons-dismiss");
    expect(filter.getAttribute("aria-activedescendant")).toMatch(/^reasons-dismiss-/);
  });

  /**
   * Rule 6. The draft is built from a reviewer-confirmed T3 and nothing else.
   * pair_4f2a sits at T2, which the model assigned by itself, so it gets no
   * draft: drafting there would have been Guardian preparing a federal report
   * from a tier no person decided.
   */
  it("drafts nothing on a case the model tiered and nobody decided", async () => {
    await renderCase("pair_4f2a");
    expect(
      screen.queryByRole("heading", { name: "Your Report" }),
    ).toBeNull();
  });

  it("gives an owner a report that they send themselves", async () => {
    await renderCase("pair_c5e1");
    expect(screen.getByRole("heading", { name: "Your Report" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open NCMEC's Report Form" });
    expect(link.getAttribute("href")).toBe("https://report.cybertip.org");
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(screen.getByText(/Guardian wrote this report\. You send it yourself/)).toBeTruthy();
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
