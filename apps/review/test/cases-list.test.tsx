import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`redirect ${href}`);
  },
}));

const { default: CasesPage } = await import("@/app/cases/page");
const { resetMockData } = await import("@/lib/mock/fixtures");

beforeEach(() => {
  resetMockData();
});

describe("the case list at /cases", () => {
  /**
   * DESIGN-UI 6: the tier is a 3px start border, not a filled badge, because a
   * wall of filled badges is the alarm styling the brief forbids. It was drawn
   * twice, as a tinted pill and again as a rule on the row, and /queue and
   * /cases disagreed about the same data.
   */
  it("encodes the tier once, as a bar, the way the queue card does", async () => {
    const { container } = render(await CasesPage());

    const badges = Array.from(container.querySelectorAll("[data-tier][data-variant]"));
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.getAttribute("data-variant")).toBe("bar");
    }
  });

  it("still names the tier and its critical signal in words", async () => {
    render(await CasesPage());
    expect(screen.getAllByLabelText(/^Tier T\d/).length).toBeGreaterThan(0);
  });
});
