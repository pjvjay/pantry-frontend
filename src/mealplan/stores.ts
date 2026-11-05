// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The Ingredients stage's "Your stores": how far the shopper goes from where they are (Basics),
// and the stores near them from /mealplan/stores, nearest first, each with its distance, how
// many of the plan's products it sells, and whether the shopper turned it off. The distance
// decides which products are in range (a change checks the products again); a store turned off
// is only skipped (setStoreOff), so it never does.
import { placeText } from './basics.ts';
import type { MealStores, PlanSettings, StoreChoice } from '../types.ts';

// How far the shopper goes; null is any distance.
export const DISTANCES: readonly (number | null)[] = [2, 5, 10, 25, null];

export const distanceLabel = (km: number | null): string => (km === null ? 'Any' : `${km} km`);

// The choices shown: the usual ones, and a plan's own distance among them when it is another.
export function distanceChoices(current: number | null | undefined): (number | null)[] {
  const c = current ?? null;
  if (DISTANCES.includes(c)) return [...DISTANCES];
  return [...DISTANCES.filter((x) => x !== null), c as number, null].sort((a, b) =>
    (a === null ? 1 : b === null ? -1 : a - b));
}

export const kmText = (km: number | null): string =>
  (km === null ? 'distance unknown' : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

export interface StoresView {
  inRange: StoreChoice[];
  farther: StoreChoice[];
  on: number;                      // stores in range the shopper left on
  warning: string | null;
}

const byDistance = (a: StoreChoice, b: StoreChoice) =>
  (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity) || a.id - b.id;

// The stores as the panel lists them, and the warning when the plan can buy nowhere: no store
// within the distance (the demo's are all in Vancouver), or every one there turned off.
export function storesView(a: MealStores, st: PlanSettings): StoresView {
  const all = [...a.stores].sort(byDistance);
  const inRange = all.filter((s) => s.in_range);
  const farther = all.filter((s) => !s.in_range);
  const on = inRange.filter((s) => !s.off).length;
  let warning: string | null = null;
  if (!inRange.length) {
    const within = st.max_km == null ? 'at any distance' : `within ${distanceLabel(st.max_km)}`;
    const nearest = farther[0] ? ` The nearest is ${farther[0].name}, ${kmText(farther[0].distance_km)} away.` : '';
    warning = `No store ${within} of ${placeText(st)}. The demo's stores are all in Vancouver: choose a longer `
      + `distance, or a Vancouver area in Basics.${nearest}`;
  } else if (!on) {
    warning = 'Every store in range is turned off, so the plan can buy nothing: turn one back on.';
  }
  return { inRange, farther, on, warning };
}

// "sells 12 of your 15 products"
export function sellsText(sells: number | null, total: number): string {
  if (sells === null) return 'not checked yet';
  if (!total) return 'no products chosen yet';
  return sells ? `sells ${sells} of your ${total} ${total === 1 ? 'product' : 'products'}`
    : `sells none of your ${total} ${total === 1 ? 'product' : 'products'}`;
}

// The panel's line: "3 of 4 stores in use within 5 km".
export function storesLine(v: StoresView, st: PlanSettings): string {
  const within = st.max_km == null ? 'at any distance' : `within ${distanceLabel(st.max_km)}`;
  const n = v.inRange.length;
  if (!n) return `No stores ${within}`;
  return v.on === n ? `${n} ${n === 1 ? 'store' : 'stores'} ${within}, all in use`
    : `${v.on} of ${n} stores ${within} in use`;
}

// The distance that takes in a store `km` away: the first usual choice past the plan's and at
// least that far, else any distance (null); with `km` unknown, the next one up. undefined when
// the plan already goes any distance.
export function widerDistance(current: number | null | undefined, km: number | null): number | null | undefined {
  if (current == null) return undefined;
  const next = DISTANCES.find((d) => d !== null && d > current && (km === null || d >= km));
  return next === undefined ? null : next;
}
