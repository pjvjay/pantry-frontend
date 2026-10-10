// The wizard's Meals stage: the catalog request, recipe cards by meal, and the budget bar's
// arithmetic (an estimate that leaves an unknown out says so, and is never 0).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_OWN, addCheck, addCost, addCostText, againstBudget, budgetBar, budgetBarText, budgetSaid, byKey, catalogRequest,
  catalogSections, cleanRef, costPerMealText, dietBadge, estimateText, estimatedSpend, excludedWords, hiddenText,
  notInCatalog, ownRecipes, packCost, picksOf, slotCounts, unavailableText,
} from '../src/mealplan/catalog.ts';
import type { Pick } from '../src/mealplan/catalog.ts';
import { docRef } from '../src/mealplan/model.ts';
import type { CatalogLine, CatalogRecipe, MealCatalog, RecipeDoc } from '../src/types.ts';
import { add, planWith, run } from './helpers/mealplan.ts';

function recipe(key: string, title: string, over: Partial<CatalogRecipe> = {}): CatalogRecipe {
  return {
    key, ref: { key, starter: key.replace(/^starter:/, '') }, title, slot: 'dinner', diets: [],
    contains: [], servings: 4, fits: true, why_not: null, est_cost_per_meal: 5, lines_total: 6,
    lines_priced: 6, unavailable: [], ...over,
  };
}

const doc = (id: string, title: string): RecipeDoc => ({ key: `my:${id}`, title, lines: [] } as unknown as RecipeDoc);

const CATALOG: MealCatalog = {
  v: 1, est_basis: 'Each line’s share of its pack price; trips buy whole packs.', latency_ms: 4,
  recipes: [
    recipe('starter:oat_porridge', 'Oat Porridge', { slot: 'breakfast', diets: ['vegan', 'vegetarian', 'pescatarian'], est_cost_per_meal: 1.2 }),
    recipe('starter:pepperoni_pizza', 'Pepperoni Pizza', { est_cost_per_meal: 6.5 }),
    recipe('starter:chicken_fried_rice', 'Chicken Fried Rice', { fits: false, why_not: 'contains meat' }),
    recipe('starter:salmon_bowl', 'Salmon Bowl', { fits: false, why_not: 'contains fish' }),
    recipe('starter:mango_milkshake', 'Mango Milkshake', { slot: 'snack', est_cost_per_meal: null, lines_priced: 0 }),
    recipe('my:dal', 'Dal', { ref: { key: 'my:dal', doc: doc('dal', 'Dal') }, diets: ['vegan'] }),
    recipe('my:steak', 'Steak', { ref: { key: 'my:steak', doc: doc('steak', 'Steak') }, fits: false, why_not: 'contains meat' }),
  ],
};

test('the catalog is asked for the household, its diet, where it shops and its own recipes', () => {
  let s = planWith(14);
  s = run(s, { type: 'setPrefs', prefs: { household_servings: 3, diet: 'vegetarian', avoid: ['nuts'],
    slots_on: ['breakfast', 'dinner'] } });
  const mine = Array.from({ length: MAX_OWN + 3 }, (_, i) => doc(String(i), `Mine ${i}`));
  const req = catalogRequest(s.draft, mine);
  assert.equal(req.household_servings, 3);
  assert.equal(req.diet, 'vegetarian');
  assert.deepEqual(req.avoid, ['nuts']);
  assert.deepEqual(req.slots, ['breakfast', 'dinner']);
  assert.deepEqual(req.settings, s.draft.settings);
  assert.equal(req.recipes?.length, MAX_OWN);
  assert.deepEqual(req.recipes?.[0], docRef(mine[0]));
  assert.equal('recipes' in catalogRequest(s.draft, []), false);
  // a plan saved before the wizard asks for any diet, nothing avoided
  const old = { ...s.draft, prefs: { ...s.draft.prefs, diet: undefined, avoid: undefined } };
  assert.equal(catalogRequest(old, []).diet, 'any');
  assert.deepEqual(catalogRequest(old, []).avoid, []);
});

test('the catalog is sent the plan\'s pins, so a card costs the product the shopper chose', () => {
  const s = planWith(7);
  assert.equal('pins' in catalogRequest(s.draft, []), false);
  const pinned = { ...s.draft, pins: { 'lib:tomato_penne': { '4': 16 } } };
  assert.deepEqual(catalogRequest(pinned, []).pins, { 'lib:tomato_penne': { '4': 16 } });
});

test('a card says its diet, what a meal costs, and what is not sold nearby', () => {
  assert.equal(dietBadge(['vegan', 'vegetarian', 'pescatarian']), 'vegan');
  assert.equal(dietBadge(['pescatarian']), 'pescatarian');
  assert.equal(dietBadge([]), null);
  assert.equal(costPerMealText(recipe('a', 'A', { est_cost_per_meal: 3.2 })), 'about $3.20 a meal');
  assert.equal(costPerMealText(recipe('a', 'A', { est_cost_per_meal: 2.1, lines_priced: 3, lines_total: 5 })),
    'at least $2.10 a meal (3 of 5 ingredients priced)');
  assert.equal(costPerMealText(recipe('a', 'A', { est_cost_per_meal: null })), 'cost unknown');
  assert.deepEqual(unavailableText(recipe('a', 'A', { unavailable: ['saffron', 'ghee'] })), ['Not sold nearby: saffron, ghee']);
  assert.deepEqual(unavailableText(recipe('a', 'A')), []);
  // what only the origin rule keeps out is said as that
  assert.deepEqual(unavailableText(recipe('a', 'A', { unavailable: ['Yellow Onion', 'saffron'], held_back: ['Yellow Onion'] }),
    ['United States']), ['Only US-origin nearby, left out by your rule: Yellow Onion', 'Not sold nearby: saffron']);
  assert.equal(excludedWords(['United States', 'China']), 'from United States and China');
  assert.equal(excludedWords([]), 'excluded-origin');
  // the ref goes into the plan with its one source only
  assert.deepEqual(cleanRef({ key: 'starter:x', starter: 'x', slug: null as never, doc: null as never }),
    { key: 'starter:x', starter: 'x' });
});

test('sections by meal: what fits, what is in the plan anyway, and the rest hidden with a count', () => {
  let s = planWith(7, add('chicken_fried_rice', 'Chicken Fried Rice', 1));
  const sections = catalogSections(CATALOG, s);
  assert.deepEqual(sections.map((x) => [x.slot, x.collapsed]),
    [['breakfast', false], ['lunch', false], ['dinner', false], ['snack', true]]);
  const dinner = sections[2];
  // Chicken Fried Rice no longer fits, but it is in the plan, so it stays in view
  assert.deepEqual(dinner.shown.map((r) => r.title), ['Pepperoni Pizza', 'Chicken Fried Rice']);
  assert.deepEqual(dinner.hidden.map((r) => [r.title, r.why_not]), [['Salmon Bowl', 'contains fish']]);
  assert.equal(hiddenText(dinner.hidden.length), '1 recipe hidden by your diet');
  assert.deepEqual(ownRecipes(CATALOG, s).shown.map((r) => r.title), ['Dal']);
  assert.deepEqual(ownRecipes(CATALOG, s).hidden.map((r) => r.title), ['Steak']);
  s = run(s, { type: 'setPrefs', prefs: { slots_on: ['dinner'] } });
  assert.deepEqual(catalogSections(CATALOG, s).map((x) => x.slot), ['dinner']);
  s = run(s, add('lentil_soup', 'Lentil Soup', 1));
  assert.deepEqual(notInCatalog(CATALOG, s), ['starter:lentil_soup']);
});

test('slots filled out of days × slots on: a slot-day counts once, tray meals by their slot', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 9), add('mango_milkshake', 'Mango Milkshake', 3, 'snack'),
    add('oat_porridge', 'Oat Porridge', 2, 'breakfast'));
  const counts = slotCounts(s.draft);
  assert.deepEqual(counts.map((c) => [c.slot, c.meals, c.filled, c.days]),
    [['breakfast', 2, 2, 7], ['lunch', 0, 0, 7], ['dinner', 9, 7, 7], ['snack', 3, 3, 7]]);
  const dinner = catalogSections(CATALOG, s)[2];
  assert.equal(dinner.overflow, 2, 'two dinners more than the week holds');
  const bar = budgetBar(s, estimatedSpend(s, byKey(CATALOG)));
  assert.equal(bar.filled, 12);
  assert.equal(bar.slots, 28);
});

test('the estimate is meals × each recipe\'s cost a meal; an unknown is left out and said', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 3), add('oat_porridge', 'Oat Porridge', 5, 'breakfast'));
  let spend = estimatedSpend(s, byKey(CATALOG));
  // an older API's recipes (no lines): meals × the estimate a meal
  assert.deepEqual(spend, { total: 25.5, unknown: [], unpriced: [] });   // 3 × 6.50 + 5 × 1.20
  s = run(s, add('mango_milkshake', 'Mango Milkshake', 2, 'snack'), add('lentil_soup', 'Lentil Soup', 1),
    add('chicken_fried_rice', 'Chicken Fried Rice', 0));
  spend = estimatedSpend(s, byKey(CATALOG));
  assert.deepEqual(spend, { total: 25.5, unknown: ['Mango Milkshake', 'Lentil Soup'], unpriced: [] },
    'no meals, no cost');
  assert.deepEqual(estimatedSpend(s, byKey(null)).total, 0);
});

test('an Add that would pass the budget is stopped with the amount over; one with no estimate is not', () => {
  const spend = { total: 44.1, unknown: [] };
  assert.deepEqual(addCheck(50, spend, 5.9), { ok: true }, 'exactly the budget is within it');
  assert.deepEqual(addCheck(50, spend, 6.5), { ok: false, over: 0.6 });
  assert.deepEqual(addCheck(null, spend, 600), { ok: true }, 'no budget');
  assert.deepEqual(addCheck(50, spend, null), { ok: true }, 'cost unknown');
  assert.deepEqual(addCheck(40, spend, 1), { ok: false, over: 5.1 }, 'already over');
});

test('the budget bar: budget, estimated spend, what is left or over, and the slots', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 3));
  s = run(s, { type: 'setPrefs', prefs: { budget: 50 } });
  let bar = budgetBar(s, estimatedSpend(s, byKey(CATALOG)));
  assert.deepEqual(bar, { budget: 50, spent: 19.5, atLeast: false, remaining: 30.5, filled: 3, slots: 28 });
  assert.deepEqual(budgetBarText(bar), { budget: '$50.00', spent: '$19.50', remaining: '$30.50 left',
    slots: '3 of 28 slots filled' });
  assert.equal(budgetSaid(bar), 'About $30.50 left of $50.00.');
  s = run(s, add('mango_milkshake', 'Mango Milkshake', 1, 'snack'), { type: 'setPrefs', prefs: { budget: 10 } });
  bar = budgetBar(s, estimatedSpend(s, byKey(CATALOG)));
  assert.equal(budgetBarText(bar).spent, 'at least $19.50');
  assert.equal(budgetBarText(bar).remaining, '$9.50 over');
  assert.equal(budgetSaid(bar), 'The estimate is $9.50 over your $10.00 budget.');
  s = run(s, { type: 'setPrefs', prefs: { budget: 100 } });
  assert.equal(budgetBarText(budgetBar(s, estimatedSpend(s, byKey(CATALOG)))).remaining, 'at most $80.50 left');
  s = run(s, { type: 'setPrefs', prefs: { budget: null } });
  bar = budgetBar(s, estimatedSpend(s, byKey(CATALOG)));
  assert.equal(budgetBarText(bar).budget, 'no budget');
  assert.equal(budgetBarText(bar).remaining, 'no budget set');
  assert.equal(budgetSaid(bar), '');
});

test('a real total against the budget: left, over, unknown, or no budget', () => {
  assert.deepEqual(againstBudget(142.1, false, 150), { text: '$142.10 · budget $150.00 · $7.90 left', over: false });
  assert.deepEqual(againstBudget(160.2, true, 150),
    { text: 'at least $160.20 · budget $150.00 · $10.20 over', over: true });
  assert.deepEqual(againstBudget(120, true, 150),
    { text: 'at least $120.00 · budget $150.00 · at most $30.00 left', over: false });
  assert.deepEqual(againstBudget(null, false, 150), { text: 'price unknown · budget $150.00', over: false });
  assert.deepEqual(againstBudget(80, false, null), { text: '$80.00 · no budget set', over: false });
});

// ─── Whole packs ─────────────────────────────────────────────

const L = (ingredient: string, product_id: number | null, pack_price: number | null, pack_qty: number | null,
  need_per_meal: number | null, held_back = false): CatalogLine =>
  ({ ingredient, product_id, pack_price, pack_qty, pack_uom: 'g', need_per_meal, held_back });

// Two recipes sharing a 2 kg bag of rice ($5.00): one needs 300 g a meal, the other 200 g.
const RICE_BOWL = recipe('starter:rice_bowl', 'Rice Bowl', { lines: [
  L('rice', 7, 5, 2000, 300), L('soy sauce', 8, 3.5, 500, 15), L('ginger', 9, 1.2, null, 10),
  L('yellow onion', 10, 0.9, 200, 100, true), L('saffron', null, null, null, 1)] });
const CONGEE = recipe('starter:congee', 'Ginger Congee', { slot: 'breakfast', lines: [
  L('rice', 7, 5, 2000, 200), L('ginger', 9, 1.2, null, null), L('scallion', 11, null, 100, 10)] });
const pick = (r: CatalogRecipe, meals: number): Pick => ({ key: r.key, title: r.title, meals, recipe: r });

test('a selection costs whole packs: each product once, enough packs for every meal that uses it', () => {
  // rice 3 × 300 + 4 × 200 = 1700 g: one bag; soy 45 g: one bottle; ginger (no pack size): one
  assert.deepEqual(packCost([pick(RICE_BOWL, 3), pick(CONGEE, 4)]),
    { total: 9.7, unknown: [], unpriced: ['saffron', 'scallion'] });
  // 5 × 300 + 4 × 200 = 2300 g: two bags
  assert.equal(packCost([pick(RICE_BOWL, 5), pick(CONGEE, 4)]).total, 14.7);
  // exactly a bag is one bag
  assert.equal(packCost([pick(RICE_BOWL, 4), pick(CONGEE, 4)]).total, 9.7);
  // a recipe with no meals buys nothing; an onion held back by the origin rule is never priced
  assert.deepEqual(packCost([pick(RICE_BOWL, 0)]), { total: 0, unknown: [], unpriced: [] });
  // a line whose need is unknown is at least one pack of its product
  const unknownNeed = recipe('x', 'X', { lines: [L('oil', 12, 6, 1000, null)] });
  assert.equal(packCost([pick(unknownNeed, 9)]).total, 6);
  // an older API's recipe: the estimate a meal, or unknown
  assert.deepEqual(packCost([pick(recipe('y', 'Y', { est_cost_per_meal: 2 }), 3), pick(recipe('z', 'Z', { est_cost_per_meal: null }), 1)]),
    { total: 6, unknown: ['Z'], unpriced: [] });
});

test('a card says what one more meal adds: nothing when the packs chosen cover it', () => {
  const picks = [pick(RICE_BOWL, 3), pick(CONGEE, 4)];
  assert.deepEqual(addCost(picks, CONGEE), { cost: 0, atLeast: true });       // 1900 g: still one bag
  assert.equal(addCostText(addCost(picks, CONGEE)), 'adds nothing priced: your packs cover it');
  assert.deepEqual(addCost([...picks.slice(0, 1), pick(CONGEE, 5)], CONGEE), { cost: 5, atLeast: true });  // 2100 g
  // a recipe not in the selection yet: its first meal
  const fresh = recipe('starter:tea', 'Tea', { lines: [L('tea', 20, 4.25, 100, 2)] });
  assert.deepEqual(addCost(picks, fresh), { cost: 4.25, atLeast: false });
  assert.equal(addCostText(addCost(picks, fresh)), 'adds about $4.25');
  assert.equal(addCostText(addCost([], recipe('n', 'N', { lines: [L('salt', 1, 1, 1000, 1)] }))), 'adds about $1.00');
  assert.equal(addCostText(addCost([pick(fresh, 1)], fresh)), 'adds nothing: your packs cover it');
  assert.equal(addCost(picks, recipe('u', 'U', { est_cost_per_meal: null })), null);
  assert.equal(addCostText(null), 'cost unknown');
  // the budget stops the Add by what it adds, not by the meal's share
  const spend = packCost(picks);
  assert.deepEqual(addCheck(12, spend, addCost(picks, fresh)?.cost ?? null), { ok: false, over: 1.95 });
  assert.deepEqual(addCheck(12, spend, addCost(picks, CONGEE)?.cost ?? null), { ok: true });
});

test('the plan as a selection, and the bar says "at least" while an ingredient is not priced', () => {
  let s = planWith(7, add('rice_bowl', 'Rice Bowl', 2), add('congee', 'Ginger Congee', 1, 'breakfast'));
  s = run(s, { type: 'setPrefs', prefs: { budget: 20 } });
  const recipes = byKey({ v: 1, est_basis: '', latency_ms: 1, recipes: [RICE_BOWL, CONGEE] });
  assert.deepEqual(picksOf(s, recipes).map((p) => [p.key, p.meals]),
    [['starter:rice_bowl', 2], ['starter:congee', 1]]);
  const spend = estimatedSpend(s, recipes);
  assert.equal(spend.total, 9.7);
  const t = budgetBarText(budgetBar(s, spend));
  assert.equal(t.spent, 'at least $9.70');
  assert.equal(t.remaining, 'at most $10.30 left');
  assert.match(estimateText(spend), /^Estimated in whole packs, as your trips buy them: .* 2 ingredients are not priced and left out\./);
  assert.doesNotMatch(estimateText({ total: 1, unknown: [], unpriced: [] }), /not priced/);
});
