// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The plan is saved in this browser only, under 'pantry.mealplan.v1':
//
//   {v: 1, saved_at: '<ISO instant>', draft: MealPlanDraft, titles, spread}
//
// The same text is the JSON export, and import reads it back through the same checks. The key
// and v carry the version: a later console that changes the shape writes v 2 (under a new key
// when old consoles must not read it) and reads v 1 through a migration listed in MIGRATIONS.
// A saved value this console cannot read is never thrown away: it is copied to
// 'pantry.mealplan.v1.backup' and the page starts with an empty plan and says why.
import { isCivilDate } from './dates.ts';
import { MAX_DAYS, MAX_MEALS, MAX_RECIPES, MAX_WANTED, SLOTS, prefsProblem, refProblem }
  from './model.ts';
import type { MealPlanState, Slot } from './model.ts';
import { targetsProblem } from '../nutritionFormat.ts';
import type { MealPlanDraft } from '../types.ts';

export const PLAN_KEY = 'pantry.mealplan.v1';
export const BACKUP_KEY = `${PLAN_KEY}.backup`;
export const SAVED_VERSION = 1;

// localStorage, or a stand-in in tests.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SavedPlan {
  v: 1;
  saved_at: string;
  draft: MealPlanDraft;
  titles: Record<string, string>;
  spread: string[];
}

// Older saved versions, read up to the current one. Empty while there is only version 1.
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const isDate = (x: unknown): x is string => typeof x === 'string' && isCivilDate(x);
const isRecordOf = (x: unknown, ok: (v: unknown) => boolean) =>
  isObject(x) && Object.values(x).every(ok);
const dateList = (x: unknown) => Array.isArray(x) && x.length <= MAX_DAYS && x.every(isDate);

// What is wrong with a saved draft, in words, or null. Hand-written so a damaged or foreign
// value is caught here, with a reason, and never reaches the reducer or the server.
export function draftProblem(x: unknown): string | null {
  if (!isObject(x)) return 'there is no plan in it';
  if (x.v !== 1) return `the plan is version ${String(x.v)}`;
  if (typeof x.id !== 'string' || x.id.length > 64) return 'the plan has no id';
  if (!isInt(x.rev, 0, Number.MAX_SAFE_INTEGER)) return 'the plan has no revision';
  if (!isDate(x.start_date)) return 'the start date is not a date';
  if (!isInt(x.days, 1, MAX_DAYS)) return `a plan covers 1 to ${MAX_DAYS} days`;
  const prefs = prefsProblem(x.prefs);
  if (prefs) return prefs;
  if (!isObject(x.recipes) || Object.keys(x.recipes).length > MAX_RECIPES) return 'the recipes are not readable';
  for (const [key, r] of Object.entries(x.recipes)) {
    if (!isObject(r) || !isObject(r.ref) || r.ref.key !== key) return `recipe ${key} is not readable`;
    const ref = refProblem(r.ref as never);
    if (ref) return `recipe ${key}: ${ref}`;
    if (!isInt(r.wanted, 0, MAX_WANTED) || !SLOTS.includes(r.slot as Slot)) return `recipe ${key} is not readable`;
    if (r.servings != null && !isInt(r.servings, 1, 100)) return `recipe ${key} has servings out of range`;
  }
  if (!isRecordOf(x.resolved, (r) => isObject(r) && typeof r.key === 'string'
    && typeof r.status === 'string' && Array.isArray(r.lines))) return 'the resolved products are not readable';
  if (!Array.isArray(x.meals) || x.meals.length > MAX_MEALS) return 'the meals are not readable';
  const ids = new Set<string>();
  for (const m of x.meals as unknown[]) {
    if (!isObject(m) || typeof m.id !== 'string' || !m.id || ids.has(m.id)) return 'a meal is not readable';
    ids.add(m.id);
    if (typeof m.recipe_key !== 'string' || !(m.recipe_key in x.recipes)) return `meal ${m.id} has no recipe`;
    if (m.date !== null && !isDate(m.date)) return `meal ${m.id} has no date`;
    if (m.slot !== null && !SLOTS.includes(m.slot as Slot)) return `meal ${m.id} has no slot`;
    if (typeof m.pinned !== 'boolean') return `meal ${m.id} is not readable`;
    if (m.servings != null && !isInt(m.servings, 1, 20)) return `meal ${m.id} has servings out of range`;
  }
  if (!isRecordOf(x.pins, (lines) => isRecordOf(lines, (pid) => isInt(pid, 1, Number.MAX_SAFE_INTEGER)))) {
    return 'the product pins are not readable';
  }
  if (!Array.isArray(x.trips) || x.trips.length > MAX_DAYS || !x.trips.every((t) => isObject(t)
    && isDate(t.date) && typeof t.fingerprint === 'string' && /^[0-9a-f]{64}$/.test(t.fingerprint)
    && (t.strategy === 'fresh' || t.strategy === 'fewest_trips') && Array.isArray(t.snapshot))) {
    return 'the approved trips are not readable';
  }
  if (!dateList(x.dismissed_dates) || !dateList(x.fixed_dates)) return 'the trip dates are not readable';
  if (!isRecordOf(x.packs_override, (n) => isInt(n, 0, 99))) return 'the pack counts are not readable';
  if (!isRecordOf(x.storage_overrides, (v) => v === 'fridge' || v === 'freezer')) {
    return 'the storage choices are not readable';
  }
  if (!isObject(x.settings)) return 'the shopping area is not readable';
  // Targets came with nutrition; a plan saved before them has none.
  if (x.nutrition_targets !== undefined) {
    const targets = targetsProblem(x.nutrition_targets);
    if (targets) return targets;
  }
  return null;
}

export function savedProblem(x: unknown): string | null {
  if (!isObject(x)) return 'it is not a saved meal plan';
  const draft = draftProblem(x.draft);
  if (draft) return draft;
  if (!isRecordOf(x.titles, (t) => typeof t === 'string')) return 'the recipe names are not readable';
  if (!Array.isArray(x.spread) || !x.spread.every((id) => typeof id === 'string')) {
    return 'the placed meals are not readable';
  }
  return null;
}

export function serialize(s: MealPlanState, savedAt: string): string {
  const saved: SavedPlan = { v: SAVED_VERSION, saved_at: savedAt, draft: s.draft,
    titles: s.titles, spread: s.spread };
  return JSON.stringify(saved);
}

export interface Loaded {
  state: MealPlanState | null;
  savedAt: string | null;
  problem: string | null;          // for the shopper: why the plan could not be read
}

// A saved plan (or an export) read back, or why not.
export function parsePlan(raw: string): Loaded {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { state: null, savedAt: null, problem: 'The saved plan is not valid JSON.' };
  }
  if (!isObject(value) || typeof value.v !== 'number') {
    return { state: null, savedAt: null, problem: 'That is not a saved meal plan.' };
  }
  let v = value.v;
  if (v > SAVED_VERSION) {
    return { state: null, savedAt: null,
      problem: `The plan was saved by a newer console (version ${v}); this one reads version ${SAVED_VERSION}.` };
  }
  while (v < SAVED_VERSION) {
    const up = MIGRATIONS[v];
    if (!up) return { state: null, savedAt: null, problem: `Plans saved as version ${v} cannot be read.` };
    value = up(value as Record<string, unknown>);
    v += 1;
  }
  const problem = savedProblem(value);
  if (problem) return { state: null, savedAt: null, problem: `The saved plan cannot be read: ${problem}.` };
  const saved = value as unknown as SavedPlan;
  // Only meals still in the plan are remembered as spread.
  const ids = new Set(saved.draft.meals.map((m) => m.id));
  return {
    state: { draft: saved.draft, titles: saved.titles, spread: saved.spread.filter((id) => ids.has(id)) },
    savedAt: typeof saved.saved_at === 'string' ? saved.saved_at : null,
    problem: null,
  };
}

export interface ReadResult extends Loaded {
  available: boolean;              // false: this browser will not let the page use storage
  backedUp: boolean;               // an unreadable value was copied to BACKUP_KEY
}

export function readPlan(storage: StorageLike | null): ReadResult {
  if (!storage) return { state: null, savedAt: null, problem: null, available: false, backedUp: false };
  let raw: string | null;
  try {
    raw = storage.getItem(PLAN_KEY);
  } catch {
    return { state: null, savedAt: null, problem: null, available: false, backedUp: false };
  }
  if (raw === null) return { state: null, savedAt: null, problem: null, available: true, backedUp: false };
  const loaded = parsePlan(raw);
  if (!loaded.problem) return { ...loaded, available: true, backedUp: false };
  let backedUp = false;
  try {
    storage.setItem(BACKUP_KEY, raw);
    backedUp = true;
  } catch {
    /* the shopper is told the plan could not be read either way */
  }
  return { ...loaded, available: true, backedUp };
}

// false when the browser refused (storage off, or full).
export function writePlan(storage: StorageLike | null, s: MealPlanState, savedAt: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PLAN_KEY, serialize(s, savedAt));
    return true;
  } catch {
    return false;
  }
}

export const exportFileName = (s: MealPlanState) => `meal-plan-${s.draft.start_date}.json`;
