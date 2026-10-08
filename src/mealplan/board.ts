// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// What the meal-plan views draw, decided without the browser: which meals sit in which cell,
// how a trip chip and a trip line read, a trip as the chat's cart card, the summary line, and
// a Planner week opened as a meal plan. Every price, storage time and pack count shown comes
// from the last schedule answer; a null stays "unknown" and a total with an unknown price is
// "at least".
import { dayLabel } from './dates.ts';
import type { CivilDate } from './dates.ts';
import {
  CAPACITY, SLOT_LABELS, cellKey, libraryRef, mealsOf, newPlan, occupants, placedCount, recipeTitle,
  step, windowDates, windowOf,
} from './model.ts';
import type { MealPlanState, PlanEdit, Slot } from './model.ts';
import type {
  CartLine, CartSummary, Meal, MealSchedule, StrategyResult, Trip, TripLine, TripStrategy,
} from '../types.ts';

export const money = (v: number): string => `$${v.toFixed(2)}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ─── Cells ───────────────────────────────────────────────────

// The meals in each cell, keyed as the cells' data-drop attribute ('slot|date|slot').
export function mealsByCell(s: MealPlanState): Map<string, Meal[]> {
  const out = new Map<string, Meal[]>();
  for (const m of s.draft.meals) {
    if (m.date === null || m.slot === null) continue;
    const k = cellKey(m.date, m.slot);
    out.set(k, [...(out.get(k) ?? []), m]);
  }
  return out;
}

// The slot rows a day card draws. With hideEmpty, a slot that holds no meal on any day is left
// out, unless it is the only one switched on.
export function shownSlots(s: MealPlanState, hideEmpty: boolean): Slot[] {
  const on = s.draft.prefs.slots_on;
  if (!hideEmpty) return [...on];
  const used = new Set(s.draft.meals.filter((m) => m.date !== null).map((m) => m.slot));
  const shown = on.filter((sl) => used.has(sl));
  return shown.length ? shown : [...on];
}

export interface TrayRow {
  key: string;
  title: string;
  wanted: number;
  placed: number;
  waiting: Meal[];                 // in the tray, held there
  slot: Slot;
}

export function trayRows(s: MealPlanState): TrayRow[] {
  const d = s.draft;
  return Object.entries(d.recipes).map(([key, r]) => ({
    key, title: recipeTitle(s, key), wanted: r.wanted, placed: placedCount(d, key),
    waiting: mealsOf(d, key).filter((m) => m.date === null), slot: r.slot,
  }));
}

// ─── Trips ───────────────────────────────────────────────────

export const strategyOf = (sc: MealSchedule | null, name: TripStrategy): StrategyResult | undefined =>
  sc?.strategies.find((st) => st.name === name);

export function tripsByDate(st: StrategyResult | undefined): Map<CivilDate, Trip> {
  return new Map((st?.trips ?? []).map((t) => [t.date, t]));
}

export interface TripLook {
  kind: 'suggested' | 'approved' | 'review';
  mark: string;                    // a sign beside the word, so the state is never colour only
  word: string;
}

export function tripLook(t: Trip): TripLook {
  if (t.status === 'approved') return { kind: 'approved', mark: '✓', word: 'Approved' };
  if (t.status === 'needs_review') return { kind: 'review', mark: '⚠', word: 'Changed since approved' };
  return { kind: 'suggested', mark: '', word: 'Suggested' };
}

const diffSize = (t: Trip) =>
  (t.diff ? t.diff.added.length + t.diff.removed.length + t.diff.changed.length : 0);

// "Suggested · 2 stores · at least $41.20 · 14 items", or "⚠ Changed since approved (3 changes) · …".
export function tripChipText(t: Trip): string {
  const look = tripLook(t);
  const head = look.kind === 'review' && diffSize(t)
    ? `${look.mark} ${look.word} (${plural(diffSize(t), 'change', 'changes')})`
    : `${look.mark ? `${look.mark} ` : ''}${look.word}`;
  const cost = `${t.total_is_floor ? 'at least ' : ''}${money(t.total_cost)}`;
  return [head, plural(t.stores.length, 'store', 'stores'), cost, plural(t.lines.length, 'item', 'items')]
    .join(' · ');
}

// A price change since approval, which never changes the trip's status: "+$1.20 since you
// approved (demo prices)".
export function priceDeltaText(delta: number | null | undefined): string | null {
  if (typeof delta !== 'number' || Math.abs(delta) < 0.005) return null;
  return `${delta > 0 ? '+' : '−'}${money(Math.abs(delta))} since you approved (demo prices)`;
}

// "Pepperoni Pizza (Mon 12 Oct, Sat 17 Oct), Chicken Biryani (Sun 11 Oct)"
export function forMealsText(ln: TripLine): string {
  const byTitle = new Map<string, string[]>();
  for (const m of ln.for_meals) byTitle.set(m.title, [...(byTitle.get(m.title) ?? []), dayLabel(m.date)]);
  const parts = [...byTitle.entries()].map(([title, days]) => `${title} (${days.join(', ')})`);
  return `for ${plural(ln.for_meals.length, 'meal', 'meals')}: ${parts.join(', ')}`;
}

// How many to buy, and on whose word.
export function packsText(ln: TripLine): string {
  if (ln.packs_basis === 'needs_servings') return 'amount unknown until you say how many the recipe serves';
  if (ln.packs === null) return 'amount unknown';
  const n = plural(ln.packs, 'pack', 'packs');
  return ln.packs_basis === 'your_setting' ? `${n} (set by you)` : n;
}

export function needText(ln: TripLine): string | null {
  if (ln.need_qty === null || !ln.need_uom) return null;
  const q = Number.isInteger(ln.need_qty) ? String(ln.need_qty) : ln.need_qty.toFixed(1);
  return `need ${q} ${ln.need_uom}`;
}

// How long it keeps, on whose word: a cited time with its source, the shopper's setting named
// as theirs, or unknown.
export function shelfText(ln: TripLine): { text: string; level: 'cited' | 'yours' | 'unknown' } {
  const sl = ln.shelf_life;
  if (sl.status === 'cited') {
    const said = sl.verbatim.length ? sl.verbatim.join('; ') : `${sl.days_planned ?? '?'} days`;
    return { level: 'cited', text: `keeps ${said} in the ${ln.storage}${sl.source ? ` (${sl.source})` : ''}` };
  }
  if (sl.status === 'your_setting') {
    return { level: 'yours', text: `storage time not cited: bought at most ${sl.days_planned ?? '?'} `
      + 'days ahead (your setting)' };
  }
  return { level: 'unknown', text: 'storage time unknown' };
}

// The line's warning for the cart card, or undefined when nothing is unknown about it.
export function lineWarn(ln: TripLine): string | undefined {
  const warns: string[] = [];
  if (!ln.stocked) warns.push('no longer stocked in range');
  if (ln.packs === null) warns.push('amount unknown');
  if (ln.price === null && ln.stocked) warns.push('price unknown');
  if (ln.shelf_life.status === 'unknown' && ln.storage !== 'pantry') warns.push('storage time unknown');
  return warns.length ? warns.join(' · ') : undefined;
}

// A trip as the chat's cart card draws a plan: one group per store in the trip's order, each
// line with its meals and anything unknown about it. The total is the known prices (the
// trip's own total_cost) plus the trip's travel, and "at least" when a price is unknown.
export function tripToCartSummary(t: Trip): CartSummary {
  const lines: CartLine[] = t.lines.map((ln) => ({
    ingredient: ln.product.name,
    product: `${ln.product.name}${ln.product.demo_product ? ' (demo)' : ''}`,
    product_id: ln.product.id,
    store: ln.store ?? 'Not stocked within range',
    price: ln.price ?? undefined,
    packs: ln.packs ?? undefined,
    size: ln.product.unit_size,
    note: [forMealsText(ln), ln.freeze_on_arrival ? 'freeze on arrival' : null].filter(Boolean).join(' · '),
    warn: lineWarn(ln),
  }));
  const travel = t.recommended?.travel_cost;
  return {
    recipe_name: `Shopping trip ${dayLabel(t.date)}`,
    lines,
    total_cost: t.total_cost,
    total_is_floor: t.total_is_floor,
    trip: { stores: t.stores, basket_cost: t.total_cost, travel_cost: travel,
      total_cost: t.total_cost + (travel ?? 0) },
  };
}

// ─── Summary ─────────────────────────────────────────────────

// "15 meals · 11 placed · 2 trips (1 approved) · at least $142.10"
export function summaryLine(s: MealPlanState, sc: MealSchedule | null): string {
  const d = s.draft;
  const placed = d.meals.filter((m) => m.date !== null).length;
  const parts = [plural(d.meals.length, 'meal', 'meals'), `${placed} placed`];
  const st = strategyOf(sc, d.prefs.strategy);
  if (st) {
    const approved = st.trips.filter((t) => t.status !== 'suggested').length;
    parts.push(`${plural(st.trips.length, 'trip', 'trips')}${approved ? ` (${approved} approved)` : ''}`);
    if (st.trips.length) parts.push(`${st.total_is_floor ? 'at least ' : ''}${money(st.total_cost)}`);
  }
  return parts.join(' · ');
}

// ─── The Planner's week, opened as a meal plan ───────────────

export interface WeekDinner {
  slug: string;
  name: string;
}

// A week of dinners from the Planner as meals: one dinner a day from the plan's first day, in
// the week's order. 'replace' starts a new plan from tomorrow; 'add' keeps the plan and puts
// each dinner on the first free dinner, or in the tray when none is free. One edit for undo.
export function weekEdit(s: MealPlanState, dinners: WeekDinner[], mode: 'replace' | 'add',
  today: CivilDate, id: string): { edit: PlanEdit; said: string; trayed: number } | { refused: string } {
  if (!dinners.length) return { refused: 'the week has no dinners' };
  let next = mode === 'replace'
    ? newPlan(today, id, dinners.length > 7 ? 14 : 7)
    : s;
  if (mode === 'replace' && s.draft.nutrition_targets) {
    next = { ...next, draft: { ...next.draft, nutrition_targets: s.draft.nutrition_targets } };
  }
  if (mode === 'replace') {
    next = { ...next, draft: { ...next.draft, prefs: s.draft.prefs, settings: s.draft.settings } };
  }
  let trayed = 0;
  const problems: string[] = [];
  for (const dinner of dinners) {
    const ref = libraryRef(dinner.slug);
    const r = next.draft.recipes[ref.key];
    const out = r
      ? step(next, { type: 'setWanted', key: ref.key, wanted: r.wanted + 1 })
      : step(next, { type: 'addRecipe', ref, title: dinner.name, slot: 'dinner', wanted: 1 });
    if (out.refused) {
      problems.push(`${dinner.name}: ${out.refused}`);
      continue;
    }
    next = out.state;
    const waiting = mealsOf(next.draft, ref.key).filter((m) => m.date === null);
    const meal = waiting[waiting.length - 1];
    const free = windowDates(windowOf(next.draft))
      .find((date) => occupants(next.draft, date, 'dinner').length < CAPACITY.dinner);
    if (!meal || !free || !next.draft.prefs.slots_on.includes('dinner')) {
      trayed += 1;
      continue;
    }
    const placedOut = step(next, { type: 'place', mealId: meal.id, date: free, slot: 'dinner' });
    if (placedOut.refused) trayed += 1;
    else next = placedOut.state;
  }
  if (next === s) return { refused: problems.join('; ') || 'nothing changed' };
  const said = `${plural(dinners.length - problems.length, 'dinner', 'dinners')} from the Planner `
    + `${mode === 'replace' ? 'in a new plan' : 'added to your plan'}`
    + `${trayed ? `; ${trayed} wait in the tray` : ''}.`
    + `${problems.length ? ` Not added: ${problems.join('; ')}.` : ''}`;
  return { edit: { type: 'replace', state: next }, said, trayed };
}

// The slot's name, for headings: 'Dinner'.
export const slotName = (sl: Slot): string => SLOT_LABELS[sl];
