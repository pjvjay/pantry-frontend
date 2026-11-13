// Check ingredients' header and task list: how far the check has got and what it found, in words
// over a bar, and the ingredients nobody nearby sells pinned at the top with their answers. The
// basket fixture is pantry-api's /mealplan/basket answer (fixtures/mealplan-basket.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { basketCounts, basketView } from '../src/mealplan/basket.ts';
import {
  answerLabel, atRiskTasks, checkProgress, checkedText, issueText, recipeCountText, toAnswerText,
} from '../src/mealplan/check.ts';
import type { MealBasket } from '../src/types.ts';
import { add, planWith, run } from './helpers/mealplan.ts';

const BASKET: MealBasket = JSON.parse(readFileSync(new URL('./fixtures/mealplan-basket.json', import.meta.url), 'utf8'));
const PIZZA = 'starter:pepperoni_pizza';
const RICE = 'starter:chicken_fried_rice';
const plan = () => planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2), add('chicken_fried_rice', 'Chicken Fried Rice', 1));

test('while the recipes\' products are checked, the bar counts recipes and the words name them', () => {
  const one = checkProgress({ recipes: 4, checking: ['Dal', 'Congee'], failed: [], basket: 'waiting', counts: null });
  assert.deepEqual([one.state, one.head, one.note, one.value, one.max],
    ['products', 'Checking the products for Dal and Congee…', '2 of 4 recipes checked', 2, 4]);
  const many = checkProgress({ recipes: 4, checking: ['A', 'B', 'C'], failed: [], basket: 'waiting', counts: null });
  assert.equal(many.head, 'Checking the products for 3 recipes…', 'a count for more than two, as Next says it');
});

test('then the ingredients at the stores: no measure yet, so the bar sweeps', () => {
  const first = checkProgress({ recipes: 2, checking: [], failed: [], basket: 'waiting', counts: null });
  assert.deepEqual([first.state, first.head, first.value], ['ingredients', 'Checking the ingredients…', null]);
  // checked again after an edit: the last answer's count
  const again = checkProgress({ recipes: 2, checking: [], failed: [], basket: 'waiting',
    counts: { lines: 35, found: 33, unanswered: 2, skipped: 0 } });
  assert.equal(again.head, 'Checking 35 ingredients…');
  assert.equal(again.value, null);
});

test('found: how many of how many nearby, what is left to answer or was skipped', () => {
  const s = plan();
  const counts = basketCounts(BASKET, s);
  const p = checkProgress({ recipes: 2, checking: [], failed: [], basket: 'ok', counts });
  assert.deepEqual([p.state, p.head, p.note, p.value, p.open, p.skipped, p.max],
    ['done', '3 of 5 found nearby', '2 to answer', 3, 2, 0, 5]);
  assert.equal(checkedText(p), '3 of 5 found nearby, 2 to answer.');
  const skipped = run(s, { type: 'skipLine', recipeKey: RICE, lineNo: 6, ingredient: 'shaoxing wine', skip: true },
    { type: 'skipLine', recipeKey: PIZZA, lineNo: 5, ingredient: 'fresh basil', skip: true });
  const q = checkProgress({ recipes: 2, checking: [], failed: [], basket: 'ok', counts: basketCounts(BASKET, skipped) });
  assert.deepEqual([q.head, q.note, q.open, q.skipped], ['3 of 5 found nearby', '2 skipped', 0, 2]);
  const all = checkProgress({ recipes: 1, checking: [], failed: [], basket: 'ok',
    counts: { lines: 16, found: 16, unanswered: 0, skipped: 0 } });
  assert.deepEqual([all.head, all.note], ['16 of 16 found nearby', '']);
  assert.equal(checkedText(all), '16 of 16 found nearby.');
  const none = checkProgress({ recipes: 1, checking: [], failed: [], basket: 'ok',
    counts: { lines: 0, found: 0, unanswered: 0, skipped: 0 } });
  assert.equal(none.head, 'Nothing to buy yet');
});

test('a check that failed says which, and the basket\'s own failure says so', () => {
  const p = checkProgress({ recipes: 3, checking: ['Dal'], failed: ['Congee'], basket: 'waiting', counts: null });
  assert.deepEqual([p.state, p.head, p.note], ['failed', 'The products for Congee could not be checked', '1 of 3 recipes checked']);
  const all = checkProgress({ recipes: 4, checking: [], failed: ['A', 'B', 'C', 'D'], basket: 'waiting', counts: null });
  assert.equal(all.head, 'The products for 4 recipes could not be checked', 'a count past two, as Next says it');
  const b = checkProgress({ recipes: 3, checking: [], failed: [], basket: 'error', counts: null });
  assert.deepEqual([b.state, b.head], ['failed', 'The ingredients could not be checked']);
});

test('the task list: each ingredient still to answer, with its recipe and its answers in order', () => {
  const s = plan();
  const tasks = atRiskTasks(basketView(BASKET, s).recipes);
  assert.deepEqual(tasks.map((t) => [t.line.ingredient, t.recipe, t.answers]), [
    ['fresh basil', 'Pepperoni Pizza', ['product', 'skip', 'meals']],
    ['shaoxing wine', 'Chicken Fried Rice', ['product', 'skip', 'meals']],
  ]);
  assert.deepEqual(tasks.map((t) => answerLabel('product', t.line)), ['Another product', 'Choose a product'],
    'nothing chosen for the wine: its Options choose one');
  assert.deepEqual(['skip', 'meals', 'stores'].map((a) => answerLabel(a as never, tasks[0].line)),
    ['Skip this ingredient', 'Pick other meals', 'Turn a store back on']);
  assert.equal(toAnswerText(2), '2 ingredients to answer');
  assert.equal(toAnswerText(1), '1 ingredient to answer');
  // answered by skipping: off the list
  const after = run(s, { type: 'skipLine', recipeKey: PIZZA, lineNo: 5, ingredient: 'fresh basil', skip: true });
  assert.deepEqual(atRiskTasks(basketView(BASKET, after).recipes).map((t) => t.line.ingredient), ['shaoxing wine']);
  // no meals of the rice: nothing is bought for it, so nothing to answer
  assert.deepEqual(atRiskTasks(basketView(BASKET, run(after, { type: 'setWanted', key: RICE, wanted: 0 })).recipes), []);
});

test('an ingredient sold only at stores turned off can turn one back on, first', () => {
  const b: MealBasket = structuredClone(BASKET);
  b.recipes[0].lines[2].unavailable_kind = 'stores_off';
  b.recipes[0].lines[2].why_unavailable = 'Sold only at stores you turned off: ValueFoods East Van';
  const [basil] = atRiskTasks(basketView(b, plan()).recipes);
  assert.deepEqual(basil.answers, ['stores', 'product', 'skip', 'meals']);
  // pantry-api's reason says what the heading says, and more: it stands alone
  assert.deepEqual(issueText(basil.line), { head: 'Sold only at stores you turned off: ValueFoods East Van', why: '' });
});

test('what is wrong, in bold, then pantry-api\'s reason when it adds something', () => {
  const [basil, wine] = atRiskTasks(basketView(BASKET, plan()).recipes).map((t) => t.line);
  assert.deepEqual(issueText(basil), { head: 'Sold only beyond your distance', why: 'no store within 5 km sells it' });
  assert.deepEqual(issueText(wine), { head: 'Every product nearby is from the United States, which your rule leaves out',
    why: '' }, 'no reason given');
  // the origin rule's reason is said in plain words: pantry-api's own ("… is evidenced as United
  // States (ingredients), which this plan excludes") is not repeated after it
  const b: MealBasket = structuredClone(BASKET);
  b.recipes[1].lines[1].why_unavailable = 'Shaoxing Wine is evidenced as United States (ingredients), which this plan excludes';
  assert.equal(issueText(atRiskTasks(basketView(b, plan()).recipes)[1].line).why, '');
});

test('the origin rule blocking one product in several recipes is said once; each keeps its answers', () => {
  // the shopper chose the same salt for both recipes, and the rule now leaves it out
  const b: MealBasket = structuredClone(BASKET);
  for (const r of b.recipes.slice(0, 2)) {
    const salt = r.lines.find((l) => l.ingredient === 'salt')!;
    Object.assign(salt, { available: false, unavailable_kind: 'origin_excluded', store: null, price: null,
      origin: { country: 'United States', claim: 'From United States', status: 'evidenced', preferred_rank: null },
      held_back: [{ product_id: 122, product: 'Table Salt 1kg', country: 'United States', claim: 'Product of USA',
        field: 'ingredient_origin', store: 'ValueFoods East Van', price: 1.54 }] });
  }
  const tasks = atRiskTasks(basketView(b, plan()).recipes).filter((t) => t.line.ingredient === 'salt');
  assert.deepEqual(tasks.map((t) => [t.recipe, t.same, t.answers]), [
    ['Pepperoni Pizza', null, ['product', 'skip', 'meals']],
    ['Chicken Fried Rice', 'Pepperoni Pizza', ['product', 'skip', 'meals']],
  ]);
  assert.deepEqual(issueText(tasks[0].line, tasks[0].same), {
    head: 'Your chosen product, Table Salt 1kg, is from the United States (Product of USA), which your rule leaves out', why: '' });
  assert.deepEqual(issueText(tasks[1].line, tasks[1].same), { head: 'Same as for Pepperoni Pizza above', why: '' });
  // another reason is never folded into the rule's
  assert.equal(atRiskTasks(basketView(BASKET, plan()).recipes).every((t) => t.same === null), true);
});

test('a recipe\'s count under its name says what waits in the list above', () => {
  const [pizza, rice] = basketView(BASKET, plan()).recipes;
  assert.equal(recipeCountText(pizza), '2 meals · 3 ingredients · 1 to answer above');
  assert.equal(recipeCountText({ ...rice, unanswered: 0 }), '1 meal · 2 ingredients');
});
