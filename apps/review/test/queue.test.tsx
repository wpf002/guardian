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
  it("renders the ranking rule, the counts, the chips and the ranked cards", async () => {
    const { container } = await renderQueue();

    expect(screen.getByRole("heading", { level: 1, name: "Queue" })).toBeTruthy();
    expect(container.textContent).toContain("Northwood Gaming");
    expect(container.textContent).toContain("in queue");
    expect(container.textContent).toContain("Ranked by tier and critical signal");

    expect(screen.getByRole("navigation", { name: "Queue filters" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Needs second reviewer/ })).toBeTruthy();

    const cards = screen.getAllByRole("listitem");
    expect(cards.length).toBeGreaterThan(1);

    // Line one names the pair and the critical signal in words, never a person.
    expect(container.textContent).toContain("Pair 4f2a");
    expect(container.textContent).toContain("critical: threat template match");
    expect(container.textContent).toContain("critical: none");
    // Line two is the pattern and the bands with their provenance.
    expect(container.textContent).toContain("Stage 3 to 4 in 19h");
    expect(container.textContent).toContain("bands 16-17 to 9-12");
    // Line three is claim state and the SLA, with T1 stating the absence.
    expect(container.textContent).toContain("unclaimed");
    expect(container.textContent).toContain("no SLA (watch)");
    expect(container.textContent).toMatch(/\d+h \d+m left/);

    // No fused score, no percentage, no weight. The word score survives only
    // inside a pattern clause that says the pair has nothing else.
    expect(container.textContent).not.toMatch(/score\D{0,12}\d/i);
    expect(container.textContent).not.toContain("%");
  });

  it("ranks T2 above T1 and puts the critical case first", async () => {
    await renderQueue();
    const rows = screen.getAllByRole("listitem").map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("Pair 4f2a");
    const firstT1 = rows.findIndex((row) => row.includes("no SLA (watch)"));
    const lastT2 = rows.map((row) => row.includes("left")).lastIndexOf(true);
    expect(firstT1).toBeGreaterThan(lastT2);
  });

  it("shows the claim state a second reviewer already holds", async () => {
    const { container } = await renderQueue();
    expect(container.textContent).toContain("claimed by M. Osei");
  });

  it("names the unfiltered count when a filter empties the list", async () => {
    const { container } = await renderQueue({ chip: "needs_second", tier: "T1" });
    expect(container.textContent).toContain("No cases match these filters.");
    expect(container.textContent).toMatch(/\d+ cases are in the queue\./);
    expect(screen.getByRole("link", { name: "Show every case" })).toBeTruthy();
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
