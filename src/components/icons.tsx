// The console's small line icons: 24-unit strokes in currentColor, so they take the text's colour
// in light and dark alike, and render the same on every system (an emoji or a symbol character
// does not). Decorative by default (aria-hidden): an icon sits beside words that say the same, or
// inside a control whose aria-label does. Where an icon stands alone for a state, pair it with
// words for screen readers (a .sr-only span) or a label.
import type { ReactNode } from 'react';

export type IconName =
  | 'calendar' | 'wallet' | 'plate' | 'fish' | 'sprout' | 'leaf' | 'ban' | 'globe' | 'pin' | 'cart'
  | 'utensils' | 'clock' | 'bell' | 'search' | 'locate' | 'store' | 'check' | 'sparkle' | 'list' | 'cup' | 'bowl'
  | 'apple' | 'alert' | 'map'
  // the shell and its places
  | 'home' | 'plan' | 'bag' | 'chat' | 'wrench' | 'settings' | 'user'
  // the theme menu
  | 'sun' | 'moon' | 'monitor'
  // directions and actions
  | 'chevron-left' | 'chevron-right' | 'chevron-down' | 'arrow-left' | 'arrow-right' | 'x' | 'plus' | 'minus'
  | 'undo' | 'refresh' | 'copy' | 'printer' | 'external' | 'more' | 'grip' | 'play' | 'stop' | 'pause'
  // states and marks
  | 'info' | 'circle-check' | 'circle-dashed' | 'circle-x' | 'dot' | 'exclaim' | 'star' | 'pushpin'
  // a service that is not there: the demo hub, unplugged
  | 'plug'
  // what a day's plan does: freeze, thaw, cook
  | 'snowflake' | 'droplet' | 'pan'
  // the meal plan's ways in and its board (phase 2); Ask's recipe import uses 'link' too
  | 'redo' | 'link' | 'clipboard'
  // how sure a match is (works instead, a looser match, not known) and the calendar file (phase 6)
  | 'swap' | 'approx' | 'help' | 'download'
  // Ask: send a message, a new reply further down
  | 'send' | 'arrow-down';

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
  cup: <><path d="M4.5 9h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" /><path d="M15.5 10.5h1.2a2.6 2.6 0 0 1 0 5.2h-1.6" />
    <path d="M8 3.5c-.6 1 .6 1.8 0 3M11.5 3.5c-.6 1 .6 1.8 0 3M4 21h14" /></>,
  bowl: <><path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0z" /><path d="M9 20.5h6" />
    <path d="M8.5 8.5c-.6-1.2.6-2 0-3.5M12 8.5c-.6-1.2.6-2 0-3.5M15.5 8.5c-.6-1.2.6-2 0-3.5" /></>,
  apple: <><path d="M12 8c-1.7-1.3-4.3-1.4-6 .1-2.5 2.2-2 7 .3 10.2 1.3 1.8 2.9 2.9 4.2 2.2.9-.5 2.1-.5 3 0 1.3.7 2.9-.4 4.2-2.2C20 15.1 20.5 10.3 18 8.1c-1.7-1.5-4.3-1.4-6-.1z" />
    <path d="M12 8c0-2.2.9-3.8 2.8-4.8" /></>,
  alert: <><path d="M10.3 4.4a2 2 0 0 1 3.4 0l7.4 12.8a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z" /><path d="M12 9.5v4.2M12 16.8h.01" /></>,
  map: <><path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></>,

  home: <><path d="M3.5 11L12 4l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5.5h4V20" /></>,
  plan: <><rect x="4.5" y="4.5" width="15" height="16.5" rx="2.5" /><rect x="9" y="3" width="6" height="3.5" rx="1" />
    <path d="M8.5 12.5l2 2 4.5-4.5M8.5 17.5h7" /></>,
  bag: <><path d="M5.5 8h13l-.9 11.2a1.5 1.5 0 0 1-1.5 1.3H7.9a1.5 1.5 0 0 1-1.5-1.3z" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>,
  chat: <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16h-6l-4.5 4v-4H7a2.5 2.5 0 0 1-2.5-2.5z" />,
  wrench: <path d="M17.1 4.5A5 5 0 0 0 10.5 11.2L5.7 16a1.6 1.6 0 0 0 2.3 2.3l4.8-4.8A5 5 0 0 0 19.5 6.9L17 9.4l-2.4-2.4z" />,
  settings: <><path d="M10 5.3l.6-2.4h2.8l.6 2.4 1.3.5 2.1-1.2 2 2-1.2 2.1.5 1.3 2.4.6v2.8l-2.4.6-.5 1.3 1.2 2.1-2 2-2.1-1.2-1.3.5-.6 2.4h-2.8l-.6-2.4-1.3-.5-2.1 1.2-2-2 1.2-2.1-.5-1.3-2.4-.6v-2.8l2.4-.6.5-1.3-1.2-2.1 2-2 2.1 1.2z" />
    <circle cx="12" cy="12" r="3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,

  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z" />,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20.5h7M12 16.5v4" /></>,

  'chevron-left': <path d="M14.5 6l-6 6 6 6" />,
  'chevron-right': <path d="M9.5 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  'arrow-left': <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />,
  'arrow-right': <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  undo: <><path d="M9 14.5L4.5 10 9 5.5" /><path d="M4.5 10H14a5.5 5.5 0 0 1 0 11h-3" /></>,
  refresh: <><path d="M20 11.5A8 8 0 0 0 5.6 7" /><path d="M4 12.5A8 8 0 0 0 18.4 17" /><path d="M5 3v4h4M19 21v-4h-4" /></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></>,
  printer: <><path d="M7 9V3.5h10V9" /><rect x="3.5" y="9" width="17" height="8" rx="2" /><path d="M7 14.5h10V21H7z" /></>,
  external: <><path d="M13.5 4.5h6v6M19.5 4.5L11 13" /><path d="M17.5 13.5v4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h4" /></>,
  more: <><circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  grip: <><circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.5" fill="currentColor" stroke="none" /></>,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  pause: <path d="M9 6v12M15 6v12" />,

  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8h.01" /></>,
  'circle-check': <><circle cx="12" cy="12" r="8.5" /><path d="M8.2 12.3l2.6 2.6 5-5.2" /></>,
  'circle-dashed': <circle cx="12" cy="12" r="8.5" strokeDasharray="3.3 3.38" />,
  'circle-x': <><circle cx="12" cy="12" r="8.5" /><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" /></>,
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
  exclaim: <path d="M12 5.5v8.5M12 18.5h.01" />,
  star: <path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z" />,
  pushpin: <><path d="M9 3.5h6l-1 5.5 3 3.5H7l3-3.5z" /><path d="M12 12.5V21" /></>,
  plug: <><path d="M9 3.5V8M15 3.5V8" /><path d="M6.5 8h11v2.5a5.5 5.5 0 0 1-11 0z" /><path d="M12 16v4.5" /></>,

  snowflake: <><path d="M12 3v18M19.8 7.5L4.2 16.5M19.8 16.5L4.2 7.5" />
    <path d="M14.3 3.6L12 5.8 9.7 3.6M20.4 9.8l-3-.9.7-3.1M18.1 18.2l-.7-3.1 3-.9M9.7 20.4l2.3-2.2 2.3 2.2M3.6 14.2l3 .9-.7 3.1M5.9 5.8l.7 3.1-3 .9" /></>,
  droplet: <path d="M12 3.5s-6 6.6-6 10.8a6 6 0 0 0 12 0C18 10.1 12 3.5 12 3.5z" />,
  pan: <><circle cx="9.5" cy="12.5" r="6.5" /><circle cx="9.5" cy="12.5" r="2.2" /><path d="M16 12.5h5.5" /></>,

  redo: <><path d="M15 14.5l4.5-4.5L15 5.5" /><path d="M19.5 10H10a5.5 5.5 0 0 0 0 11h3" /></>,
  link: <><path d="M10 13.5a4.5 4.5 0 0 0 6.8.5l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5" />
    <path d="M14 10.5a4.5 4.5 0 0 0-6.8-.5l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5" /></>,
  clipboard: <><rect x="5" y="4.5" width="14" height="16.5" rx="2.5" /><rect x="9" y="3" width="6" height="3.5" rx="1" />
    <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" /></>,

  swap: <><path d="M4.5 8.5h14M15 5l3.5 3.5L15 12" /><path d="M19.5 15.5h-14M9 12l-3.5 3.5L9 19" /></>,
  approx: <><path d="M5 9.5c2.3-2.2 4.6-2.2 7 0s4.7 2.2 7 0" /><path d="M5 15c2.3-2.2 4.6-2.2 7 0s4.7 2.2 7 0" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01" /></>,
  download: <><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" /></>,

  send: <><path d="M20.5 3.5L10.5 13.5" /><path d="M20.5 3.5l-6.3 17-3.7-7-7-3.7z" /></>,
  'arrow-down': <path d="M12 4.5v15M6 13.5l6 6 6-6" />,
};

// className adds to "ico": "ico-inline" sits the icon in a line of text, sized to the text.
export function Icon({ name, size = 20, strokeWidth = 1.8, className }: {
  name: IconName; size?: number; strokeWidth?: number; className?: string;
}) {
  return (
    <svg className={className ? `ico ${className}` : 'ico'} viewBox="0 0 24 24" width={size} height={size}
         fill="none" stroke="currentColor"
         strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
