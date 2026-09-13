import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/queue" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AppShell } = await import("./AppShell");

const nav = [
  { href: "/queue", label: "Queue", count: 14 },
  { href: "/settings", label: "Settings", dot: "attention" as const },
];

describe("AppShell", () => {
  it("renders the rail, the skip link and a polite live region", () => {
    render(
      <AppShell session={{ displayName: "A. Rivera", role: "reviewer" }} nav={nav}>
        <p>case</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Skip to the Main Content" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
    // Without this the skip link scrolls and focus stays where it was.
    expect(screen.getByRole("main").getAttribute("tabindex")).toBe("-1");
  });

  it("says on screen when the deployment is serving fixtures", () => {
    const { rerender } = render(
      <AppShell session={{ displayName: "A. Rivera", role: "reviewer" }} nav={nav}>
        <p>case</p>
      </AppShell>,
    );
    expect(screen.queryByText(/Running on fixtures/)).toBeNull();

    rerender(
      <AppShell session={{ displayName: "A. Rivera", role: "reviewer" }} nav={nav} mock>
        <p>case</p>
      </AppShell>,
    );
    expect(screen.getByText(/Running on fixtures/)).toBeTruthy();
  });

  it("marks the current destination and keeps counts off oversight items", () => {
    render(
      <AppShell session={{ displayName: "A. Rivera", role: "reviewer" }} nav={nav}>
        <p>case</p>
      </AppShell>,
    );
    const queue = screen.getByRole("link", { name: /Queue/ });
    expect(queue.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("14")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Settings/ }).textContent).not.toContain("0");
  });

  /*
   * Guardian is dark only. There was a theme control in the chrome, then a
   * picker in Settings and a script that stamped the choice on the root element
   * before first paint. None of it exists now, so nothing sets a theme at all.
   */
  it("carries no theme control and sets no theme attribute", () => {
    render(
      <AppShell session={{ displayName: "A. Rivera", role: "reviewer" }} nav={nav}>
        <p>case</p>
      </AppShell>,
    );
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
