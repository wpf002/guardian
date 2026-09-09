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
 * The theme, chosen here and nowhere else.
 *
 * There used to be a control in the header that cycled system, light and dark,
 * and it was the only thing in the top-right corner of every page. It is gone,
 * along with the "system" option: a console somebody reads conversations in
 * late at night has a look rather than asking about one, and dark is it unless
 * a reviewer says otherwise here.
 */

const CHOICES: { value: ThemeChoice; label: string; help: string }[] = [
  { value: "dark", label: "Dark", help: "The default. Easier on a long evening shift." },
  { value: "light", label: "Light", help: "Ink on an off-white ground." },
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
