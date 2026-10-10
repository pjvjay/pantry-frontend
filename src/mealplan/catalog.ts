// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The wizard's Meals stage: recipe cards by meal from /mealplan/catalog, and the budget bar
// over them. A meal's cost here is pantry-api's estimate (each line's share of its pack price,
// for the household); trips buy whole packs, so Ingredients and the Shopping plan show the real
// figures. A cost the catalog does not know is unknown, never 0: a spend that leaves one out is
// "at least", and an Add of a recipe with no estimate is never stopped by the budget.
import { CAPACITY, SLOTS, SLOT_LABELS, avoidOf, budgetOf, dietOf, docRef, mealsOf, recipeTitle } from './model.ts';
import type { MealPlanState, Slot } from './model.ts';
import type { CatalogRecipe, CatalogRequest, MealCatalog, MealPlanDraft, RecipeDoc, RecipeRef } from '../types.ts';

// The shopper's own recipes sent for classifying, at most this many.
export const MAX_OWN = 20;

const cents = (v: number) => Math.round(v * 100) / 100;
export const money = (v: number) => `$${v.toFixed(2)}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The request for the plan as it is: the household, its diet and avoid-tags, where it shops
// and its origin rules, the slots it plans, and the shopper's own recipes.
export function catalogRequest(d: MealPlanDraft, mine: readonly RecipeDoc[]): CatalogRequest {
  const own = mine.slice(0, MAX_OWN).map(docRef);
  return {
    household_servings: d.prefs.household_servings,
    diet: dietOf(d.prefs),
    avoid: avoidOf(d.prefs),
    settings: d.settings,
    slots: [...d.prefs.slots_on],
    ...(own.length ? { recipes: own } : {}),
  };
}

// A ref as the plan keeps it: only the source given (the server may send the others as null).
export function cleanRef(ref: RecipeRef): RecipeRef {
  const out: RecipeRef = { key: ref.key };
  if (ref.slug != null) out.slug = ref.slug;
  if (ref.starter != null) out.starter = ref.starter;
  if (ref.doc != null) out.doc = ref.doc;
  if (ref.servings != null) out.servings = ref.servings;
  return out;
}

// The shopper's own recipe (an import or a paste), as against a demo starter or the library.
export const isMine = (r: CatalogRecipe): boolean => r.ref.doc != null;

// The strictest diet a recipe keeps to, for its badge: vegan is also vegetarian and pescatarian.
export function dietBadge(diets: readonly string[]): string | null {
  return ['vegan', 'vegetarian', 'pescatarian'].find((x) => diets.includes(x)) ?? null;
}

// "about $3.20 a meal", "at least $2.10 a meal (3 of 5 ingredients priced)", "cost unknown".
export function costPerMealText(r: CatalogRecipe): string {
  if (r.est_cost_per_meal === null) return 'cost unknown';
  if (r.lines_priced < r.lines_total) {
    return `at least ${money(r.est_cost_per_meal)} a meal (${r.lines_priced} of ${r.lines_total} ingredients priced)`;
  }
  return `about ${money(r.est_cost_per_meal)} a meal`;
}

export function unavailableText(r: CatalogRecipe): string {
  return r.unavailable.length ? `Not sold nearby: ${r.unavailable.join(', ')}` : '';
}

export const byKey = (c: MealCatalog | null): Map<string, CatalogRecipe> =>
  new Map((c?.recipes ?? []).map((r) => [r.key, r]));

// ─── Budget ──────────────────────────────────────────────────

// The estimated spend of the plan's meals. unknown: recipes in the plan the catalog has no
// estimate for, by title; the total leaves them out.
export interface Spend {
  total: number;
  unknown: string[];
}

export function estimatedSpend(s: MealPlanState, recipes: Map<string, CatalogRecipe>): Spend {
  let total = 0;
  const unknown: string[] = [];
  for (const key of Object.keys(s.draft.recipes)) {
    const meals = mealsOf(s.draft, key).length;
    if (!meals) continue;
    const est = recipes.get(key)?.est_cost_per_meal ?? null;
    if (est === null) unknown.push(recipeTitle(s, key));
    else total += est * meals;
  }
  return { total: cents(total), unknown };
}

// Whether one more meal of a recipe keeps the plan within its budget, and by how much it would
// pass it. With no budget, or no estimate for the recipe, it always may.
export function addCheck(budget: number | null, spend: Spend, cost: number | null)
  : { ok: true } | { ok: false; over: number } {
  if (budget === null || cost === null) return { ok: true };
  const over = cents(spend.total + cost - budget);
  return over > 0 ? { ok: false, over } : { ok: true };
}

// Slots filled out of days × slots switched on: a slot-day counts once however many meals it
// holds, so two snacks on a day fill one. Meals still in the tray count, by their slot.
export interface SlotCount {
  slot: Slot;
  label: string;
  meals: number;
  filled: number;
  days: number;
}

export function slotCounts(d: MealPlanDraft): SlotCount[] {
  return SLOTS.filter((sl) => d.prefs.slots_on.includes(sl)).map((slot) => {
    const meals = d.meals.filter((m) => m.slot === slot).length;
    return { slot, label: SLOT_LABELS[slot], meals, filled: Math.min(meals, d.days), days: d.days };
  });
}

export interface BudgetBar {
  budget: number | null;
  spent: number;
  atLeast: boolean;                // some recipe's cost is unknown
  remaining: number | null;        // negative: over the budget
  filled: number;
  slots: number;
}

export function budgetBar(s: MealPlanState, spend: Spend): BudgetBar {
  const budget = budgetOf(s.draft.prefs);
  const counts = slotCounts(s.draft);
  return {
    budget,
    spent: spend.total,
    atLeast: spend.unknown.length > 0,
    remaining: budget === null ? null : cents(budget - spend.total),
    filled: counts.reduce((t, c) => t + c.filled, 0),
    slots: counts.reduce((t, c) => t + c.days, 0),
  };
}

// The bar's parts, as the shopper reads them and a screen reader hears them.
export function budgetBarText(b: BudgetBar): { budget: string; spent: string; remaining: string; slots: string } {
  const spent = `${b.atLeast ? 'at least ' : ''}${money(b.spent)}`;
  let remaining = 'no budget set';
  if (b.remaining !== null) {
    remaining = b.remaining < 0 ? `${money(-b.remaining)} over`
      : `${b.atLeast ? 'at most ' : ''}${money(b.remaining)} left`;
  }
  return {
    budget: b.budget === null ? 'no budget' : money(b.budget),
    spent,
    remaining,
    slots: `${b.filled} of ${b.slots} slots filled`,
  };
}

// A real total (whole packs, from the basket or a trip plan) against the budget:
// "$142.10 · budget $150.00 · $7.90 left", "at least $160.20 · budget $150.00 · $10.20 over".
export function againstBudget(total: number | null, atLeast: boolean, budget: number | null)
  : { text: string; over: boolean } {
  const t = total === null ? 'price unknown' : `${atLeast ? 'at least ' : ''}${money(total)}`;
  if (budget === null) return { text: `${t} · no budget set`, over: false };
  if (total === null) return { text: `${t} · budget ${money(budget)}`, over: false };
  const left = cents(budget - total);
  return left < 0
    ? { text: `${t} · budget ${money(budget)} · ${money(-left)} over`, over: true }
    : { text: `${t} · budget ${money(budget)} · ${atLeast ? 'at most ' : ''}${money(left)} left`, over: false };
}

// ─── Sections ────────────────────────────────────────────────

// One meal's section of cards. shown: recipes that fit the diet, and any already in the plan;
// hidden: the rest ("n hidden by your diet"), each with its reason. Snack starts collapsed.
export interface Section {
  slot: Slot;
  label: string;
  shown: CatalogRecipe[];
  hidden: CatalogRecipe[];
  collapsed: boolean;
  count: SlotCount;
  // more meals than the days have room for: the rest wait in the tray
  overflow: number;
}

export function catalogSections(c: MealCatalog, s: MealPlanState): Section[] {
  const d = s.draft;
  const counts = new Map(slotCounts(d).map((x) => [x.slot, x]));
  return SLOTS.filter((sl) => d.prefs.slots_on.includes(sl)).map((slot) => {
    const here = c.recipes.filter((r) => r.slot === slot && !isMine(r));
    const count = counts.get(slot) as SlotCount;
    return {
      slot, label: SLOT_LABELS[slot],
      shown: here.filter((r) => r.fits || Boolean(d.recipes[r.key])),
      hidden: here.filter((r) => !r.fits && !d.recipes[r.key]),
      collapsed: slot === 'snack',
      count,
      overflow: Math.max(0, count.meals - d.days * CAPACITY[slot]),
    };
  });
}

// The shopper's own recipes, split the same way.
export function ownRecipes(c: MealCatalog, s: MealPlanState): { shown: CatalogRecipe[]; hidden: CatalogRecipe[] } {
  const mine = c.recipes.filter(isMine);
  return {
    shown: mine.filter((r) => r.fits || Boolean(s.draft.recipes[r.key])),
    hidden: mine.filter((r) => !r.fits && !s.draft.recipes[r.key]),
  };
}

// Recipes in the plan the catalog does not list (added another way, or from an older plan).
export function notInCatalog(c: MealCatalog, s: MealPlanState): string[] {
  const known = byKey(c);
  return Object.keys(s.draft.recipes).filter((k) => !known.has(k));
}

// "2 hidden by your diet"
export const hiddenText = (n: number) => `${plural(n, 'recipe', 'recipes')} hidden by your diet`;

// What the shopper hears after an Add, with the budget: "… About $41.20 left of $150.00."
export function budgetSaid(b: BudgetBar): string {
  if (b.budget === null || b.remaining === null) return '';
  return b.remaining < 0 ? `The estimate is ${money(-b.remaining)} over your ${money(b.budget)} budget.`
    : `About ${money(b.remaining)} left of ${money(b.budget)}.`;
}
