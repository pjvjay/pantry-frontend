// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The shopper's theme: follow the system, or always light, or always dark. The choice is kept in
// this browser under THEME_KEY; nothing kept means "follow the system". A chosen theme becomes
// <html data-theme="light|dark">, which styles/tokens.css lets win over the system's preference;
// following the system means no attribute at all. index.html applies the kept choice with a few
// lines of its own before the page first paints (so a dark choice never flashes light), and
// tests/theme.test.ts holds those lines to the same key and values as this file.

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'pantry.theme.v1';

// In the order the menu offers them.
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

// What was kept, read leniently: anything but 'light' or 'dark' (nothing, an old or garbled value)
// is "follow the system", which is always a safe answer.
export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

// The data-theme attribute for a choice: none when following the system.
export function themeAttribute(choice: ThemeChoice): 'light' | 'dark' | null {
  return choice === 'system' ? null : choice;
}

// What to keep for a choice: nothing for the system, so a browser that never chose stays clean.
export function storedTheme(choice: ThemeChoice): string | null {
  return choice === 'system' ? null : choice;
}
