/**
 * The rail.
 *
 * Everything here is about children being contacted. Two pages that were not
 * are gone from it.
 *
 * Reporting was a metrics dashboard: flag rates, predictive value, reviewer
 * minutes per thousand members, delivery counts. Every number on it measured
 * Guardian rather than describing a child, and it sat second in a five-item
 * rail on a product whose whole job is the first item. Deleted, not moved.
 *
 * Evidence Log is the tamper-evident chain. It has to exist, and a lawyer or
 * NCMEC will ask for it, but it is a record of Guardian's own conduct and not
 * a safety page. It lives under Settings now.
 *
 * /queue and /cases were the same ranked list under two entries with two row
 * designs, so they disagreed about how a case looks while agreeing about which
 * cases there are. /cases redirects to /queue and the case itself is
 * /cases/[id].
 */

import type { NavItem } from "@/components/AppShell";
import type { Role } from "./session";

export interface NavCounts {
  queue?: number;
  attention?: boolean;
}

export function navForRole(role: Role, counts: NavCounts = {}): NavItem[] {
  const items: NavItem[] = [{ href: "/queue", label: "Dashboard", count: counts.queue }];
  if (role === "operator" || role === "owner") {
    items.push(
      { href: "/guilds", label: "Servers", dot: "none" },
      { href: "/settings", label: "Settings", dot: "none" },
    );
  }
  return items;
}
