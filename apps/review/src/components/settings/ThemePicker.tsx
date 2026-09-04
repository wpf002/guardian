"use client";

import { useEffect, useSyncExternalStore } from "react";
import styles from "./settings.module.css";

/**
 * The theme, chosen in words rather than cycled from the rail.
 *
 * It reads and writes the same localStorage key the app shell uses, so the two
 * agree on reload. The shell caches its own copy for the life of the page, so
 * its rail control keeps its old label until the next load; that is cosmetic
 * and the fix belongs in the shell, which should export the store.
 */

const THEME_KEY = "guardian.theme";
export type ThemeChoice = "system" | "light" | "dark";

const CHOICES: { value: ThemeChoice; label: string; help: string }[] = [
  { value: "system", label: "Match my system", help: "Follows the setting on this device." },
  { value: "light", label: "Light", help: "Ink on an off-white ground." },
  { value: "dark", label: "Dark", help: "For evening shifts. Both themes are first class." },
];

function readStored(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // Storage blocked. The app still works, on the system theme.
  }
  return "system";
}

let current: ThemeChoice | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ThemeChoice {
  if (current === null) current = readStored();
  return current;
}

/** The server cannot know a browser setting, so it renders the neutral choice. */
function serverSnapshot(): ThemeChoice {
  return "system";
}

function store(next: ThemeChoice) {
  current = next;
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // The choice holds for this page. It just will not survive a reload.
  }
  for (const listener of listeners) listener();
}

export function ThemePicker() {
  const theme = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <fieldset className={`${styles.form} ${styles.fieldset}`}>
      <legend className="sr-only">Theme</legend>
      <div className={styles.rows}>
        {CHOICES.map((choice) => (
          <div key={choice.value} className={styles.check}>
            <input
              type="radio"
              id={`theme-${choice.value}`}
              name="theme"
              value={choice.value}
              checked={theme === choice.value}
              onChange={() => store(choice.value)}
            />
            <label className={styles.checkLabel} htmlFor={`theme-${choice.value}`}>
              {choice.label}
              <span className={styles.blockNote}>{choice.help}</span>
            </label>
          </div>
        ))}
      </div>
      <p className={styles.rowNote}>
        This choice is kept in this browser. It is not part of your seat, so a different machine
        starts on the system theme.
      </p>
    </fieldset>
  );
}
