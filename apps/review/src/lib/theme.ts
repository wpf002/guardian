/**
 * The theme choice, as one store shared by everything that reads or writes it.
 *
 * It lives outside React because it is a browser fact rather than page state:
 * the server has no way to know it, and reading it during render would be a
 * hydration mismatch. useSyncExternalStore is the supported way to say so.
 *
 * There was a copy of this in the app shell and a second copy in the settings
 * picker, each with its own module-level cache, so changing the theme in
 * settings left the rail control showing the old word until the next full load.
 * One store, one cache, one set of listeners.
 *
 * First paint is handled separately, by the blocking script in app/layout.tsx.
 * That script stamps data-theme before the stylesheet resolves, so a reviewer
 * whose stored choice disagrees with their operating system does not get a
 * screen of the wrong theme while the bundle hydrates.
 */

export const THEME_KEY = "guardian.theme";

/**
 * Two choices, and dark is the default.
 *
 * There was a third, "system", and a control in the header that cycled through
 * all three. It was the only thing in the top-right corner of every page and
 * the word it showed most of the time was "system theme", which tells a
 * reviewer nothing about the case in front of them. A console somebody reads
 * conversations in at eleven at night has a look; it does not ask.
 */
export type ThemeChoice = "light" | "dark";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark";
}

/**
 * The blocking script, as a string, so the markup and the store cannot drift
 * apart on the key name or on the attribute. It is deliberately tiny and it
 * swallows its own errors: a browser with storage blocked still gets a working
 * app on the system theme.
 */
export const THEME_BOOT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
  `document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark");}catch(e){}`;

function readStoredTheme(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    if (isThemeChoice(value)) return value;
  } catch {
    // A browser with storage blocked still gets a working app, on the default.
  }
  return "dark";
}

let currentTheme: ThemeChoice | null = null;
const listeners = new Set<() => void>();

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function themeSnapshot(): ThemeChoice {
  if (currentTheme === null) currentTheme = readStoredTheme();
  return currentTheme;
}

/** The server cannot know a browser setting, so it renders the default. */
export function themeServerSnapshot(): ThemeChoice {
  return "dark";
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.setAttribute("data-theme", choice);
}

export function setStoredTheme(next: ThemeChoice): void {
  currentTheme = next;
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // The choice still holds for this page. It just will not survive a reload.
  }
  applyTheme(next);
  for (const listener of listeners) listener();
}

/** Test hook. Drops the cached value so the next read goes back to storage. */
export function resetThemeCache(): void {
  currentTheme = null;
}

export const THEME_WORD: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
};
