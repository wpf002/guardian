"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import styles from "./AppShell.module.css";

const THEME_KEY = "guardian.theme";
export type ThemeChoice = "system" | "light" | "dark";

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
  /** The exposure meter, pinned to the foot of the rail. */
  railFoot?: ReactNode;
  children: ReactNode;
}

function readStoredTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // A browser with storage blocked still gets a working app on the system theme.
  }
  return "system";
}

/**
 * The theme lives outside React, because it is a browser fact rather than page
 * state: the server has no way to know it, and reading it during render would
 * be a hydration mismatch. useSyncExternalStore is the supported way to say so.
 */
let currentTheme: ThemeChoice | null = null;
const themeListeners = new Set<() => void>();

function subscribeToTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

function themeSnapshot(): ThemeChoice {
  if (currentTheme === null) currentTheme = readStoredTheme();
  return currentTheme;
}

function themeServerSnapshot(): ThemeChoice {
  return "system";
}

function setStoredTheme(next: ThemeChoice) {
  currentTheme = next;
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // The choice still holds for this page. It just will not survive a reload.
  }
  for (const listener of themeListeners) listener();
}

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const THEME_WORD: Record<ThemeChoice, string> = {
  system: "system theme",
  light: "light theme",
  dark: "dark theme",
};

export function AppShell({ session, nav, railFoot, children }: AppShellProps) {
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
          <span className={styles.who}>
            {session.displayName} &middot; {session.role}
            {session.customerName ? ` · ${session.customerName}` : ""}
          </span>
          <button type="button" className={styles.themeButton} onClick={cycleTheme}>
            {THEME_WORD[theme]}
          </button>
        </div>
        {/* Queue count changes announce politely. Individual cases never do. */}
        <div aria-live="polite" className="sr-only" id="guardian-live-region" />
        <main id="main">{children}</main>
      </div>
    </div>
  );
}
