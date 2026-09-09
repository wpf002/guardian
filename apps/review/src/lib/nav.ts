/**
 * The rail. Two destinations for a reviewer, three more for an operator, each of
 * the extra three carrying a state dot and never a count, so navigation cannot
 * become an alert feed (DESIGN-UI 3).
 *
 * There were three: /queue and /cases were the same ranked list under two
 * entries, with two row designs, so they disagreed about how a case looks while
 * agreeing about which cases there are. /cases redirects to /queue now and the
 * case itself is still /cases/[id].
 */

import type { NavItem } from "@/components/AppShell";
import type { Role } from "./session";

export interface NavCounts {
  queue?: number;
  attention?: boolean;
}

export function navForRole(role: Role, counts: NavCounts = {}): NavItem[] {
  const items: NavItem[] = [
    { href: "/queue", label: "Dashboard", count: counts.queue },
    { href: "/audit", label: "Evidence Log" },
  ];
  if (role === "operator" || role === "owner") {
    items.push(
      { href: "/dashboard", label: "Reporting", dot: counts.attention ? "attention" : "none" },
      { href: "/guilds", label: "Connected Servers", dot: "none" },
      { href: "/settings", label: "Settings", dot: "none" },
    );
  }
  return items;
}
