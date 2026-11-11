// The theme menu: System, Light or Dark. On a wide screen, three radio buttons drawn as one small
// segmented control; on a phone, whose header is one row, one button showing the theme in use
// that opens the same three as a short list under it (styles/theme-menu.css shows one or the
// other). Native radios give the keyboard path for free: Tab reaches the chosen one, the arrow
// keys move between them and choose as they go, and a screen reader hears "Theme, group" and each
// option's name and state. The segmented control shows each face's icon and word; under 900px
// only the icons, the words staying for screen readers and as a tooltip.
//
// The phone's list is a disclosure, as the status beside it is: the button says whether it is
// open, and the list follows it in the order Tab goes. Opened, the keyboard starts on the theme in
// use; the arrow keys choose, and the list stays open while they do. Escape or Enter closes it with
// focus back on the button; it also closes when focus moves on past it, on a press anywhere else
// and on a change of page. A tap on a theme chooses it and closes the list.
//
// Choosing applies at once (data-theme on <html>) and is kept in this browser; another open tab
// follows when the choice changes there. The kept choice is applied before the first paint by
// index.html, so this only reflects and changes it.
import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
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
    <>
      <ThemeSegments choice={choice} choose={choose} />
      <ThemeButton choice={choice} choose={choose} />
    </>
  );
}

// A wide screen's: the three as one segmented control.
function ThemeSegments({ choice, choose }: { choice: ThemeChoice; choose: (c: ThemeChoice) => void }) {
  const name = useId();
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

// A phone's: one button with the theme in use, opening the three as a list.
function ThemeButton({ choice, choose }: { choice: ThemeChoice; choose: (c: ThemeChoice) => void }) {
  const [open, setOpen] = useState(false);
  const name = useId();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // whether the choice now being made came from a press (a tap or a click) rather than the keys
  const pressed = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    // the keyboard starts on the theme in use
    box.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inside = box.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (inside) button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onPlace = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('hashchange', onPlace);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('hashchange', onPlace);
    };
  }, [open]);

  // Focus moved on to something outside (Tab, Shift+Tab); a blur with nowhere to go is not leaving.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && !e.currentTarget.contains(next)) setOpen(false);
  };

  // Done: the list closes and the keyboard carries on from the button.
  const done = () => {
    setOpen(false);
    button.current?.focus();
  };
  // A press on a theme (even the one in use) is a choice made; a click the arrow keys cause is not.
  const pressedOn = () => {
    if (!pressed.current) return;
    pressed.current = false;
    done();
  };

  return (
    <div className="theme-pick" ref={box} onBlur={onBlur}>
      <button ref={button} type="button" className="btn btn-ghost btn-icon"
              aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)}>
        <Icon name={FACES[choice].icon} size={20} />
        <span className="sr-only">Theme: {FACES[choice].word}</span>
      </button>
      <div id={listId} className="theme-pop" hidden={!open}
           onPointerDown={() => { pressed.current = true; }}
           onKeyDown={(e) => { pressed.current = false; if (e.key === 'Enter') { e.preventDefault(); done(); } }}>
        <fieldset className="theme-list">
          <legend className="theme-list-head">Theme</legend>
          {THEME_CHOICES.map((c) => (
            <label key={c} className="theme-item">
              <input type="radio" name={name} value={c} checked={choice === c} onChange={() => choose(c)}
                     onClick={pressedOn} />
              <Icon name={FACES[c].icon} size={18} />
              <span>{FACES[c].word}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
