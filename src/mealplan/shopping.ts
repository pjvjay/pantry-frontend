// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// What the shopper has put in the basket in the store (in-store mode, #/shop/trip/<date>): for
// each plan, for each trip's date, the products ticked off. A tick is not an edit of the plan: it
// is kept beside it, in this browser under pantry.shopping.v1, so ticking never gives the plan a
// new revision, never sends it to be scheduled again and never lands in its undo history (Ctrl+Z
// on the plan does not take a product out of the basket). Keyed by the plan's id, so a new plan
// starts with an empty basket and an older one keeps its own.
//
// Ticks are kept for products, not for lines: one product is one thing to pick up, however many
// lines of the trip buy it (mealplan/shoplist.ts draws it as one row). They are never thrown away
// because the plan changed under them: a trip that changes keeps the ticks of the products still
// on it, and a strategy switched and switched back finds its ticks again. Only a date no longer
// among the plan's days is dropped (pruneShopping), and the plans used longest ago once more than
// SHOPPING_PLANS are kept.
import type { CivilDate } from './dates.ts';
import type { StorageLike } from './persist.ts';

export const SHOPPING_KEY = 'pantry.shopping.v1';
// The plans whose baskets are kept, the latest used last: more than anyone shops from at once.
export const SHOPPING_PLANS = 5;

export interface PlanBasket {
  id: string;                                // the plan's id
  trips: Record<CivilDate, number[]>;        // a trip's date: the product ids ticked, ascending
}

export interface ShoppingState {
  v: 1;
  plans: PlanBasket[];                       // the latest used last
}

export const emptyShopping = (): ShoppingState => ({ v: 1, plans: [] });

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isId = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0;
const sortedIds = (ids: Iterable<number>) => [...new Set(ids)].sort((a, b) => a - b);

// The state in a stored value, keeping only what this console wrote: a value that is not ours, or
// is damaged, reads as an empty basket rather than an error.
export function parseShopping(raw: string | null): ShoppingState {
  if (!raw) return emptyShopping();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyShopping();
  }
  if (typeof data !== 'object' || data === null || (data as { v?: unknown }).v !== 1) return emptyShopping();
  const plans = (data as { plans?: unknown }).plans;
  if (!Array.isArray(plans)) return emptyShopping();
  const out: PlanBasket[] = [];
  for (const p of plans) {
    if (typeof p !== 'object' || p === null) continue;
    const { id, trips } = p as { id?: unknown; trips?: unknown };
    if (typeof id !== 'string' || !id || out.some((x) => x.id === id)) continue;
    if (typeof trips !== 'object' || trips === null || Array.isArray(trips)) continue;
    const kept: Record<CivilDate, number[]> = {};
    for (const [date, ids] of Object.entries(trips as Record<string, unknown>)) {
      if (!DATE.test(date) || !Array.isArray(ids)) continue;
      const good = sortedIds(ids.filter(isId));
      if (good.length) kept[date] = good;
    }
    out.push({ id, trips: kept });
  }
  return { v: 1, plans: out.slice(-SHOPPING_PLANS) };
}

// What this browser holds; an empty basket when storage is off, refuses or holds something else.
export function readShopping(storage: StorageLike | null): ShoppingState {
  if (!storage) return emptyShopping();
  try {
    return parseShopping(storage.getItem(SHOPPING_KEY));
  } catch {
    return emptyShopping();
  }
}

// False when the browser would not keep it: the page keeps the ticks for itself meanwhile.
export function writeShopping(storage: StorageLike | null, s: ShoppingState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SHOPPING_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

// The products ticked on a plan's trip, ascending.
export function tickedOn(s: ShoppingState, planId: string, date: CivilDate): number[] {
  return [...(s.plans.find((p) => p.id === planId)?.trips[date] ?? [])];
}

// The state with a product put in the basket (on) or taken out of it, the plan moved to the end
// as the latest used. A trip left with nothing ticked is dropped, and a plan left with no trips.
export function setTicked(s: ShoppingState, planId: string, date: CivilDate, productId: number, on: boolean)
  : ShoppingState {
  if (!isId(productId) || !DATE.test(date)) return s;
  const mine = s.plans.find((p) => p.id === planId);
  const now = mine?.trips[date] ?? [];
  if (now.includes(productId) === on) return s;
  const ids = on ? sortedIds([...now, productId]) : now.filter((x) => x !== productId);
  const trips = { ...(mine?.trips ?? {}) };
  if (ids.length) trips[date] = ids;
  else delete trips[date];
  const others = s.plans.filter((p) => p.id !== planId);
  const plans = Object.keys(trips).length ? [...others, { id: planId, trips }] : others;
  return { v: 1, plans: plans.slice(-SHOPPING_PLANS) };
}

// The state without the dates of a plan that are no longer among its days (a shorter plan, or
// one moved to other dates). The same object when there is nothing to drop.
export function pruneShopping(s: ShoppingState, planId: string, days: readonly CivilDate[]): ShoppingState {
  const mine = s.plans.find((p) => p.id === planId);
  if (!mine) return s;
  const keep = new Set(days);
  const gone = Object.keys(mine.trips).filter((d) => !keep.has(d));
  if (!gone.length) return s;
  const trips = Object.fromEntries(Object.entries(mine.trips).filter(([d]) => keep.has(d)));
  const plans = s.plans.map((p) => (p.id === planId ? { id: planId, trips } : p))
    .filter((p) => Object.keys(p.trips).length > 0);
  return { v: 1, plans };
}
