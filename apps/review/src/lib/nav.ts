/**
 * The rail. Three destinations for a reviewer, two more for an operator, each
 * of the extra two carrying a state dot and never a count, so navigation cannot
 * become an alert feed (DESIGN-UI 3).
 */

import type { NavItem } from "@/components/AppShell";
import type { Role } from "./session";

export interface NavCounts {
  queue?: number;
  cases?: number;
  attention?: boolean;
}

export function navForRole(role: Role, counts: NavCounts = {}): NavItem[] {
  const items: NavItem[] = [
    { href: "/queue", label: "Queue", count: counts.queue },
    { href: "/cases", label: "Cases", count: counts.cases },
    { href: "/audit", label: "Audit" },
  ];
  if (role === "operator" || role === "owner") {
    items.push(
      { href: "/dashboard", label: "Health", dot: counts.attention ? "attention" : "none" },
      { href: "/guilds", label: "Guilds", dot: "none" },
      { href: "/settings", label: "Settings", dot: "none" },
    );
  }
  return items;
}
