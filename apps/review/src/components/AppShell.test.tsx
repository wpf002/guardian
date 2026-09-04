import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/queue" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AppShell } = await import("./AppShell");
const { resetThemeCache, THEME_BOOT_SCRIPT } = await import("@/lib/theme");

const nav = [
  { href: "/queue", label: "Queue", count: 14 },
  { href: "/settings", label: "Settings", dot: "attention" as const },
];

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetThemeCache();
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the rail, the skip link and a polite live region", () => {
    render(
      <AppShell session={{ displayName: "A. Rivera", role: "reviewer" }} nav={nav}>
        <p>case</p>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Skip to the main content" })).toBeTruthy();
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

  /**
   * The theme has to be on the root element before the first paint. Applying it
   * in an effect gives a reviewer whose choice disagrees with their operating
   * system a full screen of the wrong theme on every load, over a surface
   * carrying threat and coercion excerpts.
   */
  it("has a pre-paint script that stamps the stored theme", () => {
    window.localStorage.setItem("guardian.theme", "dark");
    // The script the layout inlines, run the way the browser runs it.
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
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

  it("persists the theme choice and survives storage being unavailable", () => {
    render(
      <AppShell session={{ displayName: "A. Rivera", role: "reviewer" }} nav={nav}>
        <p>case</p>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "system theme" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem("guardian.theme")).toBe("light");
  });
});
