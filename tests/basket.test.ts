// The wizard's Ingredients stage: each recipe's ingredients as the plan would buy them, and
// which ones no store nearby sells still need the shopper's answer. The fixture is shaped as
// pantry-api's /mealplan/basket answers (fixtures/mealplan-basket.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { basketAtLeast, basketKey, basketView, originText, unansweredCount } from '../src/mealplan/basket.ts';
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
  assert.equal(dough.product, 'Pizza Dough Ball 500g');
  assert.equal(dough.store, 'Pantry Mart Downtown · 1.2 km');
  assert.equal(dough.price, '$3.49 a pack');
  assert.equal(dough.cost, '$3.49 for these meals');
  assert.deepEqual(dough.origin, { text: 'Canada · a preferred origin', flag: false });
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
  assert.equal(basil.origin.text, 'Mexico (processed there) · a preferred origin');
  const rice = view.recipes[1].lines;
  assert.deepEqual(rice[0].origin, { text: 'origin unclear: sources disagree', flag: true });
  assert.equal(rice[1].product, null);
  assert.equal(rice[1].why, 'no store nearby sells it');
  assert.equal(rice[1].optionsLabel, 'shaoxing wine: nothing chosen');
});

test('what no store nearby sells needs an answer: skipping it, other meals, or another product', () => {
  let s = plan();
  let view = basketView(BASKET, s);
  assert.deepEqual(view.unanswered.map((l) => [l.recipeKey, l.ingredient, l.why]), [
    [PIZZA, 'fresh basil', 'no store within 5 km sells it'],
    [RICE, 'shaoxing wine', 'no store nearby sells it'],
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

test('an origin with no country or evidence is unknown; a conflict is flagged', () => {
  assert.deepEqual(originText({ country: null, claim: '', status: 'evidenced', preferred_rank: null }),
    { text: 'origin unknown', flag: false });
  assert.deepEqual(originText({ country: 'Japan', claim: 'full', status: 'evidenced', preferred_rank: null }),
    { text: 'Japan', flag: false });
  assert.deepEqual(originText({ country: 'Japan', claim: 'packed', status: 'evidenced', preferred_rank: null }),
    { text: 'Japan (packed)', flag: false });
});
