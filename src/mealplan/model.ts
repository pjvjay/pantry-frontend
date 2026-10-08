// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The meal plan's frame (which days it covers, the four meal slots in each) and the reducer
// that edits the plan. The plan is pantry-api's MealPlanDraft, held in this browser; the
// server is stateless and computes the schedule from it on every change.
//
// How a meal moves, in the engine's terms:
//   - a meal with a date stays on it; only the shopper moves it;
//   - a meal with no date and pinned false is spread by the server, and the console stores the
//     date it chose back on the meal (mergeSchedule), so later edits leave it in place;
//   - a meal with no date and pinned true waits in the tray. New meals start there, and "Fill
//     empty slots" unpins them so the server spreads them.
// Every edit the shopper makes bumps draft.rev; a schedule answer is used only while its rev
// still matches, so a slow answer can never paint over a newer plan.
import { addDays, dayLabel, daysBetween, isCivilDate, range } from './dates.ts';
import type { CivilDate } from './dates.ts';
import { record, replace, undo as undoHistory, redo as redoHistory } from './undo.ts';
import type { History } from './undo.ts';
import type {
  ApprovedTrip, CookDaysProposal, Meal, MealPlanDraft, MealPrefs, MealSchedule, MealSlot,
  PlanSettings, RecipeDoc, RecipeRef, ResolvedRecipe, Trip, TripStrategy,
} from '../types.ts';

export type Slot = MealSlot;

export const SLOTS: readonly Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const SLOT_LABELS: Record<Slot, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
};

// One meal per slot over at most two weeks: 14 days × 4 slots holds 56 meals.
export const MAX_DAYS = 14;
export const MAX_MEALS = MAX_DAYS * SLOTS.length;

// The engine's limits (pantry_planner/mealplan/models.py and place.py), checked here first so
// the shopper hears why at once instead of from a 422.
export const MAX_RECIPES = 12;
export const MAX_WANTED = 28;
export const MAX_SERVINGS = 20;
export const MAX_PACKS = 99;
// Two snacks fit in a day's snack slot; every other slot holds one meal.
export const CAPACITY: Record<Slot, number> = { breakfast: 1, lunch: 1, dinner: 1, snack: 2 };

export interface PlanWindow {
  start_date: CivilDate;
  days: number;
}

// A new plan starts tomorrow: today's meals are usually bought already.
export const newWindow = (today: CivilDate, days = 7): PlanWindow =>
  ({ start_date: addDays(today, 1), days });

// What is wrong with a window, in words for the shopper, or null when it is usable.
export function windowProblem(w: PlanWindow): string | null {
  if (!isCivilDate(w.start_date)) return `"${w.start_date}" is not a date`;
  if (!Number.isInteger(w.days) || w.days < 1 || w.days > MAX_DAYS) {
    return `a plan covers 1 to ${MAX_DAYS} days, not ${w.days}`;
  }
  return null;
}

export const windowDates = (w: PlanWindow): CivilDate[] => range(w.start_date, w.days);

export function inWindow(w: PlanWindow, date: CivilDate): boolean {
  if (!isCivilDate(date)) return false;
  const offset = daysBetween(w.start_date, date);
  return offset >= 0 && offset < w.days;
}

// The board draws a plan as weeks of seven days counted from its start date, not from Monday,
// so a plan never opens on a half-empty week.
export function weeksOf(w: PlanWindow): CivilDate[][] {
  const dates = windowDates(w);
  const weeks: CivilDate[][] = [];
  for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));
  return weeks;
}

// A slot cell's drop-target key, as the board's data-drop attribute carries it:
// 'slot|2026-10-15|dinner'.
export const cellKey = (date: CivilDate, slot: Slot): string => `slot|${date}|${slot}`;

export function parseCellKey(key: string): { date: CivilDate; slot: Slot } | null {
  const parts = key.split('|');
  if (parts.length !== 3) return null;
  const [kind, date, slot] = parts;
  if (kind !== 'slot' || !isCivilDate(date) || !SLOTS.includes(slot as Slot)) return null;
  return { date, slot: slot as Slot };
}

// ─── The plan ────────────────────────────────────────────────

// What the console keeps: the draft the server reads, plus two things only the console needs.
//   titles: a recipe's name before its resolve answers (a library slug or starter key is not a
//     name), so the tray and announcements never show a key.
//   spread: the meals whose date the server chose rather than the shopper. Lowering a count
//     takes these off before refusing to touch a meal the shopper put somewhere.
export interface MealPlanState {
  draft: MealPlanDraft;
  titles: Record<string, string>;
  spread: string[];
}

export const DEFAULT_PREFS: MealPrefs = {
  household_servings: 2,
  slots_on: [...SLOTS],
  shop_weekdays: [0, 1, 2, 3, 4, 5, 6],
  buy_ahead_days: 7,
  thaw_reminder: 'evening_before',
  allow_freezer: true,
  strategy: 'fresh',
};

// `id` comes from the caller (crypto.randomUUID in the browser) so this module reads no clock
// and no random source.
export function newPlan(today: CivilDate, id: string, days = 7): MealPlanState {
  const w = newWindow(today, days);
  return {
    draft: {
      v: 1, id, rev: 0, start_date: w.start_date, days: w.days,
      prefs: { ...DEFAULT_PREFS, slots_on: [...DEFAULT_PREFS.slots_on],
        shop_weekdays: [...DEFAULT_PREFS.shop_weekdays] },
      recipes: {}, resolved: {}, meals: [], pins: {}, trips: [], dismissed_dates: [],
      fixed_dates: [], packs_override: {}, storage_overrides: {}, settings: {},
    },
    titles: {},
    spread: [],
  };
}

// Refs as the server checks them: the key says where the recipe comes from.
export const libraryRef = (slug: string): RecipeRef => ({ key: `lib:${slug}`, slug });
export const starterRef = (key: string): RecipeRef => ({ key: `starter:${key}`, starter: key });
export const docRef = (doc: RecipeDoc): RecipeRef => ({ key: doc.key, doc });

export function refProblem(ref: RecipeRef): string | null {
  const given = [ref.slug, ref.starter, ref.doc].filter((x) => x !== undefined && x !== null);
  if (given.length !== 1) return 'a recipe comes from exactly one of the library, a starter or a doc';
  const want = ref.slug != null ? `lib:${ref.slug}`
    : ref.starter != null ? `starter:${ref.starter}` : (ref.doc as RecipeDoc).key;
  return ref.key === want ? null : `the recipe key "${ref.key}" should be "${want}"`;
}

export const windowOf = (d: MealPlanDraft): PlanWindow => ({ start_date: d.start_date, days: d.days });

export function recipeTitle(s: MealPlanState, key: string): string {
  return s.titles[key] ?? s.draft.resolved[key]?.title ?? s.draft.recipes[key]?.ref.doc?.title
    ?? key.replace(/^[a-z]+:/, '').replace(/_/g, ' ');
}

export const mealsOf = (d: MealPlanDraft, key: string): Meal[] =>
  d.meals.filter((m) => m.recipe_key === key);

export const occupants = (d: MealPlanDraft, date: CivilDate, slot: Slot): Meal[] =>
  d.meals.filter((m) => m.date === date && m.slot === slot);

export const inTray = (m: Meal): boolean => m.date === null;

export function placedCount(d: MealPlanDraft, key: string): number {
  return mealsOf(d, key).filter((m) => m.date !== null).length;
}

// Meal ids are '<recipe_key>#<n>' with the first free n from 1, the engine's own scheme, so a
// meal the server adds and one the console adds can never collide.
export function nextMealId(d: MealPlanDraft, key: string, taken: Set<string> = new Set()): string {
  const ids = new Set([...d.meals.map((m) => m.id), ...taken]);
  let n = 1;
  while (ids.has(`${key}#${n}`)) n += 1;
  return `${key}#${n}`;
}

const where = (date: CivilDate, slot: Slot) => `${dayLabel(date)}, ${slot}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ─── Edits ───────────────────────────────────────────────────

export type PlanEdit =
  | { type: 'addRecipe'; ref: RecipeRef; title: string; slot?: Slot; wanted?: number }
  | { type: 'removeRecipe'; key: string }
  | { type: 'setWanted'; key: string; wanted: number }
  | { type: 'setRecipeSlot'; key: string; slot: Slot }
  | { type: 'setRecipeServings'; key: string; servings: number | null }
  | { type: 'setResolved'; resolved: ResolvedRecipe[] }
  | { type: 'place'; mealId: string; date: CivilDate; slot: Slot; swapWith?: string }
  | { type: 'unplace'; mealId: string }
  | { type: 'remove'; mealId: string }
  | { type: 'setMealServings'; mealId: string; servings: number | null }
  | { type: 'setPinned'; mealId: string; pinned: boolean }
  | { type: 'fillEmpty' }
  | { type: 'setWindow'; start_date: CivilDate; days: number; unplaceOutside?: boolean }
  | { type: 'setPrefs'; prefs: Partial<MealPrefs> }
  | { type: 'setSettings'; settings: PlanSettings }
  // rev: the rev of the schedule the trip was read from; a trip from an older answer is refused
  | { type: 'approveTrip'; trip: Trip; strategy: TripStrategy; rev: number }
  | { type: 'unapproveTrip'; date: CivilDate }
  | { type: 'dismissTrip'; date: CivilDate }
  | { type: 'restoreTrip'; date: CivilDate }
  | { type: 'addTrip'; date: CivilDate }
  | { type: 'moveTrip'; from: CivilDate; to: CivilDate }
  | { type: 'setPacks'; date: CivilDate; productId: number; packs: number | null }
  | { type: 'setStorage'; productId: number; storage: 'fridge' | 'freezer' | null }
  | { type: 'pinProduct'; recipeKey: string; lineNo: number; productId: number | null }
  | { type: 'applyCookDays'; proposal: CookDaysProposal }
  | { type: 'mergeSchedule'; schedule: MealSchedule }
  | { type: 'batch'; edits: PlanEdit[] }
  | { type: 'replace'; state: MealPlanState }
  | { type: 'clear'; today: CivilDate; id: string };

// What an edit did. state is the input object itself when the edit was refused or changed
// nothing. said is the sentence for the live region.
export interface Outcome {
  state: MealPlanState;
  refused: string | null;
  said: string;
}

// Answers from the server are not the shopper's edits: they change the plan without an undo
// step of their own. mergeSchedule also leaves rev alone, because storing the dates the server
// just computed for this rev does not change what the plan means.
export const recorded = (e: PlanEdit): boolean =>
  e.type !== 'mergeSchedule' && e.type !== 'setResolved';

type Applied = { state: MealPlanState; said: string } | string;

const set = (s: MealPlanState, draft: Partial<MealPlanDraft>, extra: Partial<MealPlanState> = {})
  : MealPlanState => ({ ...s, ...extra, draft: { ...s.draft, ...draft } });

const withMeal = (d: MealPlanDraft, id: string, patch: Partial<Meal>): Meal[] =>
  d.meals.map((m) => (m.id === id ? { ...m, ...patch } : m));

const without = (list: string[], ...ids: string[]) => list.filter((x) => !ids.includes(x));

const isInt = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;

const sortedUnique = (xs: string[]) => [...new Set(xs)].sort();

function trayMeals(d: MealPlanDraft, key: string, slot: Slot, n: number): Meal[] {
  const taken = new Set<string>();
  const out: Meal[] = [];
  for (let i = 0; i < n; i += 1) {
    const id = nextMealId(d, key, taken);
    taken.add(id);
    out.push({ id, recipe_key: key, date: null, slot, pinned: true });
  }
  return out;
}

function addRecipe(s: MealPlanState, e: Extract<PlanEdit, { type: 'addRecipe' }>): Applied {
  const d = s.draft;
  const key = e.ref.key;
  const problem = refProblem(e.ref);
  if (problem) return problem;
  if (d.recipes[key]) return `${e.title} is already in the plan`;
  if (Object.keys(d.recipes).length >= MAX_RECIPES) {
    return `a plan holds ${MAX_RECIPES} recipes; take one out first`;
  }
  const wanted = e.wanted ?? 1;
  if (!isInt(wanted, 0, MAX_WANTED)) return `a recipe can be 0 to ${MAX_WANTED} meals`;
  if (d.meals.length + wanted > MAX_MEALS) return `a plan holds ${MAX_MEALS} meals`;
  const slot = e.slot ?? 'dinner';
  return {
    state: set(s, {
      recipes: { ...d.recipes, [key]: { ref: e.ref, wanted, slot } },
      meals: [...d.meals, ...trayMeals(d, key, slot, wanted)],
    }, { titles: { ...s.titles, [key]: e.title } }),
    said: `${e.title} added: ${plural(wanted, 'meal', 'meals')} to place.`,
  };
}

function removeRecipe(s: MealPlanState, key: string): Applied {
  const d = s.draft;
  if (!d.recipes[key]) return 'that recipe is not in the plan';
  const title = recipeTitle(s, key);
  const gone = mealsOf(d, key).map((m) => m.id);
  const drop = <T>(r: Record<string, T>) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => k !== key));
  return {
    state: {
      draft: { ...d, recipes: drop(d.recipes), resolved: drop(d.resolved), pins: drop(d.pins),
        meals: d.meals.filter((m) => m.recipe_key !== key) },
      titles: drop(s.titles),
      spread: without(s.spread, ...gone),
    },
    said: `${title} removed from the plan.`,
  };
}

function setWanted(s: MealPlanState, key: string, wanted: number): Applied {
  const d = s.draft;
  const recipe = d.recipes[key];
  if (!recipe) return 'that recipe is not in the plan';
  if (!isInt(wanted, 0, MAX_WANTED)) return `a recipe can be 0 to ${MAX_WANTED} meals`;
  const title = recipeTitle(s, key);
  const mine = mealsOf(d, key);
  if (wanted === recipe.wanted && wanted === mine.length) return { state: s, said: '' };
  let meals = d.meals;
  let spread = s.spread;
  if (wanted > mine.length) {
    if (d.meals.length + wanted - mine.length > MAX_MEALS) return `a plan holds ${MAX_MEALS} meals`;
    meals = [...meals, ...trayMeals(d, key, recipe.slot, wanted - mine.length)];
  } else if (wanted < mine.length) {
    // Take off what nobody chose first: meals still in the tray (newest first), then meals the
    // server spread (latest date first). A meal the shopper put on a day stays.
    const byIdDesc = (a: Meal, b: Meal) => b.id.localeCompare(a.id, 'en', { numeric: true });
    const tray = mine.filter(inTray).sort(byIdDesc);
    const spreadMeals = mine.filter((m) => m.date !== null && s.spread.includes(m.id))
      .sort((a, b) => (b.date as string).localeCompare(a.date as string) || byIdDesc(a, b));
    const order = [...tray, ...spreadMeals];
    const need = mine.length - wanted;
    if (order.length < need) {
      const yours = mine.length - order.length;
      return `${plural(yours, `${title} meal is`, `${title} meals are`)} on the calendar where `
        + 'you put them; take one off first';
    }
    const gone = new Set(order.slice(0, need).map((m) => m.id));
    meals = meals.filter((m) => !gone.has(m.id));
    spread = without(spread, ...gone);
  }
  return {
    state: set(s, { recipes: { ...d.recipes, [key]: { ...recipe, wanted } }, meals }, { spread }),
    said: `${title}: ${plural(wanted, 'meal', 'meals')}.`,
  };
}

function place(s: MealPlanState, e: Extract<PlanEdit, { type: 'place' }>): Applied {
  const d = s.draft;
  const meal = d.meals.find((m) => m.id === e.mealId);
  if (!meal) return 'that meal is not in the plan';
  if (!SLOTS.includes(e.slot)) return `"${e.slot}" is not a meal slot`;
  if (!inWindow(windowOf(d), e.date)) return `${e.date} is not one of the plan's days`;
  if (!d.prefs.slots_on.includes(e.slot)) {
    return `${SLOT_LABELS[e.slot]} is switched off in your settings`;
  }
  if (meal.date === e.date && meal.slot === e.slot) return { state: s, said: '' };
  const title = recipeTitle(s, meal.recipe_key);
  const others = occupants(d, e.date, e.slot).filter((m) => m.id !== meal.id);
  // A meal placed from the tray is no longer held there; one moved on the board keeps its pin.
  const placed: Partial<Meal> = { date: e.date, slot: e.slot,
    pinned: meal.date === null ? false : meal.pinned };
  let meals = withMeal(d, meal.id, placed);
  let said = `${title} placed on ${where(e.date, e.slot)}.`;
  const moved = [meal.id];
  if (others.length >= CAPACITY[e.slot]) {
    const other = others.find((m) => m.id === e.swapWith) ?? others[0];
    const otherTitle = recipeTitle(s, other.recipe_key);
    if (other.pinned) return `${otherTitle} is pinned to ${where(e.date, e.slot)}; unpin it first`;
    // The displaced meal takes the moved meal's place: its cell, or the tray.
    const back: Partial<Meal> = meal.date === null
      ? { date: null, pinned: true }
      : { date: meal.date, slot: meal.slot };
    meals = meals.map((m) => (m.id === other.id ? { ...m, ...back } : m));
    moved.push(other.id);
    said = meal.date === null
      ? `${title} placed on ${where(e.date, e.slot)}; ${otherTitle} went back to the tray.`
      : `${title} and ${otherTitle} swapped.`;
  }
  const next = set(s, { meals }, { spread: without(s.spread, ...moved) });
  const key = meal.recipe_key;
  return { state: next,
    said: `${said} ${placedCount(next.draft, key)} of ${mealsOf(next.draft, key).length} placed.` };
}

function unplace(s: MealPlanState, mealId: string): Applied {
  const d = s.draft;
  const meal = d.meals.find((m) => m.id === mealId);
  if (!meal) return 'that meal is not in the plan';
  if (meal.date === null && meal.pinned) return { state: s, said: '' };
  return {
    state: set(s, { meals: withMeal(d, mealId, { date: null, pinned: true }) },
      { spread: without(s.spread, mealId) }),
    said: `${recipeTitle(s, meal.recipe_key)} went back to the tray.`,
  };
}

function removeMeal(s: MealPlanState, mealId: string): Applied {
  const d = s.draft;
  const meal = d.meals.find((m) => m.id === mealId);
  if (!meal) return 'that meal is not in the plan';
  const recipe = d.recipes[meal.recipe_key];
  const recipes = recipe
    ? { ...d.recipes, [meal.recipe_key]: { ...recipe, wanted: Math.max(0, recipe.wanted - 1) } }
    : d.recipes;
  return {
    state: set(s, { meals: d.meals.filter((m) => m.id !== mealId), recipes },
      { spread: without(s.spread, mealId) }),
    said: `One ${recipeTitle(s, meal.recipe_key)} meal removed.`,
  };
}

// Meals and approved trips outside a new window are refused unless the shopper agreed to send
// the meals back to the tray and drop the trips. Suggestions and pack counts for dates outside
// it no longer mean anything, so they go quietly.
function setWindow(s: MealPlanState, e: Extract<PlanEdit, { type: 'setWindow' }>): Applied {
  const w = { start_date: e.start_date, days: e.days };
  const problem = windowProblem(w);
  if (problem) return problem;
  const d = s.draft;
  if (d.start_date === w.start_date && d.days === w.days) return { state: s, said: '' };
  const outMeals = d.meals.filter((m) => m.date !== null && !inWindow(w, m.date));
  const outTrips = d.trips.filter((t) => !inWindow(w, t.date));
  if ((outMeals.length || outTrips.length) && !e.unplaceOutside) {
    const parts = [];
    if (outMeals.length) parts.push(plural(outMeals.length, 'meal', 'meals'));
    if (outTrips.length) parts.push(plural(outTrips.length, 'approved trip', 'approved trips'));
    return `${parts.join(' and ')} would fall outside the new dates`;
  }
  const out = new Set(outMeals.map((m) => m.id));
  const keep = (date: string) => inWindow(w, date);
  const next = set(s, {
    start_date: w.start_date, days: w.days,
    meals: d.meals.map((m) => (out.has(m.id) ? { ...m, date: null, pinned: true } : m)),
    trips: d.trips.filter((t) => keep(t.date)),
    fixed_dates: d.fixed_dates.filter(keep),
    dismissed_dates: d.dismissed_dates.filter(keep),
    packs_override: Object.fromEntries(Object.entries(d.packs_override)
      .filter(([k]) => keep(k.split(':')[0]))),
  }, { spread: without(s.spread, ...out) });
  const last = addDays(w.start_date, w.days - 1);
  const moved = out.size ? ` ${plural(out.size, 'meal', 'meals')} went back to the tray.` : '';
  return { state: next,
    said: `The plan now runs ${dayLabel(w.start_date)} to ${dayLabel(last)}.${moved}` };
}

const PREF_CHECKS: { [K in keyof MealPrefs]-?: (v: unknown) => boolean } = {
  household_servings: (v) => isInt(v, 1, MAX_SERVINGS),
  slots_on: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => SLOTS.includes(x as Slot))
    && new Set(v).size === v.length,
  shop_weekdays: (v) => Array.isArray(v) && v.length > 0 && v.length <= 7
    && v.every((x) => isInt(x, 0, 6)) && new Set(v).size === v.length,
  max_trips: (v) => v === null || v === undefined || isInt(v, 1, MAX_DAYS),
  buy_ahead_days: (v) => isInt(v, 0, MAX_DAYS),
  thaw_reminder: (v) => v === 'evening_before' || v === 'morning_of',
  allow_freezer: (v) => typeof v === 'boolean',
  strategy: (v) => v === 'fresh' || v === 'fewest_trips',
};

export const isPrefField = (f: string): f is keyof MealPrefs => f in PREF_CHECKS;

function setPrefs(s: MealPlanState, patch: Partial<MealPrefs>): Applied {
  const d = s.draft;
  for (const [field, value] of Object.entries(patch)) {
    if (!isPrefField(field) || !PREF_CHECKS[field](value)) {
      return `${JSON.stringify(value)} is not a setting for ${field.replace(/_/g, ' ')}`;
    }
  }
  if (patch.slots_on) {
    const off = SLOTS.filter((sl) => !patch.slots_on?.includes(sl));
    const stuck = d.meals.filter((m) => m.date !== null && m.slot !== null && off.includes(m.slot));
    if (stuck.length) {
      const slot = stuck[0].slot as Slot;
      return `${plural(stuck.length, 'meal is', 'meals are')} in ${SLOT_LABELS[slot]}; `
        + `move ${stuck.length === 1 ? 'it' : 'them'} first`;
    }
  }
  const prefs: MealPrefs = { ...d.prefs, ...patch };
  if (patch.shop_weekdays) prefs.shop_weekdays = [...patch.shop_weekdays].sort((a, b) => a - b);
  if (patch.slots_on) prefs.slots_on = SLOTS.filter((sl) => patch.slots_on?.includes(sl));
  if (JSON.stringify(prefs) === JSON.stringify(d.prefs)) return { state: s, said: '' };
  return { state: set(s, { prefs }), said: 'Settings saved.' };
}

// Where the household shops decides which products are in range, so a new place clears the
// recipes' resolved products and the console resolves them again.
function setSettings(s: MealPlanState, patch: PlanSettings): Applied {
  const d = s.draft;
  const ok = (v: unknown, lo: number, hi: number) =>
    v === null || v === undefined || (typeof v === 'number' && v >= lo && v <= hi);
  if (!ok(patch.lat, -90, 90) || !ok(patch.lon, -180, 180) || !ok(patch.max_km, 0.5, 100)) {
    return 'that place or distance is out of range';
  }
  const settings = { ...d.settings, ...patch };
  const same = (k: keyof PlanSettings) => (settings[k] ?? null) === (d.settings[k] ?? null);
  if (same('lat') && same('lon') && same('max_km')) return { state: s, said: '' };
  return { state: set(s, { settings, resolved: {} }),
    said: 'Shopping area changed; products will be checked again.' };
}

// The approved trip as the engine fingerprints it: copied from the trip the shopper saw.
export function approvedFrom(trip: Trip, strategy: TripStrategy): ApprovedTrip {
  return {
    date: trip.date, fingerprint: trip.fingerprint, strategy,
    snapshot: trip.lines.map((ln) => ({ product_id: ln.product.id, packs: ln.packs,
      storage: ln.storage, price_at_approval: ln.price })),
  };
}

function approveTrip(s: MealPlanState, e: Extract<PlanEdit, { type: 'approveTrip' }>): Applied {
  const d = s.draft;
  if (e.rev !== d.rev) return 'the trips are being checked again; approve once they are up to date';
  if (!inWindow(windowOf(d), e.trip.date)) return 'that trip is outside the plan';
  if (!/^[0-9a-f]{64}$/.test(e.trip.fingerprint)) return 'that trip has no fingerprint to approve';
  const trips = [...d.trips.filter((t) => t.date !== e.trip.date), approvedFrom(e.trip, e.strategy)]
    .sort((a, b) => a.date.localeCompare(b.date));
  const again = d.trips.some((t) => t.date === e.trip.date);
  return { state: set(s, { trips }),
    said: `Trip on ${dayLabel(e.trip.date)} ${again ? 'approved again with its changes' : 'approved'}.` };
}

function tripDates(s: MealPlanState, e: Extract<PlanEdit, { type: 'unapproveTrip' | 'dismissTrip'
  | 'restoreTrip' | 'addTrip' | 'moveTrip' }>): Applied {
  const d = s.draft;
  const w = windowOf(d);
  const approved = (date: string) => d.trips.some((t) => t.date === date);
  switch (e.type) {
    case 'unapproveTrip':
      if (!approved(e.date)) return { state: s, said: '' };
      return { state: set(s, { trips: d.trips.filter((t) => t.date !== e.date) }),
        said: `Trip on ${dayLabel(e.date)} is a suggestion again.` };
    case 'dismissTrip':
      if (approved(e.date)) return 'that trip is approved; take the approval back first';
      if (!inWindow(w, e.date)) return 'that day is outside the plan';
      if (d.dismissed_dates.includes(e.date)) return { state: s, said: '' };
      if (d.dismissed_dates.length >= MAX_DAYS) return `at most ${MAX_DAYS} days can be dismissed`;
      return { state: set(s, { dismissed_dates: sortedUnique([...d.dismissed_dates, e.date]),
        fixed_dates: d.fixed_dates.filter((x) => x !== e.date) }),
      said: `No trip on ${dayLabel(e.date)}.` };
    case 'restoreTrip':
      if (!d.dismissed_dates.includes(e.date)) return { state: s, said: '' };
      return { state: set(s, { dismissed_dates: d.dismissed_dates.filter((x) => x !== e.date) }),
        said: `A trip may be suggested on ${dayLabel(e.date)} again.` };
    case 'addTrip':
      if (!inWindow(w, e.date)) return 'that day is outside the plan';
      if (d.fixed_dates.includes(e.date)) return { state: s, said: '' };
      if (d.fixed_dates.length >= MAX_DAYS) return `at most ${MAX_DAYS} trips can be fixed`;
      return { state: set(s, { fixed_dates: sortedUnique([...d.fixed_dates, e.date]),
        dismissed_dates: d.dismissed_dates.filter((x) => x !== e.date) }),
      said: `A trip on ${dayLabel(e.date)}.` };
    case 'moveTrip': {
      if (approved(e.from)) return 'approved trips stay where they are; take the approval back first';
      if (!inWindow(w, e.from) || !inWindow(w, e.to)) return 'that day is outside the plan';
      if (e.from === e.to) return { state: s, said: '' };
      if (approved(e.to)) return `there is an approved trip on ${dayLabel(e.to)} already`;
      // The shopper's pack counts belong to the trip, so they move with it.
      const packs = Object.fromEntries(Object.entries(d.packs_override).map(([k, v]) => {
        const [date, pid] = k.split(':');
        return [date === e.from ? `${e.to}:${pid}` : k, v];
      }));
      return { state: set(s, {
        dismissed_dates: sortedUnique([...d.dismissed_dates.filter((x) => x !== e.to), e.from]),
        fixed_dates: sortedUnique([...d.fixed_dates.filter((x) => x !== e.from), e.to]),
        packs_override: packs,
      }), said: `Trip moved from ${dayLabel(e.from)} to ${dayLabel(e.to)}.` };
    }
  }
}

function applyCookDays(s: MealPlanState, p: CookDaysProposal): Applied {
  const d = s.draft;
  const ids = new Set(d.meals.map((m) => m.id));
  if (p.rev === d.rev && p.meals.length === d.meals.length && p.meals.every((m) => ids.has(m.id))) {
    const moved = new Set(p.ops.map((o) => o.meal_id));
    return { state: set(s, { meals: p.meals }, { spread: without(s.spread, ...moved) }),
      said: `${plural(p.ops.length, 'meal', 'meals')} moved to fresher days.` };
  }
  // The plan changed since the proposal: apply each move that still starts where it said, to a
  // free cell, and list the rest.
  let next = s;
  const skipped: string[] = [];
  for (const op of p.ops) {
    const meal = next.draft.meals.find((m) => m.id === op.meal_id);
    const to = op.to.date;
    const fits = meal !== undefined && !meal.pinned && meal.date === op.from.date
      && meal.slot === op.from.slot && to !== null
      && occupants(next.draft, to, op.to.slot).length < CAPACITY[op.to.slot];
    const r = fits && to !== null
      ? place(next, { type: 'place', mealId: op.meal_id, date: to, slot: op.to.slot })
      : 'moved since';
    if (typeof r === 'string') skipped.push(op.meal_id);
    else next = r.state;
  }
  const done = p.ops.length - skipped.length;
  if (!done) return 'the plan changed since these cook days were suggested; ask again';
  if (!skipped.length) return { state: next, said: `${plural(done, 'meal', 'meals')} moved to fresher days.` };
  return { state: next, said: `${done} of ${p.ops.length} moves applied; `
    + `${skipped.length} skipped because the plan changed since: ${skipped.join(', ')}.` };
}

// Store the dates the server spread meals to, and any meal it added for a count, so later
// edits leave them where the shopper saw them. Only for the rev the answer was computed from.
function mergeSchedule(s: MealPlanState, sc: MealSchedule): Applied {
  const d = s.draft;
  if (sc.rev !== d.rev) return { state: s, said: '' };
  const byId = new Map(d.meals.map((m) => [m.id, m]));
  let meals = d.meals;
  const spread = new Set(s.spread);
  const titles = { ...s.titles };
  let changed = false;
  for (const pm of sc.meals) {
    if (!titles[pm.recipe_key] && pm.title) {
      titles[pm.recipe_key] = pm.title;
      changed = true;
    }
    if (pm.placed_by !== 'spread' || pm.date === null || !d.recipes[pm.recipe_key]) continue;
    const mine = byId.get(pm.id);
    if (!mine) {
      if (meals.length >= MAX_MEALS) continue;
      meals = [...meals, { id: pm.id, recipe_key: pm.recipe_key, date: pm.date, slot: pm.slot,
        pinned: false }];
    } else if (mine.date === null && !mine.pinned) {
      meals = meals.map((m) => (m.id === pm.id ? { ...m, date: pm.date, slot: pm.slot } : m));
    } else {
      continue;
    }
    spread.add(pm.id);
    changed = true;
  }
  if (!changed) return { state: s, said: '' };
  return { state: { draft: { ...d, meals }, titles, spread: [...spread] }, said: '' };
}

function apply(s: MealPlanState, e: PlanEdit): Applied {
  const d = s.draft;
  switch (e.type) {
    case 'addRecipe': return addRecipe(s, e);
    case 'removeRecipe': return removeRecipe(s, e.key);
    case 'setWanted': return setWanted(s, e.key, e.wanted);
    case 'setRecipeSlot': {
      const r = d.recipes[e.key];
      if (!r) return 'that recipe is not in the plan';
      if (!SLOTS.includes(e.slot)) return `"${e.slot}" is not a meal slot`;
      if (r.slot === e.slot) return { state: s, said: '' };
      // Meals still in the tray follow the recipe's slot; placed ones stay where they are.
      return { state: set(s, {
        recipes: { ...d.recipes, [e.key]: { ...r, slot: e.slot } },
        meals: d.meals.map((m) => (m.recipe_key === e.key && m.date === null
          ? { ...m, slot: e.slot } : m)),
      }), said: `${recipeTitle(s, e.key)} is a ${e.slot} now.` };
    }
    case 'setRecipeServings': {
      const r = d.recipes[e.key];
      if (!r) return 'that recipe is not in the plan';
      if (e.servings !== null && !isInt(e.servings, 1, 100)) return 'a recipe serves 1 to 100';
      if ((r.servings ?? null) === e.servings) return { state: s, said: '' };
      return { state: set(s, { recipes: { ...d.recipes, [e.key]: { ...r, servings: e.servings } } }),
        said: e.servings === null ? `${recipeTitle(s, e.key)}: servings not set.`
          : `${recipeTitle(s, e.key)} serves ${e.servings} (your answer).` };
    }
    case 'setResolved': {
      const mine = e.resolved.filter((r) => d.recipes[r.key]);
      if (!mine.length) return { state: s, said: '' };
      const resolved = { ...d.resolved };
      const titles = { ...s.titles };
      for (const r of mine) {
        resolved[r.key] = r;
        if (r.title) titles[r.key] = r.title;
      }
      return { state: set(s, { resolved }, { titles }), said: '' };
    }
    case 'place': return place(s, e);
    case 'unplace': return unplace(s, e.mealId);
    case 'remove': return removeMeal(s, e.mealId);
    case 'setMealServings': {
      const m = d.meals.find((x) => x.id === e.mealId);
      if (!m) return 'that meal is not in the plan';
      if (e.servings !== null && !isInt(e.servings, 1, MAX_SERVINGS)) {
        return `a meal serves 1 to ${MAX_SERVINGS}`;
      }
      if ((m.servings ?? null) === e.servings) return { state: s, said: '' };
      return { state: set(s, { meals: withMeal(d, e.mealId, { servings: e.servings }) }),
        said: e.servings === null ? 'This meal serves the household.' : `This meal serves ${e.servings}.` };
    }
    case 'setPinned': {
      const m = d.meals.find((x) => x.id === e.mealId);
      if (!m) return 'that meal is not in the plan';
      if (m.date === null) return 'a meal in the tray stays there until you place it or fill empty slots';
      if (m.pinned === e.pinned) return { state: s, said: '' };
      return { state: set(s, { meals: withMeal(d, e.mealId, { pinned: e.pinned }) },
        { spread: without(s.spread, e.mealId) }),
      said: e.pinned ? 'Pinned: Suggest cook days will not move it.' : 'Unpinned.' };
    }
    case 'fillEmpty': {
      const held = d.meals.filter((m) => m.date === null && m.pinned);
      if (!held.length) return { state: s, said: '' };
      return { state: set(s, { meals: d.meals.map((m) => (m.date === null ? { ...m, pinned: false } : m)) }),
        said: `${plural(held.length, 'meal', 'meals')} will be spread over empty slots.` };
    }
    case 'setWindow': return setWindow(s, e);
    case 'setPrefs': return setPrefs(s, e.prefs);
    case 'setSettings': return setSettings(s, e.settings);
    case 'approveTrip': return approveTrip(s, e);
    case 'unapproveTrip': case 'dismissTrip': case 'restoreTrip': case 'addTrip': case 'moveTrip':
      return tripDates(s, e);
    case 'setPacks': {
      if (!inWindow(windowOf(d), e.date)) return 'that trip is outside the plan';
      if (e.packs !== null && !isInt(e.packs, 0, MAX_PACKS)) return `packs are 0 to ${MAX_PACKS}`;
      const key = `${e.date}:${e.productId}`;
      if ((d.packs_override[key] ?? null) === e.packs) return { state: s, said: '' };
      const packs_override = { ...d.packs_override };
      if (e.packs === null) delete packs_override[key];
      else packs_override[key] = e.packs;
      return { state: set(s, { packs_override }),
        said: e.packs === null ? 'Packs back to the computed count.'
          : e.packs === 0 ? 'Line dismissed from this trip.' : `${e.packs} packs (set by you).` };
    }
    case 'setStorage': {
      const key = String(e.productId);
      if ((d.storage_overrides[key] ?? null) === e.storage) return { state: s, said: '' };
      const storage_overrides = { ...d.storage_overrides };
      if (e.storage === null) delete storage_overrides[key];
      else storage_overrides[key] = e.storage;
      return { state: set(s, { storage_overrides }),
        said: e.storage === 'freezer' ? 'It will be frozen on arrival.'
          : e.storage === 'fridge' ? 'It will never be frozen.' : 'Storage back to the plan’s choice.' };
    }
    case 'pinProduct': {
      if (!d.recipes[e.recipeKey]) return 'that recipe is not in the plan';
      if (!isInt(e.lineNo, 1, 1000)) return 'that line is not in the recipe';
      const line = String(e.lineNo);
      const current = d.pins[e.recipeKey]?.[line] ?? null;
      if (current === e.productId) return { state: s, said: '' };
      const lines = { ...(d.pins[e.recipeKey] ?? {}) };
      if (e.productId === null) delete lines[line];
      else lines[line] = e.productId;
      const pins = { ...d.pins };
      if (Object.keys(lines).length) pins[e.recipeKey] = lines;
      else delete pins[e.recipeKey];
      return { state: set(s, { pins }),
        said: e.productId === null ? 'Back to the planner’s product.' : 'Your product is used for this line.' };
    }
    case 'applyCookDays': return applyCookDays(s, e.proposal);
    case 'mergeSchedule': return mergeSchedule(s, e.schedule);
    case 'batch': {
      let next = s;
      const said: string[] = [];
      const refused: string[] = [];
      for (const sub of e.edits) {
        const r = apply(next, sub);
        if (typeof r === 'string') refused.push(r);
        else {
          next = r.state;
          if (r.said) said.push(r.said);
        }
      }
      if (refused.length && next === s) return refused.join('; ');
      return { state: next, said: [...said, ...refused.map((r) => `Not done: ${r}.`)].join(' ') };
    }
    case 'replace':
      return { state: e.state, said: 'Plan loaded.' };
    case 'clear':
      return { state: newPlan(e.today, e.id, d.days), said: 'Plan cleared.' };
  }
}

// One edit. Anything that changed the plan gets the next rev, so a schedule answer for the old
// one is ignored; mergeSchedule keeps the rev (see recorded).
export function step(s: MealPlanState, e: PlanEdit): Outcome {
  const r = apply(s, e);
  if (typeof r === 'string') return { state: s, refused: r, said: '' };
  if (r.state === s) return { state: s, refused: null, said: r.said };
  if (e.type === 'mergeSchedule') return { state: r.state, refused: null, said: r.said };
  // replace and clear bring in another plan: its rev continues from the higher of the two.
  const rev = Math.max(s.draft.rev, r.state.draft.rev) + 1;
  return { state: { ...r.state, draft: { ...r.state.draft, rev } }, refused: null, said: r.said };
}

export const reduce = (s: MealPlanState, e: PlanEdit): MealPlanState => step(s, e).state;

// ─── Undo ────────────────────────────────────────────────────

// A snapshot brought back by undo or redo gets the next rev, so the rev only ever counts up and
// an answer computed for the snapshot's old rev cannot apply to it. It keeps the products
// resolved since, for the recipes it has: those cost a model call, and undo is not a reason to
// pay for one again. Products resolved for another shopping area are not carried over.
function restore(target: MealPlanState, current: MealPlanState): MealPlanState {
  const resolved = { ...target.draft.resolved };
  const a = target.draft.settings;
  const b = current.draft.settings;
  const sameArea = (a.lat ?? null) === (b.lat ?? null) && (a.lon ?? null) === (b.lon ?? null)
    && (a.max_km ?? null) === (b.max_km ?? null);
  for (const key of Object.keys(target.draft.recipes)) {
    if (sameArea && !resolved[key] && current.draft.resolved[key]) {
      resolved[key] = current.draft.resolved[key];
    }
  }
  return { ...target, titles: { ...current.titles, ...target.titles },
    draft: { ...target.draft, resolved, rev: current.draft.rev + 1 } };
}

export function historyStep(h: History<MealPlanState>, e: PlanEdit)
  : { history: History<MealPlanState>; outcome: Outcome } {
  const outcome = step(h.present, e);
  const history = recorded(e) ? record(h, outcome.state) : replace(h, outcome.state);
  return { history, outcome };
}

export const undoPlan = (h: History<MealPlanState>) => undoHistory(h, restore);
export const redoPlan = (h: History<MealPlanState>) => redoHistory(h, restore);
