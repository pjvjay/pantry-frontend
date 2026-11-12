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
  CAPACITY, SLOT_LABELS, STRATEGY_NAMES, cellKey, libraryRef, mealsOf, newPlan, occupants, placedCount,
  recipeTitle, step, windowDates, windowOf,
} from './model.ts';
import type { MealPlanState, PlanEdit, Slot } from './model.ts';
import type {
  CartLine, CartSummary, Meal, MealPlanDraft, MealSchedule, StrategyResult, Trip, TripLine, TripStrategy,
} from '../types.ts';

export const money = (v: number): string => `$${v.toFixed(2)}`;

// A total of known prices: "$41.20", "at least $41.20" when some price is unknown, and "price
// unknown" when none is known. The engine sums known prices only, so a trip whose every price
// is unknown has a total of 0, which is not a price anybody quoted.
export function costText(total: number | null, floor: boolean, anyKnown: boolean, atLeast = 'at least '): string {
  // null: pantry-api found no price on any line (an older one sent 0 with the floor set)
  if (total === null || (floor && !anyKnown)) return 'price unknown';
  return `${floor ? atLeast : ''}${money(total)}`;
}

export const tripPriced = (t: Trip): boolean => t.lines.some((ln) => ln.price !== null);

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

// The slot rows a day card draws: every slot switched on, or with hideEmpty (Place on days'
// default) only the slots the plan's meals are in, on a day or waiting in the tray, so a meal
// waiting always has its row to go to and three dinners draw seven Dinner rows, not twenty-eight.
// With no meals at all, every slot switched on.
export function shownSlots(s: MealPlanState, hideEmpty: boolean): Slot[] {
  const on = s.draft.prefs.slots_on;
  if (!hideEmpty) return [...on];
  const used = new Set(s.draft.meals.map((m) => m.slot));
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

// How many meals are cooked each day of the plan (Shop's week strip).
export function mealsByDay(d: MealPlanDraft): Map<CivilDate, number> {
  const out = new Map(windowDates(windowOf(d)).map((x) => [x, 0]));
  for (const m of d.meals) if (m.date !== null && out.has(m.date)) out.set(m.date, (out.get(m.date) ?? 0) + 1);
  return out;
}

// The days a suggested trip can move to: any other day of the plan with no approved trip on it
// (the reducer refuses those), as moveTrip takes them.
export const tripMoveDays = (d: MealPlanDraft, from: CivilDate): CivilDate[] =>
  windowDates(windowOf(d)).filter((x) => x !== from && !d.trips.some((t) => t.date === x));

export const mealCountText = (n: number): string => (n ? plural(n, 'meal', 'meals') : 'no meals');

// elsewhere: the day is approved under the other strategy (model.approvedElsewhere), so this
// strategy's list for it is not, and it neither moves nor is dismissed until that is settled.
// The state is always said in words; where a trip is drawn, its kind also picks the icon beside
// them (TripMark in components/mealcal.tsx), so it is never colour alone. No sign is written into
// the words themselves: a symbol in text is an emoji on some systems, and a screen reader reads
// it out on top of the word that already says the same.
export interface TripLook {
  kind: 'suggested' | 'approved' | 'review' | 'elsewhere';
  word: string;
}

export function tripLook(t: Trip, elsewhere: TripStrategy | null = null): TripLook {
  if (t.status === 'approved') return { kind: 'approved', word: 'Approved' };
  if (t.status === 'needs_review') return { kind: 'review', word: 'Changed since approved' };
  if (elsewhere) return { kind: 'elsewhere', word: `Approved under ${STRATEGY_NAMES[elsewhere]}` };
  return { kind: 'suggested', word: 'Suggested' };
}

const diffSize = (t: Trip) =>
  (t.diff ? t.diff.added.length + t.diff.removed.length + t.diff.changed.length : 0);

// "Suggested · 2 stores · at least $41.20 · 14 items", or "Changed since approved (3 changes) · …".
export function tripChipText(t: Trip, elsewhere: TripStrategy | null = null): string {
  const look = tripLook(t, elsewhere);
  const head = look.kind === 'review' && diffSize(t)
    ? `${look.word} (${plural(diffSize(t), 'change', 'changes')})`
    : look.word;
  const cost = costText(t.total_cost, t.total_is_floor, tripPriced(t));
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
// trip's own total_cost) plus the trip's travel, and "at least" when a price is unknown. The
// card's title says so ("Groceries and travel"), since the trip sheet over it gives the
// groceries alone: the two totals then read as what they are.
export const CART_TITLE = 'Groceries and travel';

export function tripToCartSummary(t: Trip): CartSummary {
  const lines: CartLine[] = t.lines.map((ln) => ({
    ingredient: ln.product.name,
    product: `${ln.product.name}${ln.product.demo_product ? ' (demo)' : ''}`,
    product_id: ln.product.id,
    storage: ln.storage,
    store: ln.store ?? 'Not stocked within range',
    price: ln.price ?? undefined,
    packs: ln.packs ?? undefined,
    size: ln.product.unit_size,
    note: [forMealsText(ln), ln.freeze_on_arrival ? 'freeze on arrival' : null].filter(Boolean).join(' · '),
    warn: lineWarn(ln),
  }));
  const travel = t.recommended?.travel_cost;
  return {
    recipe_name: CART_TITLE,
    lines,
    total_cost: t.total_cost ?? undefined,
    total_is_floor: t.total_is_floor,
    trip: { stores: t.stores, basket_cost: t.total_cost ?? undefined, travel_cost: travel,
      total_cost: t.total_cost === null ? null : t.total_cost + (travel ?? 0) },
  };
}

// ─── Approving while the plan is checked again ───────────────

// An Approve pressed while the trips were being worked out again after an edit: the day, the
// list the shopper saw (its fingerprint), under which way to shop, and whether it takes the place
// of the day's approval under the other one.
export interface QueuedApproval {
  date: CivilDate;
  fingerprint: string;
  strategy: TripStrategy;
  replace: boolean;
}

// What the queued approvals come to once the answer for the plan as it is now is in. A trip whose
// list is still the one the shopper saw (the same fingerprint) is approved from the new answer,
// under its rev, which the reducer's revision gate asks for; one whose list changed meanwhile is
// not approved, since that would approve a list nobody has looked at, and is named so the shopper
// can look again; one the new answer no longer has is dropped and named too.
export function queuedApprovals(queue: readonly QueuedApproval[], answer: MealSchedule)
  : { edits: PlanEdit[]; changed: CivilDate[]; gone: CivilDate[] } {
  const edits: PlanEdit[] = [];
  const changed: CivilDate[] = [];
  const gone: CivilDate[] = [];
  for (const q of queue) {
    const t = strategyOf(answer, q.strategy)?.trips.find((x) => x.date === q.date);
    if (!t) gone.push(q.date);
    else if (t.fingerprint !== q.fingerprint) changed.push(q.date);
    else if (t.status !== 'approved' || q.replace) {
      edits.push({ type: 'approveTrip', trip: t, strategy: q.strategy, rev: answer.rev, replace: q.replace });
    }
  }
  return { edits, changed, gone };
}

const andList = (xs: readonly string[]) => (xs.length < 3 ? xs.join(' and ')
  : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// What the plan's live region says of the queued approvals it could not make: a trip whose list
// changed meanwhile, to look at and approve again, and a day the plan has no trip on now. A day
// the shopper dismissed meanwhile needs no word: they did it themselves.
export function queuedMissText(changed: readonly CivilDate[], gone: readonly CivilDate[],
  dismissed: readonly CivilDate[]): string {
  const missed = changed.map(dayLabel);
  const lost = gone.filter((x) => !dismissed.includes(x)).map(dayLabel);
  const one = missed.length === 1;
  return [
    missed.length ? `Not approved: the ${one ? 'trip' : 'trips'} on ${andList(missed)} changed while the plan was `
      + `checked; look at ${one ? 'it' : 'them'}, then approve.` : '',
    lost.length ? `Not approved: the plan has no trip on ${andList(lost).replace(/ and ([^,]*)$/, ' or $1')} now.` : '',
  ].filter(Boolean).join(' ');
}

// ─── Summary ─────────────────────────────────────────────────

// "15 meals · 11 placed · 2 trips (1 approved) · at least $142.10". Days approved under the
// other strategy are counted apart, since their approved list is not the one shown.
export function summaryLine(s: MealPlanState, sc: MealSchedule | null): string {
  const d = s.draft;
  const placed = d.meals.filter((m) => m.date !== null).length;
  const parts = [plural(d.meals.length, 'meal', 'meals'), `${placed} placed`];
  const st = strategyOf(sc, d.prefs.strategy);
  if (st) {
    const approved = st.trips.filter((t) => t.status !== 'suggested').length;
    const others = d.trips.filter((a) => a.strategy !== d.prefs.strategy);
    const notes = [approved ? `${approved} approved` : '',
      others.length ? `${others.length} approved under ${STRATEGY_NAMES[others[0].strategy]}` : '']
      .filter(Boolean);
    parts.push(`${plural(st.trips.length, 'trip', 'trips')}${notes.length ? ` (${notes.join(', ')})` : ''}`);
    if (st.trips.length) parts.push(costText(st.total_cost, st.total_is_floor, st.trips.some(tripPriced)));
  }
  return parts.join(' · ');
}

// ─── The Planner's week, opened as a meal plan ───────────────

export interface WeekDinner {
  slug: string;
  name: string;
}

// A week of dinners from the week planner as meals: one dinner a day from the plan's first day,
// in the week's order. 'replace' starts a new plan from tomorrow; 'add' keeps the plan and puts
// each dinner on the first free dinner, or in the tray when none is free. One edit for undo.
// added: the dinners that went in; problems: why any did not (the plan's recipe limit, say).
export function weekEdit(s: MealPlanState, dinners: WeekDinner[], mode: 'replace' | 'add',
  today: CivilDate, id: string)
  : { edit: PlanEdit; said: string; trayed: number; added: number; problems: string[] } | { refused: string } {
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
  return { edit: { type: 'replace', state: next }, said, trayed, added: dinners.length - problems.length, problems };
}

// The slot's name, for headings: 'Dinner'.
export const slotName = (sl: Slot): string => SLOT_LABELS[sl];
