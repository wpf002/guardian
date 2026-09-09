import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isAccusatory } from "@guardian/schema";

// The queue renders links and, on open, calls a server action that redirects.
// Neither has a router in jsdom, so both are stubbed at the module edge.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const redirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args),
  usePathname: () => "/queue",
}));

const { default: QueuePage } = await import("@/app/queue/page");
const { QueueList } = await import("@/components/queue/QueueList");
const { mockSession } = await import("@/lib/auth");
const { listQueue } = await import("@/lib/data/cases");
const { resetMockData } = await import("@/lib/mock/fixtures");

async function renderQueue(params: Record<string, string> = {}) {
  resetMockData();
  return render(await QueuePage({ searchParams: Promise.resolve(params) }));
}

describe("/queue in mock mode", () => {
  it("renders the counts and the ranked cards, and nothing above them", async () => {
    const { container } = await renderQueue();

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(container.textContent).toContain("Northwood Gaming");
    expect(container.textContent).toContain("6 conversations to read");

    // Nothing sits between the count and the first case: no paragraph arguing
    // for the sort order, no filter chips, no session budget. And nothing on a
    // row is queue furniture: no deadline, no claim, no service level.
    expect(container.textContent).not.toContain("Why this order");
    expect(container.textContent).not.toContain("The most serious cases come first");
    expect(screen.queryByRole("navigation", { name: "Queue filters" })).toBeNull();
    expect(container.textContent).not.toContain("Breach risk");
    expect(container.textContent).not.toMatch(/min left/);

    const cards = screen.getAllByRole("listitem");
    expect(cards.length).toBeGreaterThan(1);

    // The card names the pair and the critical signal in words, never a person.
    expect(container.textContent).toContain("4f2a");
    expect(container.textContent).toContain("threat template match");
    // A line of the conversation, which is what the row is for.
    expect(container.textContent).toContain("dont tell anyone we talk");
    // A card with no critical signal says nothing about it. The tier badge
    // already carries the diamond when one fired, so absence needs no words.
    expect(container.textContent).not.toContain("critical: none");
    // The headline is the pattern, and under it one line saying why this is
    // worth opening. The ages, their provenance, the stage count and the span
    // moved to the case, where somebody is actually deciding.
    expect(container.textContent).toContain("Asked who supervises the younger account");
    expect(container.textContent).not.toContain("Ages 16-17 and 9-12");
    expect(container.textContent).toContain("Serious on its own");
    expect(container.textContent).not.toContain("unclaimed");
    expect(container.textContent).not.toMatch(/Due by/);
    expect(container.textContent).not.toContain("claimed by");

    // No fused score, no percentage, no weight. The word score survives only
    // inside a pattern clause that says the pair has nothing else.
    expect(container.textContent).not.toMatch(/score\D{0,12}\d/i);
    expect(container.textContent).not.toContain("%");
  });

  // An open proposal sorts above everything, because it is the only row a
  // second person is required to finish and it already holds one reviewer's
  // decision. Under it, T2 above T1 and the critical case first.
  it("puts the waiting proposal first, then ranks T2 above T1", async () => {
    await renderQueue();
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("91c7");
    expect(rows[0]).toContain("Waiting on you");
    expect(rows[1]).toContain("4f2a");
    expect(rows[1]).toContain("4f2a");
  });

  /*
   * Will: human review, not a triage queue. Rule 6 asks for a person to confirm
   * before a report exists; it does not ask for deadlines, claims or a service
   * level, and all three made a page for reading conversations read as a page
   * about keeping up.
   */
  it("carries no queue furniture on a row", async () => {
    const { container } = await renderQueue();
    expect(container.textContent).not.toMatch(/Due by/);
    expect(container.textContent).not.toContain("claimed by");
    expect(container.textContent).not.toMatch(/running out of time/i);
  });

  /*
   * The proposal line is the whole point of the row.
   *
   * A proposal writes no tier, so without it 91c7 sits in the queue as an
   * ordinary T2 and the second reviewer it is waiting for cannot tell. It also
   * beats the claim: M. Osei both claimed and proposed it, and a row waiting on
   * you is not a row to shrink out of the way.
   */
  it("names the reader an open proposal is waiting on", async () => {
    const { container } = await renderQueue();
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent ?? "");
    expect(rows[0]).toMatch(/Waiting on you\. M\. Osei proposed a report \d+ ?(min|h|d) ago/);
    // Still the pattern and a line of the conversation, not just a status.
    expect(rows[0]).toContain("Asked the younger account to carry on the conversation somewhere else");
    expect(isAccusatory(container.textContent ?? "")).toBe(false);
  });

  // A query string is not a filter any more. Whatever it says, the page shows
  // the whole partition, so a stale bookmark cannot hide a case from a reviewer.
  it("ignores filter parameters left over in the URL", async () => {
    const { container } = await renderQueue({ chip: "needs_second", tier: "T1" });
    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(1);
    expect(container.textContent).toContain("4f2a");
  });

  it("writes nothing about a person anywhere on the page", async () => {
    const { container } = await renderQueue();
    expect(isAccusatory(container.textContent ?? "")).toBe(false);
  });
});

describe("queue keyboard and claim", () => {
  async function renderList() {
    resetMockData();
    const page = await listQueue(mockSession());
    const open = vi.fn();
    const view = render(
      <QueueList cases={page.cases} open={open} />,
    );
    return { ...view, open, cases: page.cases };
  }

  it("moves the selection with j and k, and neither opens nor claims", async () => {
    const { open } = await renderList();
    const cards = screen.getAllByRole("button");

    expect(cards[0]!.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(document, { key: "j" });
    expect(document.activeElement).toBe(cards[1]);
    expect(cards[1]!.getAttribute("tabindex")).toBe("0");

    fireEvent.keyDown(document, { key: "k" });
    expect(document.activeElement).toBe(cards[0]);
    expect(open).not.toHaveBeenCalled();
  });

  it("claims and opens the selected case on the card, through the server action", async () => {
    const { open, cases } = await renderList();
    fireEvent.click(screen.getAllByRole("button")[0]!);
    expect(open).toHaveBeenCalledWith(cases[0]!.pairId, "claim");
  });

  it("opens read only on Shift+Enter without claiming", async () => {
    const { open, cases } = await renderList();
    fireEvent.keyDown(screen.getAllByRole("button")[0]!, { key: "Enter", shiftKey: true });
    expect(open).toHaveBeenCalledWith(cases[0]!.pairId, "read_only");
  });

  it("fires no binding while focus is in a text field", async () => {
    const { open } = await renderList();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "o" });
    expect(open).not.toHaveBeenCalled();
    input.remove();
  });

  it("renders nothing but the shortcut hint when the list is empty", () => {
    const { container } = render(<QueueList cases={[]} open={vi.fn()} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(container.textContent).toContain("j and k move the selection");
  });
});
