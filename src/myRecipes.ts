// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The shopper's own recipes, as the meal plan reads them. Recipe import is the one writer: its
// "Save to my recipes" and "Add to meal plan" (src/recipes.ts on feat/recipe-import) write two
// browser keys, and this module reads both with the same key names and shapes:
//
//   pantry.recipes.v1          {v: 1, recipes: RecipeDoc[]}, every doc keyed 'my:<id>'
//   pantry.mealplan.inbox.v1   {v: 1, entries: [{key: 'my:<id>', title, added_at}]}
//
// A RecipeDoc is exactly what the shopper reviewed, so the meal plan sends it as it is
// (RecipeRef {key, doc}) and the server plans its lines with no parse. Reading never fails the
// page: a doc that does not fit the shape is skipped and counted, and a value that is not this
// shape at all reads as no recipes, with the problem said. The meal plan never writes
// pantry.recipes.v1, because recipe import's rule is that saving keeps every entry it cannot
// read, and a second writer would have to keep that rule too. The inbox is the exception the
// contract makes: the meal plan empties it once it has taken the entries.
//
// When this branch and recipe import meet, these readers can import the key names from
// src/recipes.ts instead of stating them again.
import { MAX_MEALS, MAX_RECIPES, docRef } from './mealplan/model.ts';
import type { MealPlanState, PlanEdit } from './mealplan/model.ts';
import type { AmountBasis, RecipeDoc, SelectionParseRequest } from './types.ts';

export const RECIPES_KEY = 'pantry.recipes.v1';
export const RECIPES_VERSION = 1;
export const MEAL_PLAN_INBOX_KEY = 'pantry.mealplan.inbox.v1';
export const INBOX_VERSION = 1;
export const MAX_MY_RECIPES = 50;  // what /mealplan/selection/parse takes in one call
const MAX_LINES = 60;

// localStorage, or a stand-in in tests. Every call is wrapped: storage can be switched off,
// full, or throw in a private window.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const BASES: readonly AmountBasis[] = ['stated_by_source', 'demo_house_amounts',
  'parsed_from_your_paste', 'transcribed_confirmed_by_you', 'written_by_assistant'];

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const isCount = (x: unknown, lo: number, hi: number) =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

// What is wrong with one saved recipe, or null when it is a RecipeDoc of the shopper's own.
export function myDocProblem(x: unknown): string | null {
  if (!isObject(x)) return 'not a recipe';
  if (x.v !== 1) return 'not a version 1 recipe';
  if (typeof x.key !== 'string' || !/^my:[\w-]{1,64}$/.test(x.key)) return 'its key is not my:<id>';
  if (typeof x.title !== 'string' || !x.title.trim() || x.title.length > 200) return 'no title';
  if (x.servings !== null && !isCount(x.servings, 1, 100)) return 'servings are not 1 to 100';
  if (typeof x.servings_stated !== 'boolean') return 'servings_stated is missing';
  if (![null, 'source', 'your_setting'].includes(x.servings_basis as string | null)) {
    return 'servings_basis is not source or your_setting';
  }
  if (typeof x.yield_text !== 'string') return 'yield_text is missing';
  if (!isObject(x.source) || typeof x.source.kind !== 'string') return 'its source is missing';
  if (!Array.isArray(x.warnings)) return 'warnings are missing';
  if (!Array.isArray(x.lines) || x.lines.length > MAX_LINES) return `it needs 0 to ${MAX_LINES} lines`;
  for (const ln of x.lines as unknown[]) {
    if (!isObject(ln) || !isCount(ln.line_no, 1, 1000) || typeof ln.text !== 'string'
      || typeof ln.name !== 'string' || typeof ln.unit !== 'string' || typeof ln.note !== 'string'
      || !(ln.quantity === null || (typeof ln.quantity === 'number' && Number.isFinite(ln.quantity)))
      || typeof ln.confirmed !== 'boolean' || !BASES.includes(ln.amount_basis as AmountBasis)) {
      return 'a line is not a recipe line';
    }
  }
  return null;
}

export interface MyRecipes {
  recipes: RecipeDoc[];
  problem: string | null;          // said to the shopper; the readable recipes are still used
}

export function parseMyRecipes(raw: string | null): MyRecipes {
  if (raw === null) return { recipes: [], problem: null };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { recipes: [], problem: 'Your saved recipes could not be read.' };
  }
  if (!isObject(value) || !Array.isArray(value.recipes)) {
    return { recipes: [], problem: 'Your saved recipes are not in a shape this console reads.' };
  }
  if (value.v !== RECIPES_VERSION) {
    return { recipes: [], problem: `Your saved recipes are version ${String(value.v)}; this console `
      + `reads version ${RECIPES_VERSION}.` };
  }
  const seen = new Set<string>();
  const recipes: RecipeDoc[] = [];
  let skipped = 0;
  for (const doc of value.recipes) {
    if (myDocProblem(doc) !== null || seen.has((doc as RecipeDoc).key)) {
      skipped += 1;
      continue;
    }
    seen.add((doc as RecipeDoc).key);
    recipes.push(doc as RecipeDoc);
  }
  return { recipes, problem: skipped
    ? `${skipped} saved ${skipped === 1 ? 'recipe' : 'recipes'} could not be read and ${skipped === 1 ? 'is' : 'are'} not shown.`
    : null };
}

export function readMyRecipes(storage: StorageLike | null): MyRecipes {
  if (!storage) return { recipes: [], problem: null };
  try {
    return parseMyRecipes(storage.getItem(RECIPES_KEY));
  } catch {
    return { recipes: [], problem: 'This browser is not letting the console read saved recipes.' };
  }
}

// The shopper's recipes as Quick add matches them.
export function forSelection(docs: RecipeDoc[]): NonNullable<SelectionParseRequest['recipes']> {
  return docs.slice(-MAX_MY_RECIPES).map((d) => ({ key: d.key, title: d.title.slice(0, 200) }));
}

// ─── recipes sent to the meal plan ───────────────────────────

export interface InboxEntry {
  key: `my:${string}`;
  title: string;
  added_at: string;                // ISO time, for the order they were sent
}

export interface Inbox {
  entries: InboxEntry[];
  problem: string | null;
}

const isEntry = (x: unknown): x is InboxEntry => isObject(x) && typeof x.key === 'string'
  && /^my:[\w-]{1,64}$/.test(x.key) && typeof x.title === 'string' && typeof x.added_at === 'string';

export function parseInbox(raw: string | null): Inbox {
  if (raw === null) return { entries: [], problem: null };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { entries: [], problem: 'The recipes sent to the meal plan could not be read.' };
  }
  if (!isObject(value) || value.v !== INBOX_VERSION || !Array.isArray(value.entries)) {
    return { entries: [], problem: 'The recipes sent to the meal plan are in a form this console '
      + 'cannot read.' };
  }
  const entries = value.entries.filter(isEntry);
  const skipped = value.entries.length - entries.length;
  return { entries, problem: skipped
    ? `${skipped} ${skipped === 1 ? 'recipe' : 'recipes'} sent to the meal plan could not be read.`
    : null };
}

// The entries waiting, oldest first, with the inbox emptied. If emptying fails the entries are
// still returned: adding a recipe the plan already holds changes nothing, so a second take is
// harmless.
export function takeInbox(storage: StorageLike | null): Inbox {
  if (!storage) return { entries: [], problem: null };
  let inbox: Inbox;
  try {
    inbox = parseInbox(storage.getItem(MEAL_PLAN_INBOX_KEY));
  } catch {
    return { entries: [], problem: 'This browser is not letting the console read the recipes '
      + 'sent to the meal plan.' };
  }
  if (!inbox.entries.length && !inbox.problem) return inbox;
  try {
    storage.setItem(MEAL_PLAN_INBOX_KEY, JSON.stringify({ v: INBOX_VERSION, entries: [] }));
  } catch {
    /* the entries are used all the same */
  }
  return inbox;
}

// The sent recipes as one batch edit (one undo step): each joins the tray with one meal, as a
// dinner, unless the plan holds it already. A recipe no longer saved, or one the plan has no
// room for, is said rather than dropped quietly.
export function inboxEdit(entries: InboxEntry[], recipes: RecipeDoc[], s: MealPlanState)
  : { edit: PlanEdit | null; problems: string[] } {
  const edits: PlanEdit[] = [];
  const problems: string[] = [];
  const keys = new Set(Object.keys(s.draft.recipes));
  let meals = s.draft.meals.length;
  for (const entry of entries) {
    if (keys.has(entry.key)) continue;
    const doc = recipes.find((d) => d.key === entry.key);
    if (!doc) {
      problems.push(`${entry.title || 'A recipe'} was sent to the meal plan but is no longer in `
        + 'your saved recipes.');
      continue;
    }
    if (keys.size >= MAX_RECIPES || meals >= MAX_MEALS) {
      problems.push(`${doc.title} was not added: a plan holds ${MAX_RECIPES} recipes and `
        + `${MAX_MEALS} meals. It is still in your saved recipes.`);
      continue;
    }
    keys.add(doc.key);
    meals += 1;
    edits.push({ type: 'addRecipe', ref: docRef(doc), title: doc.title, wanted: 1, slot: 'dinner' });
  }
  return { edit: edits.length ? { type: 'batch', edits } : null, problems };
}
