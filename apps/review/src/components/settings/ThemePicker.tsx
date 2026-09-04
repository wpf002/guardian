"use client";

import { useSyncExternalStore } from "react";
import {
  setStoredTheme,
  subscribeToTheme,
  themeServerSnapshot,
  themeSnapshot,
  type ThemeChoice,
} from "@/lib/theme";
import styles from "./settings.module.css";

/**
 * The theme, chosen in words rather than cycled from the rail.
 *
 * It reads and writes the one store in lib/theme, which the app shell also
 * uses, so a change made here updates the rail control in the same commit
 * rather than at the next full load.
 */

const CHOICES: { value: ThemeChoice; label: string; help: string }[] = [
  { value: "system", label: "Match my system", help: "Follows the setting on this device." },
  { value: "light", label: "Light", help: "Ink on an off-white ground." },
  { value: "dark", label: "Dark", help: "For evening shifts. Both themes are first class." },
];

export function ThemePicker() {
  const theme = useSyncExternalStore(subscribeToTheme, themeSnapshot, themeServerSnapshot);

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
              onChange={() => setStoredTheme(choice.value)}
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
