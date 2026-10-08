// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The shopper's own recipes, kept in this browser under 'pantry.recipes.v1'. This module is the
// contract between whatever saves a recipe (recipe import's "Save to my recipes", in a later
// change) and whatever reads one (the meal plan's tray and Quick add). The stored value is
//
//   {v: 1, recipes: RecipeDoc[]}
//
// with every doc keyed 'my:<id>'. A RecipeDoc is exactly what the shopper reviewed, so the meal
// plan sends it as it is (RecipeRef {key, doc}) and the server plans its lines with no parse.
// Reading never fails the page: a doc that does not fit the shape is skipped and counted, and
// a value that is not this shape at all reads as no recipes, with the problem said.
import type { AmountBasis, RecipeDoc, SelectionParseRequest } from './types.ts';

export const RECIPES_KEY = 'pantry.recipes.v1';
export const RECIPES_VERSION = 1;
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

// Added, or replacing the doc with the same key; the newest is last.
export function upsertMyRecipe(docs: RecipeDoc[], doc: RecipeDoc): RecipeDoc[] {
  return [...docs.filter((d) => d.key !== doc.key), doc];
}

export function serializeMyRecipes(docs: RecipeDoc[]): string {
  return JSON.stringify({ v: RECIPES_VERSION, recipes: docs });
}

// false when the browser refused (storage off or full).
export function writeMyRecipes(storage: StorageLike | null, docs: RecipeDoc[]): boolean {
  if (!storage) return false;
  try {
    storage.setItem(RECIPES_KEY, serializeMyRecipes(docs));
    return true;
  } catch {
    return false;
  }
}

// The shopper's recipes as Quick add matches them.
export function forSelection(docs: RecipeDoc[]): NonNullable<SelectionParseRequest['recipes']> {
  return docs.slice(-MAX_MY_RECIPES).map((d) => ({ key: d.key, title: d.title.slice(0, 200) }));
}
