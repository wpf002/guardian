"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LIVE_REGION_ID } from "@/lib/announce";
import { NavIcon } from "./NavIcon";
import styles from "./AppShell.module.css";

/** The seat's role, as a word rather than the value the roster stores. */
const ROLE_WORD: Record<string, string> = {
  reviewer: "Reviewer",
  operator: "Operator",
  owner: "Owner",
};

export interface NavItem {
  href: string;
  label: string;
  /** Work destinations carry a count. */
  count?: number;
  /** Oversight destinations carry a state dot, never a count. */
  dot?: "none" | "attention";
}

export interface AppShellSession {
  displayName: string;
  role: string;
  customerName?: string;
}

export interface AppShellProps {
  session: AppShellSession;
  nav: NavItem[];
  /**
   * True when the deployment is serving fixtures. It is stated on screen
   * because mock mode also signs everybody in as the same owner seat, and a
   * console that looks real while showing invented cases is worse than one that
   * will not start.
   */
  mock?: boolean;
  /** The exposure meter, pinned to the foot of the rail. */
  railFoot?: ReactNode;
  children: ReactNode;
}

export function AppShell({ session, nav, railFoot, mock = false, children }: AppShellProps) {
  const pathname = usePathname();

  const initials = session.displayName
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  /*
   * The rail stays in view while the page scrolls. It holds what is about the
   * session rather than the page: the product, where you can go, whether this
   * is demo data, and who is signed in. The seat and the demo tag used to sit
   * above every page heading, where they were read first and mattered least.
   * Only the destinations are inside the nav landmark.
   */
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to the Main Content
      </a>
      <div className={styles.rail}>
        <Link href="/queue" className={styles.brand}>
          <span className={styles.brandMark}>
            <NavIcon name="shield" size={16} />
          </span>
          <span className={styles.brandName}>Guardian</span>
        </Link>

        <nav className={styles.nav} aria-label="Main">
          <ul className={styles.navList}>
            {nav.map((item) => {
              const current = pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`${styles.navItem} ${current ? styles.current : ""}`}
                    aria-current={current ? "page" : undefined}
                  >
                    <span className={styles.navIcon}>
                      <NavIcon name={ICONS[item.href] ?? "dashboard"} />
                    </span>
                    <span className={styles.navLabel}>{item.label}</span>
                    {item.count !== undefined ? (
                      <span className={styles.count}>{item.count}</span>
                    ) : null}
                    {item.dot === "attention" ? (
                      <span className={styles.dot} aria-label="needs attention" role="img" />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className={styles.railFoot}>
          {railFoot}
          {mock ? (
            <span
              className={styles.fixtures}
              title="Running on fixtures. No database is attached, every seat is the same demo seat, and nothing on screen is real traffic."
            >
              Demo data
              <span className="sr-only">
                . Running on fixtures. No database is attached, every seat is the same demo seat,
                and nothing on screen is real traffic.
              </span>
            </span>
          ) : null}
          <div className={styles.seat}>
            <span className={styles.avatar} aria-hidden="true">
              {initials}
            </span>
            <span className={styles.seatText}>
              <span className={styles.seatName}>{session.displayName}</span>
              <span className={styles.seatRole}>
                {ROLE_WORD[session.role] ?? session.role}
                {session.customerName ? ` · ${session.customerName}` : ""}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {/* Written through lib/announce. Sentences about what changed on the
            page, never an event feed and never a person. */}
        <div aria-live="polite" className="sr-only" id={LIVE_REGION_ID} />
        {/* tabIndex -1 so the skip link actually moves focus rather than only
            scrolling. It is not a tab stop; it can only be reached by target. */}
        <main id="main" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** Which icon each destination carries. */
const ICONS: Record<string, string> = {
  "/queue": "dashboard",
  "/guilds": "servers",
  "/settings": "settings",
};
