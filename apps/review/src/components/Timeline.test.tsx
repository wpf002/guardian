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
      gapHoursBefore: null,
    },
  ],
};

describe("Timeline", () => {
  it("marks up the thread as a list and shows the normalized token", () => {
    render(<Timeline timeline={ready} />);
    expect(screen.getByRole("list")).toBeTruthy();
    expect(screen.getByText(/normalized from ghost emoji/)).toBeTruthy();
  });

  it("shows a protected span as its class and word count, never its content", () => {
    render(<Timeline timeline={ready} />);
    expect(screen.getByRole("button", { name: /threat language, 22 words/ })).toBeTruthy();
    expect(screen.queryByText("this is the verbatim excerpt")).toBeNull();
  });

  it("writes the read flag only when a span is revealed", () => {
    const onReveal = vi.fn();
    render(<Timeline timeline={ready} onReveal={onReveal} />);
    expect(onReveal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /threat language, 22 words/ }));
    expect(onReveal).toHaveBeenCalledWith("r2");
    expect(screen.getByText("this is the verbatim excerpt")).toBeTruthy();
  });

  it("renders a media event as four lines plus the no-image sentence, and no image", () => {
    const { container } = render(<Timeline timeline={ready} />);
    expect(screen.getByText(/Media event, older band to younger band/)).toBeTruthy();
    expect(screen.getByText(/Operator verdict: no match/)).toBeTruthy();
    expect(screen.getByText(/Viewed by a person at the operator: no/)).toBeTruthy();
    expect(
      screen.getByText("Guardian holds no image and there is nothing here to open."),
    ).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("labels a gap in the conversation rather than closing it up", () => {
    render(<Timeline timeline={ready} />);
    expect(screen.getByText("3 hours, no messages")).toBeTruthy();
  });

  it("treats an expired timeline as a designed outcome, not an error", () => {
    render(<Timeline timeline={{ state: "expired", deletedOn: at }} />);
    expect(screen.getByText(/deleted under the retention rule/)).toBeTruthy();
  });
});
