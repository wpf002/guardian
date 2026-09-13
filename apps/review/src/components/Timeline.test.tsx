import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Timeline } from "./Timeline";
import type { TimelineState } from "@/lib/data/types";

const at = new Date("2026-09-01T14:02:00Z");

const ready: TimelineState = {
  state: "ready",
  messageCount: 3,
  collapsedThirdParty: 0,
  rows: [
    {
      id: "r1",
      at,
      speaker: "t",
      bandLabel: "16-17 band",
      text: "add me on snapchat",
      collapsed: null,
      normalizations: [
        {
          normalized: "snapchat",
          original: "ghost emoji",
          entry: "migration.snapchat.emoji",
          lexiconVersion: "v2",
        },
      ],
      stage: "migrate",
      confidence: 0.77,
      lowConfidence: false,
      signals: ["off_platform_migration"],
      media: null,
      viewedByHuman: false,
      channelVisibility: "public" as const,
      gapHoursBefore: null,
    },
    {
      id: "r2",
      at: new Date(at.getTime() + 3 * 60 * 60 * 1000),
      speaker: "t",
      bandLabel: "16-17 band",
      text: "this is the verbatim excerpt",
      collapsed: { spanClass: "threat", wordCount: 22 },
      normalizations: [],
      stage: "coerce",
      confidence: 0.66,
      lowConfidence: false,
      signals: ["threat_template"],
      media: null,
      viewedByHuman: false,
      channelVisibility: "public" as const,
      gapHoursBefore: 3,
    },
    {
      id: "r3",
      at: new Date(at.getTime() + 4 * 60 * 60 * 1000),
      speaker: "t",
      bandLabel: "16-17 band",
      text: null,
      collapsed: null,
      normalizations: [],
      stage: null,
      confidence: null,
      lowConfidence: false,
      signals: [],
      media: {
        sha256: "9f3c".padEnd(64, "a"),
        direction: "older_to_younger",
        verdict: "no_match",
        viewedByOperatorHuman: false,
      },
      viewedByHuman: false,
      channelVisibility: "public" as const,
      gapHoursBefore: null,
    },
  ],
};

describe("Timeline", () => {
  it("marks up the thread as a list and says what a rewritten word meant", () => {
    render(<Timeline timeline={ready} />);
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getByText('"ghost emoji" means "snapchat"')).toBeTruthy();
  });

  /*
   * The rows were labelled with the ML service's speaker tags, so a message
   * read "t: add me on snapchat", and each carried "stage migrate · 0.77".
   */
  it("names each speaker and says the step in words, with no score", () => {
    const { container } = render(<Timeline timeline={ready} speakerNames={{ t: "jayden_k", s1: "mia_03" }} />);
    expect(screen.getAllByText("jayden_k").length).toBeGreaterThan(0);
    expect(screen.getByText("Asked to move to another app")).toBeTruthy();
    expect(container.textContent).not.toMatch(/0\.77|stage migrate|16-17 band/);
  });

  it("shows a hidden message as what kind it is, never its content", () => {
    render(<Timeline timeline={ready} />);
    expect(screen.getByText("Hidden: a threat")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show a threat" }).textContent).toBe("Show");
    expect(screen.queryByText("this is the verbatim excerpt")).toBeNull();
  });

  it("marks a normalized token without adding a dead tab stop to every row", () => {
    render(<Timeline timeline={ready} />);
    // It was a <button> with no handler: a control that did nothing when
    // activated, one per normalized token, announced as activatable.
    expect(screen.queryByRole("button", { name: /means/ })).toBeNull();
    const token = screen.getByTitle("Written as ghost emoji");
    expect(token.tagName).toBe("SPAN");
  });

  it("moves focus to the row body when a span is revealed, and says what opened", () => {
    render(
      <>
        <div aria-live="polite" id="guardian-live-region" />
        <Timeline timeline={ready} />
      </>,
    );
    const reveal = screen.getByRole("button", { name: "Show a threat" });
    reveal.focus();
    fireEvent.click(reveal);

    // The control that was focused has unmounted. Focus must not fall to body.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toContain("this is the verbatim excerpt");
    expect(document.getElementById("guardian-live-region")?.textContent).toMatch(/Showing a threat/);
  });

  it("writes the read flag only when a span is revealed", () => {
    const onReveal = vi.fn();
    render(<Timeline timeline={ready} onReveal={onReveal} />);
    expect(onReveal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show a threat" }));
    expect(onReveal).toHaveBeenCalledWith("r2");
    expect(screen.getByText("this is the verbatim excerpt")).toBeTruthy();
  });

  it("describes an image in words, with no hash and no image", () => {
    const { container } = render(<Timeline timeline={ready} />);
    expect(screen.getByText("The older account sent an image.")).toBeTruthy();
    expect(screen.getByText("Your scanner didn't match it to anything.")).toBeTruthy();
    // Whether a person on the team looked is kept, because a report has to say so.
    expect(screen.getByText("Nobody on your team has looked at it yet.")).toBeTruthy();
    expect(screen.getByText("Guardian never keeps images.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/sha256|9f3c/);
    expect(container.querySelector("img")).toBeNull();
  });

  it("labels a gap in the conversation rather than closing it up", () => {
    render(<Timeline timeline={ready} />);
    expect(screen.getByText("3 hours later")).toBeTruthy();
  });

  it("treats an expired timeline as a designed outcome, not an error", () => {
    render(<Timeline timeline={{ state: "expired", deletedOn: at }} />);
    expect(screen.getByText("These messages were deleted on schedule.")).toBeTruthy();
  });
});
