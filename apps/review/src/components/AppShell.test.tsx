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

const nav = [
  { href: "/queue", label: "Queue", count: 14 },
  { href: "/settings", label: "Settings", dot: "attention" as const },
];

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
