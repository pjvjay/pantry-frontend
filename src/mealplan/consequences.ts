// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// What a move would mean for freshness, read from the last schedule the server sent: the
// Move menu, the drag ghost and the trip Move menu show it before the shopper commits. It only
// compares numbers the server gave (each line's trip date, its planned days and their source);
// it never looks up or guesses a storage time, and a line whose time is unknown says nothing.
// It is a preview: the server's next answer is what counts, and the views label it so.
//
// It also turns a warning's remedy ops into reducer edits, or says what the shopper must
// answer first, and words each remedy as a button.
import { addDays, dayLabel, daysBetween, isCivilDate } from './dates.ts';
import { CAPACITY, SLOT_LABELS, isPrefField, occupants, recipeTitle, windowDates, windowOf }
  from './model.ts';
import type { MealPlanState, PlanEdit, Slot } from './model.ts';
import type {
  MealSchedule, PlanWarning, RemedyOp, StrategyResult, Trip, TripLine, TripStrategy, WarningLevel,
} from '../types.ts';

export type ConsequenceLevel = 'ok' | 'note' | 'warn';

export interface Consequence {
  level: ConsequenceLevel;         // warn: an approved trip would no longer keep it fresh
  lines: string[];
}

export const strategyOf = (sc: MealSchedule, name: TripStrategy): StrategyResult | undefined =>
  sc.strategies.find((s) => s.name === name);

// The day a meal's food must be in the house: breakfast is bought the day before, as the engine
// plans it.
export const buyBy = (date: string, slot: Slot): string =>
  (slot === 'breakfast' ? addDays(date, -1) : date);

const approved = (t: Trip) => t.status === 'approved' || t.status === 'needs_review';

// "it keeps 1 to 2 days in the fridge (FoodSafety.gov, ...)", or the shopper's own setting,
// named as theirs.
function keeps(ln: TripLine): string | null {
  const sl = ln.shelf_life;
  if (sl.days_planned === null) return null;
  if (sl.status === 'cited') {
    const said = sl.verbatim[0] ?? `${sl.days_planned} days`;
    return `it keeps ${said} in the ${ln.storage}${sl.source ? ` (${sl.source})` : ''}`;
  }
  if (sl.status === 'your_setting') return `your setting buys it at most ${sl.days_planned} days ahead`;
  return null;
}

const level = (a: ConsequenceLevel, b: ConsequenceLevel): ConsequenceLevel =>
  (a === 'warn' || b === 'warn' ? 'warn' : a === 'note' || b === 'note' ? 'note' : 'ok');

// One product bought on trip `t` for a meal eaten on `date` in `slot`.
function judge(t: Trip, ln: TripLine, date: string, slot: Slot): { level: ConsequenceLevel; line: string } | null {
  const by = buyBy(date, slot);
  const held = daysBetween(t.date, by);
  const name = ln.product.name;
  if (ln.freeze_on_arrival) {
    return held < 0
      ? { level: approved(t) ? 'warn' : 'note', line: `${name} is bought on ${dayLabel(t.date)}, after this meal.` }
      : null;
  }
  if (held < 0) {
    return approved(t)
      ? { level: 'warn', line: `${name} is on your approved trip on ${dayLabel(t.date)}, after this meal.` }
      : { level: 'note', line: `${name} would need an earlier trip than ${dayLabel(t.date)}.` };
  }
  const why = keeps(ln);
  const days = ln.shelf_life.days_planned;
  if (why === null || days === null || held <= days) return null;
  return approved(t)
    ? { level: 'warn', line: `${name} from your approved trip on ${dayLabel(t.date)} would be held `
      + `${held} days; ${why}.` }
    : { level: 'note', line: `${name} would be held ${held} days after ${dayLabel(t.date)}; ${why}, `
      + 'so another trip may be suggested.' };
}

function summarise(found: { level: ConsequenceLevel; line: string }[], none: string): Consequence {
  const lines = [...new Set(found.map((f) => f.line))];
  return { level: found.reduce<ConsequenceLevel>((a, f) => level(a, f.level), 'ok'),
    lines: lines.length ? lines : [none] };
}

// Moving a meal to `date`/`slot`, against the trips that buy for it now.
export function moveConsequence(sc: MealSchedule | null, strategy: TripStrategy, mealId: string,
  date: string, slot: Slot): Consequence {
  const st = sc ? strategyOf(sc, strategy) : undefined;
  if (!st) return { level: 'ok', lines: ['Freshness is checked once the trips are worked out.'] };
  const found: { level: ConsequenceLevel; line: string }[] = [];
  let bought = 0;
  for (const t of st.trips) {
    for (const ln of t.lines) {
      if (!ln.for_meals.some((m) => m.meal_id === mealId)) continue;
      bought += 1;
      const j = judge(t, ln, date, slot);
      if (j) found.push(j);
    }
  }
  if (!bought) return { level: 'ok', lines: ['No products are planned for this meal yet.'] };
  return summarise(found, 'Everything for it is still bought in time and within its stated times.');
}

// Moving a whole trip to `date`, against every meal it buys for.
export function tripMoveConsequence(sc: MealSchedule | null, strategy: TripStrategy, tripId: string,
  date: string): Consequence {
  const t = sc ? strategyOf(sc, strategy)?.trips.find((x) => x.id === tripId) : undefined;
  if (!t) return { level: 'ok', lines: ['That trip is not in the last answer.'] };
  const found: { level: ConsequenceLevel; line: string }[] = [];
  for (const ln of t.lines) {
    for (const m of ln.for_meals) {
      const held = daysBetween(date, buyBy(m.date, m.slot));
      if (held < 0) {
        found.push({ level: 'warn', line: `${ln.product.name} for ${m.title} on ${dayLabel(m.date)} `
          + `(${m.slot}) would be bought after it is needed.` });
        continue;
      }
      const why = keeps(ln);
      const days = ln.shelf_life.days_planned;
      if (ln.freeze_on_arrival || why === null || days === null || held <= days) continue;
      found.push({ level: 'warn', line: `${ln.product.name} would be held ${held} days before `
        + `${m.title} on ${dayLabel(m.date)}; ${why}.` });
    }
  }
  return summarise(found, 'Every item is still bought in time and within its stated times.');
}

export interface MoveChoice {
  date: string;
  slot: Slot;
  label: string;                   // 'Sun 11 Oct, Dinner'
  swapWith: string | null;         // the meal it would trade places with, when the cell is full
  blocked: string | null;          // why it cannot go there
  consequence: Consequence;
}

// Every cell a meal could move to, for the Move menu, in date then slot order.
export function moveChoices(s: MealPlanState, sc: MealSchedule | null, mealId: string): MoveChoice[] {
  const d = s.draft;
  const meal = d.meals.find((m) => m.id === mealId);
  if (!meal) return [];
  const out: MoveChoice[] = [];
  for (const date of windowDates(windowOf(d))) {
    for (const slot of d.prefs.slots_on) {
      if (meal.date === date && meal.slot === slot) continue;
      const others = occupants(d, date, slot).filter((m) => m.id !== mealId);
      const full = others.length >= CAPACITY[slot];
      const other = full ? others[0] : null;
      out.push({
        date, slot, label: `${dayLabel(date)}, ${SLOT_LABELS[slot]}`,
        swapWith: other?.id ?? null,
        blocked: other?.pinned ? `${recipeTitle(s, other.recipe_key)} is pinned there` : null,
        consequence: moveConsequence(sc, d.prefs.strategy, mealId, date, slot),
      });
    }
  }
  return out;
}

// ─── Warnings and their remedies ─────────────────────────────

const LEVEL_ORDER: Record<WarningLevel, number> = { must_fix: 0, should_fix: 1, decide: 2, note: 3 };

// The warnings that apply under one strategy (plan-wide ones included), most urgent first, in
// the server's order within a level.
export function warningsFor(sc: MealSchedule, strategy: TripStrategy): PlanWarning[] {
  return sc.warnings
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w.strategy === null || w.strategy === strategy)
    .sort((a, b) => LEVEL_ORDER[a.w.level] - LEVEL_ORDER[b.w.level] || a.i - b.i)
    .map(({ w }) => w);
}

// ─── One row for warnings that say the same thing ───────────

// The engine warns once per product: a breakfast moved before the trip is a must-fix for each
// thing it needs, six rows with the same "Move Ginger Congee to Mon 12 Oct". A row stands for
// warnings with the same level, code, meals and remedies, and lists their products: "Ginger
// Congee on Mon 12 Oct needs Fresh Ginger, Soy Sauce and 4 more, and no shopping day comes
// before it." When the sentences differ in more than the product, the first is kept and the
// rest named after it.
export interface WarningRow {
  warning: PlanWarning;            // the first, whose remedies the row offers
  count: number;
  products: string[];              // every product the row stands for, in order
  text: string;
}

// "A and B", "A, B and C", "A, B and 4 more"
export function productsText(names: readonly string[]): string {
  if (names.length <= 3) return names.length < 2 ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

export function warningRows(list: readonly PlanWarning[], names: Map<number, string>): WarningRow[] {
  const keyOf = (w: PlanWarning) => (w.meal_ids.length && w.product_id !== null
    ? `${w.level}|${w.code}|${[...w.meal_ids].sort().join(',')}|${JSON.stringify(w.remedies)}` : null);
  const groups: PlanWarning[][] = [];
  const byKey = new Map<string, PlanWarning[]>();
  for (const w of list) {
    const k = keyOf(w);
    const g = k === null ? undefined : byKey.get(k);
    if (g) g.push(w);
    else {
      const fresh = [w];
      groups.push(fresh);
      if (k !== null) byKey.set(k, fresh);
    }
  }
  return groups.map((ws) => {
    const first = ws[0];
    const products = [...new Set(ws.map((w) => (w.product_id === null ? ''
      : names.get(w.product_id) ?? `product ${w.product_id}`)).filter(Boolean))];
    if (ws.length < 2) return { warning: first, count: 1, products, text: first.message };
    // the sentence with its product taken out, the same for every warning in the row
    const hole = '\u0000';
    const shapes = ws.map((w) => {
      const name = w.product_id === null ? undefined : names.get(w.product_id);
      return name && w.message.includes(name) ? w.message.replace(name, hole) : null;
    });
    const same = shapes[0] !== null && shapes.every((x) => x === shapes[0]);
    const text = same ? (shapes[0] as string).replace(hole, productsText(products))
      : `${first.message} The same for ${productsText(products.slice(1))}.`;
    return { warning: first, count: ws.length, products, text };
  });
}

export function productNames(sc: MealSchedule | null): Map<number, string> {
  const names = new Map<number, string>();
  for (const st of sc?.strategies ?? []) {
    for (const t of st.trips) {
      for (const ln of t.lines) names.set(ln.product.id, ln.product.name);
      for (const p of t.dismissed) names.set(p.id, p.name);
    }
  }
  return names;
}

// A remedy as a reducer edit, or what the shopper has to give first: a number (servings,
// packs), a choice (Options), a slow call (resolve) or a trip to look at (approve). 'unknown'
// is an op this console does not know, from a newer engine.
export type RemedyStep =
  | { edit: PlanEdit }
  | { ask: 'servings' | 'packs' | 'options' | 'resolve' | 'approve' | 'unknown'; op: RemedyOp };

export function remedyStep(op: RemedyOp, s: MealPlanState): RemedyStep {
  switch (op.op) {
    case 'move_meal':
      return { edit: { type: 'place', mealId: op.meal_id, date: op.date, slot: op.slot } };
    case 'set_storage':
      return { edit: { type: 'setStorage', productId: op.product_id,
        storage: op.storage === 'pantry' ? null : op.storage } };
    case 'add_trip':
      return { edit: { type: 'addTrip', date: op.date } };
    case 'set_packs':
      return op.packs === undefined ? { ask: 'packs', op }
        : { edit: { type: 'setPacks', date: op.date, productId: op.product_id, packs: op.packs } };
    case 'remove_meal':
      return { edit: { type: 'remove', mealId: op.meal_id } };
    case 'set_strategy':
      return { edit: { type: 'setPrefs', prefs: { strategy: op.strategy } } };
    case 'set_pref':
      // The engine names the plan's length as a setting, but it is the draft's window: a longer
      // plan keeps its start date (and setWindow checks the length).
      if (op.field === 'days') {
        return typeof op.value === 'number'
          ? { edit: { type: 'setWindow', start_date: s.draft.start_date, days: op.value } }
          : { ask: 'unknown', op };
      }
      return isPrefField(op.field)
        ? { edit: { type: 'setPrefs', prefs: { [op.field]: op.value } } }
        : { ask: 'unknown', op };
    case 'set_servings': return { ask: 'servings', op };
    case 'open_options': return { ask: 'options', op };
    case 'resolve': return { ask: 'resolve', op };
    case 'approve_trip': return { ask: 'approve', op };
    default: return { ask: 'unknown', op };
  }
}

const shortDate = (date: string) => (isCivilDate(date) ? dayLabel(date) : date);

// The remedy's button text.
export function remedyLabel(op: RemedyOp, s: MealPlanState, names: Map<number, string>): string {
  const product = (id: number) => names.get(id) ?? `product ${id}`;
  const mealTitle = (id: string) => {
    const m = s.draft.meals.find((x) => x.id === id);
    return m ? recipeTitle(s, m.recipe_key) : 'this meal';
  };
  switch (op.op) {
    case 'move_meal': return `Move ${mealTitle(op.meal_id)} to ${shortDate(op.date)}, ${op.slot}`;
    case 'set_storage':
      return op.storage === 'freezer' ? `Freeze ${product(op.product_id)} on arrival`
        : `Keep ${product(op.product_id)} in the ${op.storage}`;
    case 'add_trip': return `Add a trip on ${shortDate(op.date)}`;
    case 'set_servings': return `Say how many ${recipeTitle(s, op.recipe_key)} serves`;
    case 'set_packs':
      return op.packs === 0 ? `Leave ${product(op.product_id)} off this trip`
        : `Set packs of ${product(op.product_id)}`;
    case 'open_options': return `Other products for ${product(op.product_id)}`;
    case 'resolve': return `Check products for ${recipeTitle(s, op.recipe_key)}`;
    case 'set_strategy': return op.strategy === 'fresh' ? 'Shop fresh' : 'Shop in fewest trips';
    case 'set_pref':
      if (op.field === 'days') return op.value === 14 ? 'Make the plan two weeks' : `Make the plan ${String(op.value)} days`;
      if (op.field === 'max_trips') return `Allow ${String(op.value)} trips`;
      if (op.field === 'budget' && typeof op.value === 'number') return `Make the budget $${op.value.toFixed(2)}`;
      return `Change ${op.field.replace(/_/g, ' ')}`;
    case 'approve_trip': return `Review the trip on ${shortDate(op.date)}`;
    case 'remove_meal': return `Remove ${mealTitle(op.meal_id)}`;
    default: return 'Fix';
  }
}
