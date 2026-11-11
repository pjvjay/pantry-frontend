// The theme menu: System, Light or Dark, as three radio buttons drawn as one small segmented
// control. Native radios give the keyboard path for free: Tab reaches the chosen one, the arrow
// keys move between them and choose as they go, and a screen reader hears "Theme, group" and
// each option's name and state. Each face shows its icon and its word; on a phone only the icons
// show, and the words stay for screen readers and as a tooltip.
//
// Choosing applies at once (data-theme on <html>) and is kept in this browser; another open tab
// follows when the choice changes there. The kept choice is applied before the first paint by
// index.html, so this only reflects and changes it.
import { useEffect, useId, useState } from 'react';
import { Icon } from './icons';
import type { IconName } from './icons';
import { THEME_CHOICES, THEME_KEY, parseThemeChoice, storedTheme, themeAttribute } from '../theme';
import type { ThemeChoice } from '../theme';

const FACES: Record<ThemeChoice, { word: string; icon: IconName }> = {
  system: { word: 'System', icon: 'monitor' },
  light: { word: 'Light', icon: 'sun' },
  dark: { word: 'Dark', icon: 'moon' },
};

// Storage can be missing or refuse (a private window, blocked site data): the menu still works
// for this page, it just is not remembered.
function readTheme(): ThemeChoice {
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

function keepTheme(choice: ThemeChoice) {
  try {
    const value = storedTheme(choice);
    if (value === null) window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, value);
  } catch {
    // not remembered; still applied
  }
}

export function applyTheme(choice: ThemeChoice) {
  const value = themeAttribute(choice);
  if (value === null) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
}

export function ThemeMenu() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const name = useId();

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY && e.key !== null) return;
      const next = readTheme();
      applyTheme(next);
      setChoice(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const choose = (next: ThemeChoice) => {
    setChoice(next);
    applyTheme(next);
    keepTheme(next);
  };

  return (
    <fieldset className="theme-menu">
      <legend className="sr-only">Theme</legend>
      {THEME_CHOICES.map((c) => (
        <label key={c} className="theme-opt" title={`${FACES[c].word} theme`}>
          <input type="radio" name={name} value={c} checked={choice === c} onChange={() => choose(c)} />
          <span className="theme-face">
            <Icon name={FACES[c].icon} size={16} />
            <span className="theme-word">{FACES[c].word}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
