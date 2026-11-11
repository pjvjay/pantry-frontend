// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The decisions behind the console's shared primitives, kept apart from the components so they
// can be tested without a browser: when a box that scrolls inside itself becomes a stop for the
// keyboard (components/ui.tsx, ScrollRegion), how a figure's tone is drawn (StatTile), and when a
// change of view cross-fades (components/viewTransition.ts).

// ─── ScrollRegion ────────────────────────────────────────────

// A box's own size and its content's, as the browser measures them.
export interface ScrollBox {
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
}

// Whether a box's content is bigger than the box, either way. A pixel of slack: a browser rounds
// a fractional width up in scrollWidth and down in clientWidth, so content that fits exactly can
// read one pixel over, and a box that is no stop for anything must not become one by rounding.
export function overflows(box: ScrollBox, slack = 1): boolean {
  return box.scrollWidth - box.clientWidth > slack || box.scrollHeight - box.clientHeight > slack;
}

export interface RegionName {
  // the words a screen reader says for the region ("Recent turns")
  label?: string;
  // or the id of what already says them (a sheet's title)
  labelledBy?: string;
}

export interface RegionProps {
  tabIndex?: 0;
  role?: 'region';
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

// What a box that scrolls inside itself says about itself. While its content overflows: a stop
// for the keyboard, so the arrow keys can scroll what the pointer could, and a region with a name,
// so a screen reader says what that stop is. While everything fits: nothing at all, no Tab stop
// that leads nowhere and no landmark around an ordinary table.
export function scrollRegionProps(over: boolean, name: RegionName): RegionProps {
  if (!over) return {};
  if (name.labelledBy) return { tabIndex: 0, role: 'region', 'aria-labelledby': name.labelledBy };
  return { tabIndex: 0, role: 'region', 'aria-label': name.label };
}

// ─── StatTile ────────────────────────────────────────────────

export type StatTone = 'default' | 'good' | 'warn' | 'danger';

// A tone colours a tile's figure and puts a sign beside it, so it never rests on colour alone; a
// plain figure has neither. Each class is written out whole, so a search for it finds it.
export const STAT_TONES: Record<StatTone, { className: string; icon: 'check' | 'alert' | 'circle-x' | null }> = {
  default: { className: 'stat-tile', icon: null },
  good: { className: 'stat-tile stat-tile-good', icon: 'check' },
  warn: { className: 'stat-tile stat-tile-warn', icon: 'alert' },
  danger: { className: 'stat-tile stat-tile-danger', icon: 'circle-x' },
};

// ─── View transitions ────────────────────────────────────────

// Whether a change of view cross-fades: only where the browser can (document.startViewTransition),
// and never for a shopper who asked for less motion, for whom the new view simply appears.
export function wantsViewTransition(browserCan: boolean, reducedMotion: boolean): boolean {
  return browserCan && !reducedMotion;
}
