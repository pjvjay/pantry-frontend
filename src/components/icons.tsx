// The meal plan's small line icons: 24-unit strokes in currentColor, so they take the text's
// colour in light and dark alike. Always beside words, never instead of them: aria-hidden.
import type { ReactNode } from 'react';

export type IconName =
  | 'calendar' | 'wallet' | 'plate' | 'fish' | 'sprout' | 'leaf' | 'ban' | 'globe' | 'pin' | 'cart'
  | 'utensils' | 'clock' | 'bell' | 'search' | 'locate' | 'store' | 'check' | 'sparkle' | 'list';

const PATHS: Record<IconName, ReactNode> = {
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="7.5" width="16.5" height="12" rx="2.5" />
    <circle cx="16.5" cy="13.5" r="1.2" /></>,
  plate: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /></>,
  fish: <><path d="M3 12c2.5-3.6 6.5-5 10.5-3.6L20 5v14l-6.5-3.4C9.5 17 5.5 15.6 3 12z" /><circle cx="8" cy="11" r=".8" /></>,
  sprout: <><path d="M12 21v-9" /><path d="M12 12c0-3.9-2.9-6.5-7-6.5 0 3.9 2.9 6.5 7 6.5z" />
    <path d="M12 10c0-3.6 2.7-6 6.5-6 0 3.6-2.7 6-6.5 6z" /></>,
  leaf: <><path d="M5 19C5 10.5 10.5 5 19 5c0 8.5-5.5 14-14 14z" /><path d="M5 19l8-8" /></>,
  ban: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5M12 3.5C9.4 5.9 8.2 8.7 8.2 12s1.2 6.1 3.8 8.5" /></>,
  pin: <><path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  cart: <><path d="M3 4h2.2l2.3 10.5h10.3L20 7.5H6.4" /><circle cx="9" cy="19" r="1.4" /><circle cx="16.5" cy="19" r="1.4" /></>,
  utensils: <><path d="M6 3v7a2 2 0 0 0 4 0V3M8 12v9" /><path d="M17 21V3c-2 1.5-3 4-3 7 0 1.6.9 2.6 3 3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  bell: <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  locate: <><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="1.8" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>,
  store: <><path d="M4 9.5L5.5 4h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
    <path d="M5.5 11.5V20h13v-8.5M10 20v-5h4v5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  sparkle: <path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z" />,
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
         strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
