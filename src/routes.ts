// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The console's addresses. Every page lives in the hash, so it can be bookmarked, reloaded and
// reached with the browser's Back: four places for the household (Home, Plan, Shop, Ask) and the
// Workshop, where the parts under the hood are.
//
//   #/home                      where the console starts (also an empty hash, and any address it
//                               does not know)
//   #/plan?step=1..6            the meal plan's stages; ?calendar=…&reason=… is Google's return,
//                               which opens Calendar (mealplan/wizard.ts reads the query)
//   #/shop                      the shopping plan on its own
//   #/shop/trip/<YYYY-MM-DD>    one trip, for the shop itself
//   #/ask                       the Assistant
//   #/workshop/<tab>            catalog (the default), provenance, mcp, simulations, metrics,
//                               system, planner (the Planner lab) and about; ?product= and ?trace=
//                               are read by Provenance and Metrics
//
// Every address the console used before still works. ALIASES maps an old path to its new one and
// the query comes along unchanged, every key of it. The shell rewrites an old address in place
// (history.replaceState, never a new history entry), so Back never lands on the old one; a view
// that reads its own query from the hash reads it the same way under either.

import { isCivilDate } from './mealplan/dates.ts';

export type Section = 'home' | 'plan' | 'shop' | 'ask' | 'workshop';

// The Workshop's tabs, in the order its tab bar shows them.
export const WORKSHOP_TABS = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'provenance', label: 'Provenance' },
  { id: 'mcp', label: 'MCP explorer' },
  { id: 'simulations', label: 'Simulations' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'system', label: 'System' },
  { id: 'planner', label: 'Planner lab' },
  { id: 'about', label: 'About' },
] as const;

export type WorkshopTab = (typeof WORKSHOP_TABS)[number]['id'];

export const DEFAULT_WORKSHOP_TAB: WorkshopTab = 'catalog';

// `query` is the part after "?", kept exactly as written (the shell never re-encodes it); absent
// or '' when there is none.
export type Route =
  | { name: 'home'; query?: string }
  | { name: 'plan'; query?: string }
  | { name: 'shop'; query?: string }
  | { name: 'trip'; date: string; query?: string }
  | { name: 'ask'; query?: string }
  | { name: 'workshop'; tab: WorkshopTab; query?: string };

// The household's places, in the primary navigation's order.
export const PRIMARY: readonly { section: Exclude<Section, 'workshop'>; label: string }[] = [
  { section: 'home', label: 'Home' },
  { section: 'plan', label: 'Plan' },
  { section: 'shop', label: 'Shop' },
  { section: 'ask', label: 'Ask' },
];

// Old paths, and where each lives now. The empty path is the bare console address.
export const ALIASES: Readonly<Record<string, string>> = {
  '': 'home',
  overview: 'home',
  mealplan: 'plan',
  planner: 'workshop/planner',
  assistant: 'ask',
  catalog: 'workshop/catalog',
  provenance: 'workshop/provenance',
  mcp: 'workshop/mcp',
  simulations: 'workshop/simulations',
  metrics: 'workshop/metrics',
  system: 'workshop/system',
  workshop: 'workshop/catalog',
};

const SECTIONS: readonly Section[] = ['home', 'plan', 'shop', 'ask', 'workshop'];

// The first path segments an in-page link may start with: today's places and every old one (the
// shell rewrites those). The Assistant draws a card's link only when it leads to one of these.
export const ROUTE_IDS: readonly string[] = [...new Set([...SECTIONS, ...Object.keys(ALIASES)])]
  .filter(Boolean);

const isWorkshopTab = (s: string): s is WorkshopTab => WORKSHOP_TABS.some((t) => t.id === s);

const HOME: Route = { name: 'home' };

// The page an address names. An address the console does not know is Home, with nothing kept
// from it; a known one keeps its query.
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const cut = raw.indexOf('?');
  const path = (cut === -1 ? raw : raw.slice(0, cut)).replace(/\/+$/, '');
  const query = cut === -1 ? '' : raw.slice(cut + 1);
  const [head, ...rest] = (ALIASES[path] ?? path).split('/');
  const q = query ? { query } : {};
  switch (head) {
    case 'home':
    case 'plan':
    case 'shop':
    case 'ask':
      if (rest.length === 0) return { name: head, ...q };
      // a trip that is not a date (or no longer a day at all) is the shopping plan instead
      if (head === 'shop') {
        return rest.length === 2 && rest[0] === 'trip' && isCivilDate(rest[1])
          ? { name: 'trip', date: rest[1], ...q } : { name: 'shop', ...q };
      }
      return HOME;
    case 'workshop':
      // a tab this console does not have opens the first one
      if (rest.length > 1) return HOME;
      return { name: 'workshop', tab: rest[0] && isWorkshopTab(rest[0]) ? rest[0] : DEFAULT_WORKSHOP_TAB, ...q };
    default:
      return HOME;
  }
}

// The address of a page, as the shell writes it.
export function hrefFor(route: Route): string {
  const q = route.query ? `?${route.query}` : '';
  switch (route.name) {
    case 'trip':
      return `#/shop/trip/${route.date}${q}`;
    case 'workshop':
      return `#/workshop/${route.tab}${q}`;
    default:
      return `#/${route.name}${q}`;
  }
}

// The address as the shell would write it: the same text for a current address, the new one for
// an old or unknown address.
export const canonicalHash = (hash: string): string => hrefFor(parseHash(hash));

// Which place in the navigation a page belongs to: a trip is part of Shop.
export const sectionOf = (route: Route): Section => (route.name === 'trip' ? 'shop' : route.name);

export const workshopLabel = (tab: WorkshopTab): string =>
  WORKSHOP_TABS.find((t) => t.id === tab)?.label ?? tab;

// The browser tab's title: the page, then the console's name.
export function titleFor(route: Route): string {
  const app = 'Pantry Planner';
  switch (route.name) {
    case 'workshop':
      return `${workshopLabel(route.tab)} · Workshop · ${app}`;
    case 'trip':
      return `Trip on ${route.date} · Shop · ${app}`;
    default:
      return `${PRIMARY.find((p) => p.section === route.name)?.label ?? 'Home'} · ${app}`;
  }
}
