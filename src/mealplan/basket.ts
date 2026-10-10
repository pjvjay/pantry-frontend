// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The wizard's Ingredients stage: every chosen recipe's ingredients as the plan would buy them
// (/mealplan/basket), each with its product, the store and how far it is, the price, where it is
// from and its labels. Nothing is worked out here: a fact the basket does not give is unknown.
// An ingredient no store nearby sells is said so and needs an answer before Schedule: other
// meals (back to Meals), another product (its Options), or "skip this ingredient".
import { lineKey, mealsOf, recipeTitle } from './model.ts';
import type { MealPlanState } from './model.ts';
import type { BasketLine, BasketOrigin, MealBasket, MealPlanDraft } from '../types.ts';

const money = (v: number) => `$${v.toFixed(2)}`;

const listOf = (parts: string[]) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// JSON with object keys sorted, so the same plan always gives the same text.
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (x && typeof x === 'object') {
    return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(x ?? null);
}

// What the basket depends on: the recipes and their servings, how many meals each has (and
// for how many), the products resolved and pinned, where the household shops and the budget.
// Not where the meals sit: moving one on Schedule does not ask for the basket again.
export function basketKey(d: MealPlanDraft): string {
  return stable({
    recipes: Object.fromEntries(Object.entries(d.recipes).map(([k, r]) => [k, r.servings ?? null])),
    meals: d.meals.map((m) => `${m.recipe_key}:${m.servings ?? ''}`).sort(),
    resolved: Object.fromEntries(Object.entries(d.resolved).map(([k, r]) =>
      [k, [r.status, r.servings, r.lines.map((ln) => ln.product_id)]])),
    pins: d.pins,
    settings: d.settings,
    household: d.prefs.household_servings,
    budget: d.prefs.budget ?? null,
  });
}

// Where an ingredient is from: the country and the claim's kind, or that nobody says.
export function originText(o: BasketOrigin): { text: string; flag: boolean } {
  if (o.status === 'conflicting') return { text: 'origin unclear: sources disagree', flag: true };
  if (o.status !== 'evidenced' || !o.country) return { text: 'origin unknown', flag: false };
  const claim = o.claim === 'processing' ? ' (processed there)'
    : o.claim && o.claim !== 'full' ? ` (${o.claim})` : '';
  return { text: `${o.country}${claim}${o.preferred_rank !== null ? ' · a preferred origin' : ''}`, flag: false };
}

export function storeText(line: BasketLine): string {
  if (!line.store) return 'no store nearby';
  const km = line.store.distance_km;
  return km === null ? line.store.name : `${line.store.name} · ${km.toFixed(1)} km`;
}

export interface LineView {
  key: string;                     // lineKey(recipe, line_no)
  recipeKey: string;
  lineNo: number;
  ingredient: string;
  need: string;
  productId: number | null;
  product: string | null;          // "Whole Milk 1L"
  store: string;
  price: string;                   // a pack
  cost: string;                    // this recipe's share, all its meals
  origin: { text: string; flag: boolean };
  labels: string[];
  pinned: boolean;
  shared: string;                  // "also bought for Chicken Fried Rice"
  available: boolean;
  why: string;
  skipped: boolean;
  // nothing more to do: sold nearby, skipped by the shopper, or its recipe has no meals now
  answered: boolean;
  optionsLabel: string;
}

export interface RecipeView {
  key: string;
  title: string;
  status: string;
  meals: number;
  lines: LineView[];
  unanswered: number;
}

function lineView(s: MealPlanState, recipeKey: string, meals: number, ln: BasketLine): LineView {
  const p = ln.product;
  const product = p ? [p.name, p.size].filter(Boolean).join(' ') : null;
  const k = lineKey(recipeKey, ln.line_no);
  const skipped = (s.skipped ?? []).includes(k);
  const others = ln.shared_with.filter((x) => x !== recipeKey && s.draft.recipes[x]).map((x) => recipeTitle(s, x));
  const price = ln.price === null ? 'price unknown' : `${money(ln.price)} a pack`;
  const store = storeText(ln);
  const labels = [...(p?.labels ?? [])];
  if (p?.says_organic && !labels.some((l) => /organic/i.test(l))) labels.push('says organic');
  if (p?.demo_product) labels.push('demo product');
  return {
    key: k, recipeKey, lineNo: ln.line_no, ingredient: ln.ingredient, need: ln.need,
    productId: p?.id ?? null, product, store, price,
    cost: ln.cost_for_need === null ? '' : `${money(ln.cost_for_need)} for these meals`,
    origin: originText(ln.origin), labels, pinned: ln.pinned,
    shared: others.length ? `also bought for ${listOf(others)}` : '',
    available: ln.available, why: ln.why_unavailable ?? 'no store nearby sells it',
    skipped, answered: ln.available || skipped || meals === 0,
    optionsLabel: product
      ? `Options for ${ln.ingredient}: now ${product}, ${ln.price === null ? 'price unknown' : money(ln.price)}`
        + `${ln.store ? ` at ${ln.store.name}` : ''}${ln.available ? '' : '; not sold nearby'}`
      : `${ln.ingredient}: nothing chosen`,
  };
}

// The basket for the recipes still in the plan, in the basket's order, with the skips the
// shopper made. A recipe's meals are the plan's own count, which may be newer than the answer.
export function basketView(b: MealBasket, s: MealPlanState): { recipes: RecipeView[]; unanswered: LineView[] } {
  const recipes = b.recipes.filter((r) => s.draft.recipes[r.key]).map((r) => {
    const meals = mealsOf(s.draft, r.key).length;
    const lines = r.lines.map((ln) => lineView(s, r.key, meals, ln));
    return { key: r.key, title: r.title || recipeTitle(s, r.key), status: r.status, meals, lines,
      unanswered: lines.filter((l) => !l.answered).length };
  });
  return { recipes, unanswered: recipes.flatMap((r) => r.lines.filter((l) => !l.answered)) };
}

export const unansweredCount = (b: MealBasket | null, s: MealPlanState): number =>
  (b ? basketView(b, s).unanswered.length : 0);

// Whether the basket's total leaves out a price: some ingredient it buys has none.
export const basketAtLeast = (b: MealBasket): boolean =>
  b.recipes.some((r) => r.lines.some((ln) => ln.available && ln.product !== null && ln.price === null));
