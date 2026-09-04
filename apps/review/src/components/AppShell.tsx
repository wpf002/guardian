"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { LIVE_REGION_ID } from "@/lib/announce";
import {
  NEXT_THEME,
  THEME_WORD,
  applyTheme,
  setStoredTheme,
  subscribeToTheme,
  themeServerSnapshot,
  themeSnapshot,
} from "@/lib/theme";
import styles from "./AppShell.module.css";

export type { ThemeChoice } from "@/lib/theme";

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
  const theme = useSyncExternalStore(subscribeToTheme, themeSnapshot, themeServerSnapshot);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function cycleTheme() {
    setStoredTheme(NEXT_THEME[theme]);
  }

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to the main content
      </a>
      <nav className={styles.rail} aria-label="Main">
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
        <div className={styles.railFoot}>{railFoot}</div>
      </nav>

      <div className={styles.content}>
        <div className={styles.topline}>
          {mock ? (
            <span className={styles.fixtures}>
              Running on fixtures. No database is attached, every seat is the same demo seat, and
              nothing on screen is real traffic.
            </span>
          ) : null}
          <span className={styles.who}>
            {session.displayName} &middot; {session.role}
            {session.customerName ? ` · ${session.customerName}` : ""}
          </span>
          <button type="button" className={styles.themeButton} onClick={cycleTheme}>
            {THEME_WORD[theme]}
          </button>
        </div>
        {/* Written through lib/announce. Sentences about what changed on the
            page, never an event feed and never a person. */}
        <div aria-live="polite" className="sr-only" id={LIVE_REGION_ID} />
        {/* tabIndex -1 so the skip link actually moves focus rather than only
            scrolling. It is not a tab stop; it can only be reached by target. */}
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
