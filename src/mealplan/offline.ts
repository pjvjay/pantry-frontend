// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// In-store mode's offline copy. The list a shopper ticks off in the store comes from pantry-api's
// schedule answer, and a shop is where the signal fails: so the trips the shopper approved, as the
// last answer for the plan had them, are kept in this browser (pantry.offline.v1), and in-store
// mode opens on that copy while no answer has come, saying when it was made. A fresh answer always
// wins: the copy is only ever drawn while there is none.
//
// The copy is never the plan. It sits beside it under its own key, is written only from an answer
// for the plan as it is (its id and rev), and is used only while the plan still has that id and
// rev: a plan edited since, another plan, or a copy this console did not write reads as no copy.
// Only approved trips are kept (an approved list is never rewritten, so it is the list to shop
// from), each under the way to shop it was approved under, as in-store mode shows it (board.ts
// tripToShop), and only what in-store mode reads of them, so one plan's copy stays small; one plan is
// kept, and a copy that would still be larger than OFFLINE_MAX_CHARS is not written at all. A
// browser that refuses storage simply has no copy: nothing else depends on it.
import { strategyOf, tripToShop } from './board.ts';
import type { CivilDate } from './dates.ts';
import { dayLabel } from './dates.ts';
import type { StorageLike } from './persist.ts';
import type { MealPlanDraft, MealSchedule, Trip, TripLine, TripStrategy } from '../types.ts';

export const OFFLINE_KEY = 'pantry.offline.v1';
// About 200 kB of text: a fortnight's approved trips are a few tens of kB once trimmed.
export const OFFLINE_MAX_CHARS = 200_000;

export interface OfflineCopy {
  id: string;                      // the plan's id
  rev: number;                     // the plan's rev the answer was for
  strategy: TripStrategy;          // the way to shop the trips are for
  at: string;                      // when the answer was kept (ISO)
  trips: Trip[];                   // the approved trips, trimmed to what in-store mode reads
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STRATEGIES: readonly TripStrategy[] = ['fresh', 'fewest_trips'];

// A line as in-store mode reads it (mealplan/shoplist.ts shopRows): the product, its store and
// section, how many and what they cost, which recipes it is for, whether to freeze it, whether it
// is stocked and where it comes from (so a row still says "check the label" in a shop with no
// signal). What only the trip sheet shows (storage times and their sources, leftovers, price
// changes) is left out. A line from an older API, which says nothing of its origin, keeps saying
// nothing.
function trimLine(ln: TripLine): TripLine {
  const o = ln.origin;
  return {
    product: { id: ln.product.id, name: ln.product.name, unit_size: ln.product.unit_size,
      category: ln.product.category, demo_product: ln.product.demo_product },
    category: ln.category, packs: ln.packs, packs_basis: ln.packs_basis, need_qty: ln.need_qty, need_uom: ln.need_uom,
    leftover_qty: null, leftover_until: null, storage: ln.storage, freeze_on_arrival: ln.freeze_on_arrival,
    shelf_life: { status: ln.shelf_life.status, verbatim: [], rule_ids: [], source: null, url: null, page_date: null,
      days_planned: null, note: '' },
    for_meals: ln.for_meals.map((m) => ({ meal_id: m.meal_id, recipe_key: m.recipe_key, title: m.title, date: m.date,
      slot: m.slot })),
    store: ln.store, price: ln.price, price_at_approval: null, price_delta: null, stocked: ln.stocked,
    ...(o ? { origin: { country: o.country, claim: o.claim, status: o.status, preferred_rank: o.preferred_rank } } : {}),
  };
}

function trimTrip(t: Trip): Trip {
  return {
    id: t.id, date: t.date, status: t.status, reason: '', lines: t.lines.map(trimLine), dismissed: [], stores: [...t.stores],
    recommended: null, frontier: [], not_stocked: [...t.not_stocked], total_cost: t.total_cost,
    total_is_floor: t.total_is_floor, price_delta: null, fingerprint: t.fingerprint, diff: null, list_text: '',
  };
}

// The copy an answer gives the plan, or null when there is nothing to keep: an answer for another
// rev, or no approved trip.
export function copyOf(answer: MealSchedule, d: MealPlanDraft, at: string): OfflineCopy | null {
  if (answer.rev !== d.rev) return null;
  // every day with a trip under the way to shop shown, or with an approval, as in-store mode takes it
  const days = new Set([...(strategyOf(answer, d.prefs.strategy)?.trips ?? []).map((t) => t.date),
    ...d.trips.map((a) => a.date)]);
  const trips = [...days].sort().map((date) => tripToShop(answer, d, date))
    .filter((t): t is Trip => t !== null && t.status !== 'suggested');
  if (!trips.length) return null;
  return { id: d.id, rev: d.rev, strategy: d.prefs.strategy, at, trips: trips.map(trimTrip) };
}

// What makes two copies the same list, without comparing every line in full: the plan, its rev,
// the way to shop, each trip's own fingerprint and state, and where each line's product comes
// from. The fingerprint leaves the origin out (evidence that comes in later never asks the shopper
// to look at an approved trip again), so a copy kept before its lines said where they come from,
// or before that evidence changed, is replaced by the next answer rather than kept as it is.
const originKey = (ln: TripLine) => (ln.origin ? `${ln.origin.status}:${ln.origin.country ?? ''}` : '-');

export function copyKey(c: OfflineCopy | null): string {
  if (!c) return '';
  return [c.id, c.rev, c.strategy,
    ...c.trips.map((t) => `${t.date}:${t.status}:${t.fingerprint}:${t.lines.map(originKey).join(',')}`)].join('|');
}

// ─── Reading what was stored ─────────────────────────────────

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const numOrNull = (x: unknown) => x === null || isNum(x);
const strOrNull = (x: unknown) => x === null || typeof x === 'string';

const ORIGIN_STATES: readonly unknown[] = ['evidenced', 'unknown', 'conflicting'];

// A stored origin: none at all (an older API's line), or one its tag can read.
const originOk = (o: unknown) => o === undefined || o === null
  || (isObj(o) && strOrNull(o.country) && typeof o.claim === 'string' && ORIGIN_STATES.includes(o.status)
    && numOrNull(o.preferred_rank));

// A stored line in-store mode can draw without tripping over it.
function lineOk(x: unknown): boolean {
  if (!isObj(x) || !isObj(x.product)) return false;
  const p = x.product;
  return isNum(p.id) && typeof p.name === 'string' && typeof p.unit_size === 'string'
    && numOrNull(x.packs) && numOrNull(x.price) && numOrNull(x.need_qty) && strOrNull(x.need_uom)
    && strOrNull(x.store) && strOrNull(x.category) && typeof x.stocked === 'boolean'
    && typeof x.freeze_on_arrival === 'boolean' && Array.isArray(x.for_meals)
    && x.for_meals.every((m) => isObj(m) && typeof m.title === 'string')
    && isObj(x.shelf_life) && originOk(x.origin);
}

function tripOk(x: unknown): boolean {
  return isObj(x) && typeof x.id === 'string' && typeof x.date === 'string' && DATE.test(x.date)
    && (x.status === 'approved' || x.status === 'needs_review') && Array.isArray(x.stores)
    && x.stores.every((s) => typeof s === 'string') && Array.isArray(x.lines) && x.lines.every(lineOk)
    && numOrNull(x.total_cost) && typeof x.total_is_floor === 'boolean' && typeof x.fingerprint === 'string'
    && Array.isArray(x.not_stocked);
}

// The copy in a stored value; null for anything this console did not write, or damaged.
export function parseOffline(raw: string | null): OfflineCopy | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || data.v !== 1 || !isObj(data.copy)) return null;
  const c = data.copy;
  if (typeof c.id !== 'string' || !c.id || !isNum(c.rev) || !STRATEGIES.includes(c.strategy as TripStrategy)
    || typeof c.at !== 'string' || Number.isNaN(Date.parse(c.at)) || !Array.isArray(c.trips) || !c.trips.every(tripOk)) {
    return null;
  }
  return c as unknown as OfflineCopy;
}

export function readOffline(storage: StorageLike | null): OfflineCopy | null {
  if (!storage) return null;
  try {
    return parseOffline(storage.getItem(OFFLINE_KEY));
  } catch {
    return null;
  }
}

// Keeps the copy (or, with null, keeps none). False when the browser would not, or the copy is
// larger than the cap: in-store mode then has no copy, and nothing else changes.
export function writeOffline(storage: StorageLike | null, copy: OfflineCopy | null): boolean {
  if (!storage) return false;
  const text = JSON.stringify({ v: 1, copy });
  if (text.length > OFFLINE_MAX_CHARS) return false;
  try {
    storage.setItem(OFFLINE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

// ─── Using it ────────────────────────────────────────────────

// The trip on `date` from the copy, when the copy is this plan's as it is now (its id and rev, so
// the way to shop is the same too); else null.
export function offlineTrip(copy: OfflineCopy | null, d: MealPlanDraft, date: CivilDate): Trip | null {
  if (!copy || copy.id !== d.id || copy.rev !== d.rev || copy.strategy !== d.prefs.strategy) return null;
  return copy.trips.find((t) => t.date === date) ?? null;
}

const twoDigits = (n: number) => String(n).padStart(2, '0');

// When the copy was made, as the shopper's clock reads it: "9:41 PM" today, else "Wed 11 Nov,
// 9:41 PM". `now` is the moment it is read.
export function copiedAt(at: string, now: Date): string {
  const t = new Date(at);
  const h = t.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${twoDigits(t.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
  const day = `${t.getFullYear()}-${twoDigits(t.getMonth() + 1)}-${twoDigits(t.getDate())}`;
  const today = `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
  return day === today ? time : `${dayLabel(day)}, ${time}`;
}
