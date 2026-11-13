// The wizard's Ingredients stage: each recipe's ingredients as the plan would buy them, and
// which ones no store nearby sells still need the shopper's answer. The fixtures are shaped as
// pantry-api's /mealplan/basket answers: an older one, which says nothing of what the origin rule
// left out (fixtures/mealplan-basket.json), and today's live answer for tomato penne, spaghetti
// bolognese and the beef rice bowl under the default rules (fixtures/mealplan-basket-origin.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  basketAtLeast, basketKey, basketView, lineGrade, lineIssue, originSummary, unansweredCount, unavailableHeading,
} from '../src/mealplan/basket.ts';
import { libraryRef } from '../src/mealplan/model.ts';
import type { MealBasket, ResolvedLine, ResolvedRecipe } from '../src/types.ts';
import { D, add, planWith, run } from './helpers/mealplan.ts';

const BASKET: MealBasket = JSON.parse(readFileSync(new URL('./fixtures/mealplan-basket.json', import.meta.url), 'utf8'));
const LIVE: MealBasket = JSON.parse(readFileSync(new URL('./fixtures/mealplan-basket-origin.json', import.meta.url), 'utf8'));
const BOWL = 'lib:beef_rice_bowl';
const BOLOGNESE = 'lib:spaghetti_bolognese';

// The live answer's three library recipes, two dinners each, under the default rules.
const libPlan = () => planWith(7, ...([['beef_rice_bowl', 'Beef & Broccoli Rice Bowl'], ['spaghetti_bolognese',
  'Spaghetti Bolognese'], ['tomato_penne', 'Tomato Penne']] as const).map(([slug, title]) =>
  ({ type: 'addRecipe' as const, ref: libraryRef(slug), title, slot: 'dinner' as const, wanted: 2 })));
const PIZZA = 'starter:pepperoni_pizza';
const RICE = 'starter:chicken_fried_rice';

const plan = () => planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2), add('chicken_fried_rice', 'Chicken Fried Rice', 1));

test('each ingredient: its product, store and distance, price, origin and labels', () => {
  const view = basketView(BASKET, plan());
  assert.deepEqual(view.recipes.map((r) => [r.title, r.meals, r.lines.length]),
    [['Pepperoni Pizza', 2, 3], ['Chicken Fried Rice', 1, 2]], 'a recipe no longer in the plan is left out');
  const [dough, salt, basil] = view.recipes[0].lines;
  assert.equal(dough.product, 'Pizza Dough Ball 500g', 'the name already says its size');
  assert.equal(salt.product, 'Table Salt 1kg');
  assert.equal(dough.store, 'Pantry Mart Downtown · 1.2 km');
  assert.equal(dough.price, '$3.49 a pack');
  assert.equal(dough.cost, '$3.49 for these meals');
  assert.deepEqual([dough.origin.kind, dough.origin.words], ['made', 'Made in Canada · ingredients may be imported']);
  assert.deepEqual(dough.labels, ['fresh']);
  assert.equal(dough.optionsLabel, 'Options for pizza dough: now Pizza Dough Ball 500g, $3.49 at Pantry Mart Downtown');
  assert.equal(salt.store, 'GreenLeaf Grocers Kitsilano', 'distance unknown: none claimed');
  assert.equal(salt.origin.words, 'Origin unknown: check the label', 'the plan leaves US products out');
  assert.equal(salt.pinned, true);
  assert.equal(salt.shared, 'also bought for Chicken Fried Rice');
  assert.equal(basil.store, 'no store nearby');
  assert.equal(basil.price, 'price unknown');
  assert.equal(basil.cost, '');
  assert.deepEqual(basil.labels, ['organic', 'demo product']);
  assert.equal(basil.origin.words, 'Mexico', 'a country after the first preference is not marked');
  assert.equal(basil.heading, 'Sold only beyond your distance');
  assert.equal(basil.why, 'no store within 5 km sells it');
  assert.equal(dough.heading, '');
  const rice = view.recipes[1].lines;
  assert.equal(rice[0].origin.words, 'Origin unclear: check the label');
  assert.equal(rice[1].product, null);
  assert.equal(rice[1].heading, 'Every product nearby is from the United States, which your rule leaves out');
  assert.equal(rice[1].why, '');
  // an older API says nothing of what the rule left out: nothing is claimed either way
  assert.deepEqual(view.recipes.flatMap((r) => r.lines.map((l) => [l.held.length, l.leftOut])),
    [[0, null], [0, null], [0, null], [0, null], [0, null]]);
  assert.equal(rice[1].optionsLabel, 'Options for shaoxing wine: nothing chosen yet, not sold nearby');
});

test('what no store nearby sells needs an answer: skipping it, other meals, or another product', () => {
  let s = plan();
  let view = basketView(BASKET, s);
  assert.deepEqual(view.unanswered.map((l) => [l.recipeKey, l.ingredient, l.heading]), [
    [PIZZA, 'fresh basil', 'Sold only beyond your distance'],
    [RICE, 'shaoxing wine', 'Every product nearby is from the United States, which your rule leaves out'],
  ]);
  assert.equal(view.recipes[0].unanswered, 1);
  assert.equal(unansweredCount(BASKET, s), 2);
  // skip the basil
  s = run(s, { type: 'skipLine', recipeKey: PIZZA, lineNo: 5, ingredient: 'fresh basil', skip: true });
  view = basketView(BASKET, s);
  assert.equal(view.recipes[0].lines[2].skipped, true);
  assert.equal(unansweredCount(BASKET, s), 1);
  // no Chicken Fried Rice meals: nothing of it is bought, so nothing to answer
  assert.equal(unansweredCount(BASKET, run(s, { type: 'setWanted', key: RICE, wanted: 0 })), 0);
  // or take it out of the plan
  assert.equal(unansweredCount(BASKET, run(s, { type: 'removeRecipe', key: RICE })), 0);
  assert.equal(unansweredCount(null, s), 0);
});

test('the total says "at least" when a product it buys has no price', () => {
  assert.equal(basketAtLeast(BASKET), false, 'the unpriced basil is not sold nearby, so not bought');
  const priced = structuredClone(BASKET);
  priced.recipes[0].lines[0].price = null;
  assert.equal(basketAtLeast(priced), true);
});

test('the basket is asked again when what it depends on changes, not when a meal moves', () => {
  let s = plan();
  const key = basketKey(s.draft);
  const moved = run(s, { type: 'place', mealId: `${PIZZA}#1`, date: D(2), slot: 'dinner' });
  assert.equal(basketKey(moved.draft), key, 'placing a meal');
  assert.notEqual(basketKey(run(s, { type: 'setWanted', key: PIZZA, wanted: 3 }).draft), key, 'a count');
  assert.notEqual(basketKey(run(s, { type: 'pinProduct', recipeKey: PIZZA, lineNo: 3, productId: 9 }).draft), key);
  assert.notEqual(basketKey(run(s, { type: 'setPrefs', prefs: { household_servings: 4 } }).draft), key);
  assert.notEqual(basketKey(run(s, { type: 'setSettings', settings: { max_km: 3 } }).draft), key);
  s = run(s, { type: 'setResolved', resolved: [{ key: PIZZA, title: 'Pepperoni Pizza', status: 'ok', servings: 4,
    lines: [{ line_no: 1, product_id: 41 }] } as never] });
  assert.notEqual(basketKey(s.draft), key, 'products resolved');
  // the same plan built in another order is the same key
  assert.equal(basketKey({ ...s.draft, pins: { b: { 2: 1, 1: 3 }, a: {} } } as never),
    basketKey({ ...s.draft, pins: { a: {}, b: { 1: 3, 2: 1 } } } as never));
});

test('each line\'s origin tag, and what the rule left out of the lines the plan still buys', () => {
  const view = basketView(LIVE, libPlan());
  const [beef, rice, broccoli, garlic] = view.recipes[0].lines;
  assert.deepEqual([beef.product, beef.origin.words], ['Ground Beef Lean 450g', 'Canada · preferred']);
  assert.equal(rice.origin.words, 'India');
  assert.equal(broccoli.origin.words, 'Mexico');
  assert.equal(garlic.origin.words, 'Origin unclear: check the label');
  // what the rule left out for a row, under it, its claim kept on one line
  const words = (t: string | null) => t?.replace(/\u00a0/g, ' ') ?? null;
  assert.equal(words(beef.leftOut), 'Your rule left out Ground Beef Medium 900g (Product of USA)');
  assert.equal(words(broccoli.leftOut), 'Your rule left out Broccoli Crown (Grown in USA)');
  assert.equal(rice.leftOut, null, 'nothing was left out for it');
  const onions = view.recipes[1].lines[2];
  assert.equal(words(onions.leftOut), 'Your rule left out Yellow Onion (Grown in USA) and 1 more from the United States');
  assert.deepEqual(onions.held.map((h) => h.product), ['Yellow Onion', 'Organic Yellow Onions 2lb Bag']);
  // pantry-api's held_back is what the rule took out of the products the plan picks from, not what
  // it would have bought: the planner buys this penne with no rule at all (Penne Rigate, from
  // Italy), so the row says what was left out and claims no swap
  const penne = view.recipes[2].lines[0];
  assert.deepEqual([penne.product, penne.origin.words], ['Penne Rigate 500g', 'Italy']);
  assert.equal(words(penne.leftOut), 'Your rule left out Gluten-Free Penne 340g (Product of USA)');
  assert.ok(view.recipes.every((r) => r.lines.every((l) => !/instead/i.test(l.leftOut ?? ''))));
  assert.equal(view.recipes[1].lines[0].origin.words, 'Made in Canada · ingredients may be imported');
  assert.deepEqual(view.unanswered, [], 'the planner chose products from elsewhere by itself');
});

test('a product the shopper chose that the rule now leaves out: their pick named, in plain words', () => {
  // as pantry-api answers once Ground Beef Medium 900g is pinned on both recipes that buy ground beef
  const live = structuredClone(LIVE);
  for (const [key, no] of [[BOWL, 1], [BOLOGNESE, 2]] as const) {
    const r = live.recipes.find((x) => x.key === key)!;
    const i = r.lines.findIndex((l) => l.line_no === no);
    r.lines[i] = { ...r.lines[i], product: { id: 35, name: 'Ground Beef Medium 900g', size: '900g', labels: ['meat'],
      says_organic: false, demo_product: false }, store: null, price: null, cost_for_need: null, pinned: true,
    available: false, unavailable_kind: 'origin_excluded', origin: { country: 'United States', claim: 'From United States',
      status: 'evidenced', preferred_rank: null },
    why_unavailable: 'Ground Beef Medium 900g is evidenced as United States (ingredients), which this plan excludes' };
  }
  const view = basketView(live, libPlan());
  assert.deepEqual(view.unanswered.map((l) => [l.recipeKey, l.heading, l.why, l.blockKey]), [
    [BOWL, 'Your chosen product, Ground Beef Medium 900g, is from the United States (Product of USA), which your rule leaves out',
      '', 'pin:35'],
    [BOLOGNESE, 'Your chosen product, Ground Beef Medium 900g, is from the United States (Product of USA), which your rule leaves out',
      '', 'pin:35'],
  ]);
  const [bowl] = view.unanswered;
  assert.deepEqual(bowl.issue, { kind: 'origin_excluded', label: bowl.heading });
  assert.equal(bowl.leftOut, null, 'nothing is bought: the row asks for an answer');
  assert.equal(bowl.origin.words, 'United States · against your rule');
  // the schedule refuses the pin whatever is skipped: a skip is no answer to it
  assert.equal(bowl.skippable, false);
});

test('a product the planner chose that the rule now holds back: named as what is wrong, never "every product nearby"', () => {
  // as pantry-api answers a plan resolved before Ground Beef Medium 900g's evidence came in: the
  // planner's own pick, not pinned, held back first on its line; Ground Beef Lean (Canada) is sold
  // nearby all the while
  const live = structuredClone(LIVE);
  const medium = { product_id: 35, product: 'Ground Beef Medium 900g', country: 'United States', claim: 'Product of USA',
    field: 'ingredient_origin', store: 'ValueFoods East Van', price: 10.56 };
  for (const [key, no] of [[BOWL, 1], [BOLOGNESE, 2]] as const) {
    const r = live.recipes.find((x) => x.key === key)!;
    const i = r.lines.findIndex((l) => l.line_no === no);
    r.lines[i] = { ...r.lines[i], product: { id: 35, name: 'Ground Beef Medium 900g', size: '900g', labels: ['meat'],
      says_organic: false, demo_product: false }, store: null, price: null, cost_for_need: null, pinned: false,
    available: false, unavailable_kind: 'origin_excluded', origin: { country: 'United States', claim: 'From United States',
      status: 'evidenced', preferred_rank: null }, held_back: [medium],
    why_unavailable: 'Ground Beef Medium 900g is evidenced as United States (ingredients), which this plan excludes' };
  }
  let s = libPlan();
  const view = basketView(live, s);
  assert.deepEqual(view.unanswered.map((l) => [l.recipeKey, l.heading, l.why, l.blockKey, l.skippable]), [
    [BOWL, 'The planned product, Ground Beef Medium 900g, is from the United States (Product of USA), which your rule leaves out',
      '', 'planned:35', false],
    [BOLOGNESE, 'The planned product, Ground Beef Medium 900g, is from the United States (Product of USA), which your rule '
      + 'leaves out', '', 'planned:35', false],
  ]);
  assert.ok(LIVE.recipes.some((r) => r.lines.some((l) => l.available && l.product?.name === 'Ground Beef Lean'
    && l.origin.country === 'Canada')), 'the planner picks a Canadian ground beef nearby once it knows');
  // /mealplan/schedule still buys a planned product the rule holds back, so a skip kept from before
  // (or made by an older console) is no answer: the line stays to answer
  s = run(s, { type: 'skipLine', recipeKey: BOWL, lineNo: 1, ingredient: 'Ground Beef', skip: true });
  const again = basketView(live, s);
  assert.deepEqual(again.unanswered.map((l) => [l.recipeKey, l.skipped, l.answered]), [[BOWL, false, false],
    [BOLOGNESE, false, false]]);
  // with no product at all (every candidate held back), a skip is an answer: nothing is bought
  const none = structuredClone(live);
  const bowl = none.recipes.find((x) => x.key === BOWL)!;
  bowl.lines[0] = { ...bowl.lines[0], product: null, origin: { country: null, claim: 'Origin unknown', status: 'unknown',
    preferred_rank: null }, why_unavailable: 'all 2 candidates are evidenced as coming from United States, which this plan excludes' };
  const [first] = basketView(none, s).recipes[0].lines;
  assert.deepEqual([first.heading, first.why, first.skippable, first.skipped, first.answered],
    ['Every product nearby is from the United States, which your rule leaves out',
      'all 2 candidates are evidenced as coming from United States, which this plan excludes', true, true, true]);
});

test('what the country rules did across the basket, while the plan has any', () => {
  const s = libPlan();
  const summary = originSummary(LIVE, s);
  assert.deepEqual(summary && { ...summary, tally: summary.tally.replace(/\u00a0/g, ' ') }, {
    rule: 'No US products', did: 'your rule left out 6 products',
    tally: 'Your 11 products: Canada 5 · made in Canada 2 · Italy 1 · Mexico 1 · India 1 · 1 unclear: check the label',
    covered: 'Only products known to be from the United States can be left out: the 1 whose origin is not known stays in your plan.',
  });
  // an older API sends no count: the rule alone
  assert.deepEqual([originSummary({ ...LIVE, origin_held_back: undefined }, s)?.rule,
    originSummary({ ...LIVE, origin_held_back: undefined }, s)?.did], ['No US products', '']);
  // a recipe with no meals buys nothing, so its products are not counted
  const fewer = run(s, { type: 'setWanted', key: 'lib:tomato_penne', wanted: 0 }, { type: 'setWanted', key: BOLOGNESE, wanted: 0 });
  assert.equal(originSummary(LIVE, fewer)?.tally.replace(/\u00a0/g, ' '),
    'Your 5 products: Canada 2 · Mexico 1 · India 1 · 1 unclear: check the label');
  // a basket with nothing in it yet (the recipes' products still being checked): the rule alone
  const empty = { ...LIVE, origin_held_back: 0, recipes: LIVE.recipes.map((r) => ({ ...r, lines: [] })) };
  assert.deepEqual(originSummary(empty, s), { rule: 'No US products', did: '', tally: '', covered: null });
  // preferences only; and no rules at all, nothing to say
  const prefer = run(s, { type: 'setSettings', settings: { exclude_origin: [] } });
  assert.deepEqual([originSummary(LIVE, prefer)?.rule, originSummary(LIVE, prefer)?.did], ['Any country', 'Canada first']);
  assert.equal(originSummary(LIVE, run(s, { type: 'setSettings', settings: { exclude_origin: [], preference: [] } })), null);
});

test('why an ingredient cannot be bought: the origin rule, nothing stocked, or the distance', () => {
  assert.equal(unavailableHeading('origin_excluded', ['United States']),
    'Every product nearby is from the United States, which your rule leaves out');
  assert.equal(unavailableHeading('origin_excluded', ['China']), 'Every product nearby is from China, which your rule leaves out');
  assert.equal(unavailableHeading('not_stocked', []), 'No store nearby stocks it');
  assert.equal(unavailableHeading('out_of_range', []), 'Sold only beyond your distance');
  assert.equal(unavailableHeading(undefined, []), 'Not sold nearby', 'an older API');
});

test('a row with no match says what is wrong, and a matched one nothing', () => {
  const view = basketView(BASKET, plan());
  const [dough, salt, basil] = view.recipes[0].lines;
  assert.equal(dough.issue, null);
  assert.equal(salt.issue, null);
  assert.deepEqual(basil.issue, { kind: 'out_of_range', label: 'Sold only beyond your distance' });
  // held back by the origin rule, with no product left: the rule is what is wrong
  assert.deepEqual(view.recipes[1].lines[1].issue,
    { kind: 'origin_excluded', label: 'Every product nearby is from the United States, which your rule leaves out' });
  const us = ['United States'];
  assert.deepEqual(lineIssue({ available: false, productId: 7, kind: 'stores_off' }, us),
    { kind: 'stores_off', label: 'Sold only at stores you turned off' });
  assert.deepEqual(lineIssue({ available: false, productId: null, kind: 'not_stocked' }, us),
    { kind: 'not_stocked', label: 'No store nearby stocks it' });
  assert.deepEqual(lineIssue({ available: false, productId: null, kind: null }, us),
    { kind: 'no_product', label: 'No product matches it' }, 'an older API, nothing chosen');
  assert.deepEqual(lineIssue({ available: true, productId: null, kind: null }, us),
    { kind: 'no_product', label: 'No product matches it' }, 'sold nearby, but no product named');
  assert.deepEqual(lineIssue({ available: false, productId: 7, kind: null }, us),
    { kind: 'unknown', label: 'Not sold nearby' });
  assert.equal(lineIssue({ available: true, productId: 7, kind: null }, us), null);
});

test('a skipped row stays unmatched; its picture is asked by the product’s own name', () => {
  const s = run(plan(), { type: 'skipLine', recipeKey: PIZZA, lineNo: 5, ingredient: 'fresh basil', skip: true });
  const basil = basketView(BASKET, s).recipes[0].lines[2];
  assert.equal(basil.skipped, true);
  assert.equal(basil.issue?.kind, 'out_of_range');
  const [dough, salt] = basketView(BASKET, s).recipes[0].lines;
  assert.equal(dough.productName, 'Pizza Dough Ball 500g');
  assert.equal(salt.productName, 'Table Salt', 'not "Table Salt 1kg"');
  assert.equal(basketView(BASKET, s).recipes[1].lines[1].productName, null);
});

test('each recipe heading has its meal and its picture', () => {
  const view = basketView({ ...BASKET, recipes: BASKET.recipes.map((r) => (r.key === PIZZA
    ? { ...r, image: { kind: 'wiki' as const, title: 'Pepperoni pizza' } } : r)) }, plan());
  assert.deepEqual(view.recipes.map((r) => [r.slot, r.picture]), [
    ['dinner', { via: 'wiki', title: 'Pepperoni pizza', credit: 'Wikipedia' }],
    ['dinner', null],
  ]);
});

// A recipe's products as the check chose them: line_no → [product id, match].
const checked = (key: string, title: string, lines: Record<number, [number | null, ResolvedLine['match']]>): ResolvedRecipe => ({
  key, title, status: 'ok', message: '', servings: 2, servings_basis: 'source', label: null,
  lines: Object.entries(lines).map(([n, [pid, match]]) => ({ line_no: Number(n), name: '', quantity: null, unit: '',
    need_qty: null, need_uom: null, product_id: pid, product_name: null, match, amount_basis: null })),
  not_stocked: [], out_of_range: [], skipped: [], llm_cost_usd: 0, model_used: 'demo', burr_run: '', cached: false,
});

test('how sure each match is: the check\'s grade for its own pick, the shopper\'s for theirs, else none', () => {
  const s = run(plan(), { type: 'setResolved', resolved: [
    checked(PIZZA, 'Pepperoni Pizza', { 1: [41, 'exact'], 3: [122, 'exact'], 5: [77, 'generic'] }),
    checked(RICE, 'Chicken Fried Rice', { 2: [122, 'form'], 6: [null, null] }),
  ] });
  const [dough, salt, basil] = basketView(BASKET, s).recipes[0].lines;
  assert.deepEqual(dough.grade, { kind: 'same', label: 'Same item' });
  assert.deepEqual(salt.grade, { kind: 'yours', label: 'Your choice' }, 'pinned: the shopper chose it');
  assert.deepEqual(basil.grade, { kind: 'closest', label: 'Closest match' }, 'describing words dropped');
  const [riceSalt, wine] = basketView(BASKET, s).recipes[1].lines;
  assert.deepEqual(riceSalt.grade, { kind: 'yours', label: 'Your choice' });
  assert.equal(wine.grade, null, 'no product, no grade');
  assert.deepEqual(lineGrade({ product: BASKET.recipes[1].lines[0].product, pinned: false },
    { line_no: 2, name: '', quantity: null, unit: '', need_qty: null, need_uom: null, product_id: 122,
      product_name: null, match: 'form', amount_basis: null }), { kind: 'form', label: 'Same item, another form' });
  // the basket buys another product than the check picked (a newer answer): no guess
  const other = run(plan(), { type: 'setResolved', resolved: [checked(PIZZA, 'Pepperoni Pizza', { 1: [99, 'exact'] })] });
  assert.equal(basketView(BASKET, other).recipes[0].lines[0].grade, null);
  assert.equal(basketView(BASKET, plan()).recipes[0].lines[0].grade, null, 'not checked yet');
});

test('where each ingredient is bought, by the store\'s own name, for the map', () => {
  assert.deepEqual(basketView(BASKET, plan()).recipes[0].lines.map((l) => l.storeName),
    ['Pantry Mart Downtown', 'GreenLeaf Grocers Kitsilano', null]);
});
