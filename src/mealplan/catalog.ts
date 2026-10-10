// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The wizard's Meals stage: recipe cards by meal from /mealplan/catalog, and the budget bar
// over them. The selection is priced as trips buy it, in whole packs: each product once, enough
// packs for every chosen meal that uses it (packCost), so the bar is close to what Ingredients
// and the Shopping plan will show. A card says what one more meal adds to that, which may be
// nothing when the packs already chosen cover it. A cost nobody knows is unknown, never 0: a
// total that leaves an ingredient out is "at least", and an Add whose cost is unknown is never
// stopped by the budget. "about $3.20 a meal" (pantry-api's share-of-the-pack estimate) stays on
// the card as a guide.
import { CAPACITY, SLOTS, SLOT_LABELS, avoidOf, budgetOf, dietOf, docRef, mealsOf, recipeTitle } from './model.ts';
import type { MealPlanState, Slot } from './model.ts';
import type { CatalogRecipe, CatalogRequest, MealCatalog, MealPlanDraft, RecipeDoc, RecipeRef } from '../types.ts';

// The shopper's own recipes sent for classifying, at most this many.
export const MAX_OWN = 20;

const cents = (v: number) => Math.round(v * 100) / 100;
export const money = (v: number) => `$${v.toFixed(2)}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const listOf = (parts: string[]) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// The request for the plan as it is: the household, its diet and avoid-tags, where it shops
// and its origin rules, the slots it plans, the shopper's own recipes, and the products the
// shopper chose in Ingredients (pins), so a card costs what the plan will buy.
export function catalogRequest(d: MealPlanDraft, mine: readonly RecipeDoc[]): CatalogRequest {
  const own = mine.slice(0, MAX_OWN).map(docRef);
  return {
    household_servings: d.prefs.household_servings,
    diet: dietOf(d.prefs),
    avoid: avoidOf(d.prefs),
    settings: d.settings,
    slots: [...d.prefs.slots_on],
    ...(own.length ? { recipes: own } : {}),
    ...(Object.keys(d.pins).length ? { pins: d.pins } : {}),
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

// What a plan's origin exclusion is called: "US-origin" for the default rule.
export function excludedWords(excluded: readonly string[]): string {
  if (excluded.length === 1 && excluded[0] === 'United States') return 'US-origin';
  return excluded.length ? `from ${listOf([...excluded])}` : 'excluded-origin';
}

// What cannot be bought, split by why: the origin rule (held_back) or no offer nearby.
export function unavailableText(r: CatalogRecipe, excluded: readonly string[] = []): string[] {
  const held = r.held_back ?? [];
  const rest = r.unavailable.filter((x) => !held.includes(x));
  return [
    held.length ? `Only ${excludedWords(excluded)} nearby, left out by your rule: ${held.join(', ')}` : '',
    rest.length ? `Not sold nearby: ${rest.join(', ')}` : '',
  ].filter(Boolean);
}

export const byKey = (c: MealCatalog | null): Map<string, CatalogRecipe> =>
  new Map((c?.recipes ?? []).map((r) => [r.key, r]));

// ─── Budget ──────────────────────────────────────────────────

// What a selection of meals costs in whole packs. unpriced: ingredients with no product or no
// price (left out, said as "n ingredients not priced"); unknown: recipes the catalog cannot price
// at all, by title. Both make the total "at least".
export interface Spend {
  total: number;
  unknown: string[];
  unpriced: string[];
}

// A recipe in the selection, with how many meals of it.
export interface Pick {
  key: string;
  title: string;
  meals: number;
  recipe: CatalogRecipe | undefined;
}

// Whole packs, as a trip buys them. Per product: the need of every chosen meal that uses it,
// over its pack size, rounded up; a product whose pack size is unknown, or with a line whose
// need is unknown, is at least one pack (one in all, however many recipes share it). A line held
// back by the origin rule buys nothing. A recipe from an older API, with no lines, counts its
// meals at pantry-api's estimate a meal.
export function packCost(picks: readonly Pick[]): Spend {
  const products = new Map<number, { price: number; qty: number | null; need: number; unknown: boolean }>();
  const unknown: string[] = [];
  const unpriced = new Set<string>();
  let total = 0;
  for (const p of picks) {
    if (p.meals <= 0) continue;
    const r = p.recipe;
    if (!r?.lines) {
      const est = r?.est_cost_per_meal ?? null;
      if (est === null) unknown.push(p.title);
      else total += est * p.meals;
      continue;
    }
    for (const ln of r.lines) {
      if (ln.held_back) continue;
      if (ln.product_id === null || ln.pack_price === null) {
        unpriced.add(ln.ingredient.toLowerCase());
        continue;
      }
      const qty = ln.pack_qty !== null && ln.pack_qty > 0 ? ln.pack_qty : null;
      const e = products.get(ln.product_id) ?? { price: ln.pack_price, qty, need: 0, unknown: false };
      if (ln.need_per_meal === null || e.qty === null) e.unknown = true;
      else e.need += ln.need_per_meal * p.meals;
      products.set(ln.product_id, e);
    }
  }
  for (const e of products.values()) {
    // a hair under a whole pack is that pack, not one more (floating-point sums)
    const packs = e.qty === null ? 1 : Math.max(Math.ceil(e.need / e.qty - 1e-9), e.unknown ? 1 : 0);
    total += packs * e.price;
  }
  return { total: cents(total), unknown, unpriced: [...unpriced].sort() };
}

// The plan's recipes as a selection: each with its meals and its catalog entry.
export function picksOf(s: MealPlanState, recipes: Map<string, CatalogRecipe>): Pick[] {
  return Object.keys(s.draft.recipes).map((key) => ({
    key, title: recipeTitle(s, key), meals: mealsOf(s.draft, key).length, recipe: recipes.get(key),
  }));
}

export function estimatedSpend(s: MealPlanState, recipes: Map<string, CatalogRecipe>): Spend {
  return packCost(picksOf(s, recipes));
}

// What one more meal of a recipe adds to the selection's whole-pack cost (0 when the packs
// already chosen cover it), and whether that is "at least" (some of its ingredients have no
// price). null: the catalog cannot price the recipe at all.
export function addCost(picks: readonly Pick[], r: CatalogRecipe): { cost: number; atLeast: boolean } | null {
  if (!r.lines && r.est_cost_per_meal === null) return null;
  const before = packCost(picks);
  const at = picks.findIndex((p) => p.key === r.key);
  const more = at < 0 ? [...picks, { key: r.key, title: r.title, meals: 1, recipe: r }]
    : picks.map((p, i) => (i === at ? { ...p, recipe: r, meals: p.meals + 1 } : p));
  const after = packCost(more);
  const atLeast = (r.lines ?? []).some((ln) => !ln.held_back && (ln.product_id === null || ln.pack_price === null));
  return { cost: cents(Math.max(0, after.total - before.total)), atLeast };
}

// The card's line: "adds about $4.10", "adds at least $2.00", or that the packs already chosen
// cover it.
export function addCostText(a: { cost: number; atLeast: boolean } | null): string {
  if (a === null) return 'cost unknown';
  if (a.cost < 0.005) return a.atLeast ? 'adds nothing priced: your packs cover it' : 'adds nothing: your packs cover it';
  return `adds ${a.atLeast ? 'at least' : 'about'} ${money(a.cost)}`;
}

// How the bar's estimate is made, under it.
export function estimateText(spend: Spend): string {
  const left = spend.unpriced.length
    ? ` ${plural(spend.unpriced.length, 'ingredient is', 'ingredients are')} not priced and left out.` : '';
  return 'Estimated in whole packs, as your trips buy them: each product once, enough packs for every '
    + `meal chosen, at its lowest price nearby.${left} Shopping on more than one day can buy a product `
    + 'twice, so the Shopping plan may cost more.';
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
    atLeast: spend.unknown.length > 0 || spend.unpriced.length > 0,
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
