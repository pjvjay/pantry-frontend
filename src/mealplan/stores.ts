// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Check ingredients' "Your stores": how far the shopper goes from where they are (Set up),
// and the stores near them from /mealplan/stores, nearest first, each with its distance, how
// many of the plan's products it sells, and whether the shopper turned it off. The distance
// decides which products are in range (a change checks the products again); a store turned off
// is only skipped (setStoreOff), so it never does. Each store also says what the basket buys
// there (storeSpend, storeLine).
import { placeText } from './basics.ts';
import type { MealBasket, MealStores, PlanSettings, StoreChoice } from '../types.ts';

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
      + `distance, or a Vancouver area in Set up.${nearest}`;
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

// What the basket buys at each store, by the store's name: the products it buys there and what
// they come to. The lines' own costs are summed (each is its recipe's share of the product's whole
// packs, so together they make the basket's total); a line with no cost of its own (an unknown
// amount, covered by the packs the other lines buy) adds none. Only what the plan can buy counts.
export interface StoreSpend {
  products: number;
  cost: number;
}

export function storeSpend(b: MealBasket | null): Map<string, StoreSpend> {
  const out = new Map<string, { ids: Set<number>; cost: number }>();
  for (const r of b?.recipes ?? []) {
    for (const ln of r.lines) {
      if (!ln.available || !ln.store || !ln.product) continue;
      const at = out.get(ln.store.name) ?? { ids: new Set<number>(), cost: 0 };
      at.ids.add(ln.product.id);
      at.cost += ln.cost_for_need ?? 0;
      out.set(ln.store.name, at);
    }
  }
  return new Map([...out].map(([name, at]) => [name, { products: at.ids.size, cost: Math.round(at.cost * 100) / 100 }]));
}

// A store's lines under its name: how far it is and what it sells of the plan's products ("0.3 km ·
// sells 12 of your 15 products"), then what the basket buys there ("about $41.20 of your basket").
// A store turned off says so instead, and one in use that the basket buys nothing at says that (its
// prices are not the lowest for anything the plan needs); with no basket yet, nothing.
export function storeLine(x: Pick<StoreChoice, 'distance_km' | 'sells' | 'off' | 'name'>, total: number,
  spend: ReadonlyMap<string, StoreSpend> | null): { head: string; share: string } {
  const head = `${kmText(x.distance_km)} · ${sellsText(x.sells, total)}`;
  if (x.off) return { head, share: 'turned off: nothing bought here' };
  if (!spend || x.sells === null || !total) return { head, share: '' };
  const at = spend.get(x.name);
  return { head, share: at && at.products > 0 ? `about $${at.cost.toFixed(2)} of your basket` : 'none of your basket' };
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
