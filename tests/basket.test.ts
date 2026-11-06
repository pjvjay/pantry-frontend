// The wizard's Ingredients stage: each recipe's ingredients as the plan would buy them, and
// which ones no store nearby sells still need the shopper's answer. The fixture is shaped as
// pantry-api's /mealplan/basket answers (fixtures/mealplan-basket.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  originCoverage, originCoverageText,
  basketAtLeast, basketKey, basketView, lineIssue, originText, unansweredCount, unansweredGroups, unavailableHeading,
} from '../src/mealplan/basket.ts';
import type { MealBasket } from '../src/types.ts';
import { D, add, planWith, run } from './helpers/mealplan.ts';

const BASKET: MealBasket = JSON.parse(readFileSync(new URL('./fixtures/mealplan-basket.json', import.meta.url), 'utf8'));
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
  assert.deepEqual(dough.origin, { text: 'Made in Canada, ingredients may be imported · a preferred origin', flag: false });
  assert.deepEqual(dough.labels, ['fresh']);
  assert.equal(dough.optionsLabel, 'Options for pizza dough: now Pizza Dough Ball 500g, $3.49 at Pantry Mart Downtown');
  assert.equal(salt.store, 'GreenLeaf Grocers Kitsilano', 'distance unknown: none claimed');
  assert.deepEqual(salt.origin, { text: 'origin unknown', flag: false });
  assert.equal(salt.pinned, true);
  assert.equal(salt.shared, 'also bought for Chicken Fried Rice');
  assert.equal(basil.store, 'no store nearby');
  assert.equal(basil.price, 'price unknown');
  assert.equal(basil.cost, '');
  assert.deepEqual(basil.labels, ['organic', 'demo product']);
  assert.equal(basil.origin.text, 'From Mexico · a preferred origin');
  assert.equal(basil.heading, 'Sold only beyond your distance');
  assert.equal(basil.why, 'no store within 5 km sells it');
  assert.equal(dough.heading, '');
  const rice = view.recipes[1].lines;
  assert.deepEqual(rice[0].origin, { text: 'origin unclear: sources disagree', flag: true });
  assert.equal(rice[1].product, null);
  assert.equal(rice[1].heading, 'Only US-origin nearby, left out by your rule');
  assert.equal(rice[1].why, '');
  assert.equal(rice[1].optionsLabel, 'Options for shaoxing wine: nothing chosen yet, not sold nearby');
});

test('what no store nearby sells needs an answer: skipping it, other meals, or another product', () => {
  let s = plan();
  let view = basketView(BASKET, s);
  assert.deepEqual(view.unanswered.map((l) => [l.recipeKey, l.ingredient, l.heading]), [
    [PIZZA, 'fresh basil', 'Sold only beyond your distance'],
    [RICE, 'shaoxing wine', 'Only US-origin nearby, left out by your rule'],
  ]);
  assert.deepEqual(unansweredGroups(view.unanswered).map((g) => [g.heading, g.lines.length]),
    [['Sold only beyond your distance', 1], ['Only US-origin nearby, left out by your rule', 1]]);
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

test('an origin reads as the evidence words it, else the country, else unknown; a conflict is flagged', () => {
  assert.deepEqual(originText({ country: null, claim: '', status: 'evidenced', preferred_rank: null }),
    { text: 'origin unknown', flag: false });
  assert.deepEqual(originText({ country: 'Japan', claim: '', status: 'evidenced', preferred_rank: null }),
    { text: 'Japan', flag: false });
  // the claim is shown as pantry-api words it
  assert.deepEqual(originText({ country: 'Thailand', claim: 'From Thailand', status: 'evidenced', preferred_rank: null }),
    { text: 'From Thailand', flag: false });
  assert.deepEqual(originText({ country: 'Canada', claim: 'Made in Canada, ingredients may be imported',
    status: 'evidenced', preferred_rank: 1 }),
  { text: 'Made in Canada, ingredients may be imported · a preferred origin', flag: false });
  assert.deepEqual(originText({ country: null, claim: 'Labels disagree: Canada or Mexico', status: 'conflicting',
    preferred_rank: null }), { text: 'Labels disagree: Canada or Mexico', flag: true });
});

test('why an ingredient cannot be bought: the origin rule, nothing stocked, or the distance', () => {
  assert.equal(unavailableHeading('origin_excluded', ['United States']), 'Only US-origin nearby, left out by your rule');
  assert.equal(unavailableHeading('origin_excluded', ['China']), 'Only from China nearby, left out by your rule');
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
    { kind: 'origin_excluded', label: 'Only US-origin nearby, left out by your rule' });
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

test('origin coverage counts each product once, and only evidenced origins as known', () => {
  const ids = new Map<number, boolean>();
  for (const r of BASKET.recipes) for (const l of r.lines) {
    if (l.product) ids.set(l.product.id, (ids.get(l.product.id) ?? false) || l.origin.status === 'evidenced');
  }
  const c = originCoverage(BASKET);
  assert.equal(c.total, ids.size);
  assert.equal(c.known, [...ids.values()].filter(Boolean).length);
  assert.ok(c.known > 0 && c.known < c.total, 'the fixture has both, so both branches are read');

  const none: MealBasket = { ...BASKET, recipes: BASKET.recipes.map((r) => ({
    ...r, lines: r.lines.map((l) => ({ ...l, origin: { ...l.origin, status: 'unknown' as const } })) })) };
  assert.equal(originCoverage(none).known, 0);
  const conflicting: MealBasket = { ...BASKET, recipes: BASKET.recipes.map((r) => ({
    ...r, lines: r.lines.map((l) => ({ ...l, origin: { ...l.origin, status: 'conflicting' as const } })) })) };
  assert.equal(originCoverage(conflicting).known, 0, 'a conflicting record is not a known origin');

  assert.equal(originCoverageText({ known: 0, total: 0 }), null);
  assert.equal(originCoverageText({ known: 3, total: 3 }), 'Origin is known for 3 of 3 products: your origin rules apply to all of them.');
  assert.equal(originCoverageText({ known: 0, total: 1 }),
    'Origin is known for 0 of 1 product: your origin rules (leave out, prefer) can only act on products whose origin is known.');
});
