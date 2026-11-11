// "Build a week for me": what the week planner is asked, the dinners it answers with, the
// catalog's check on them, and the words around them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLANNER_TAGS, builtText, dietChecked, fitting, leftText, noneFitText, weekDinners, weekExcludeTags, weekRequest,
} from '../src/mealplan/buildweek.ts';
import { weekEdit } from '../src/mealplan/board.ts';
import { DEFAULT_PREFS, historyStep, step, undoPlan } from '../src/mealplan/model.ts';
import { startHistory } from '../src/mealplan/undo.ts';
import type { CatalogRecipe, MealPrefs, WeekPlan } from '../src/types.ts';
import { D, TODAY, planWith, run } from './helpers/mealplan.ts';

const prefs = (over: Partial<MealPrefs>): MealPrefs => ({ ...DEFAULT_PREFS, ...over });

// The week the demo's planner answers for seven days with no rules: six dinners, the library's
// seventh having no product under the origin rules.
const WEEK = { days: [
  ['grilled_cheese', 'Grilled Cheese Sandwich'], ['tomato_penne', 'Tomato Penne'],
  ['spaghetti_bolognese', 'Spaghetti Bolognese'], ['beef_rice_bowl', 'Beef & Broccoli Rice Bowl'],
  ['veggie_stirfry', 'Vegetable Stir Fry'], ['chicken_curry', 'Simple Chicken Curry'],
].map(([recipe_slug, recipe_name]) => ({ recipe_slug, recipe_name, line_items: [], day_cost: 10 })) } as unknown as WeekPlan;

const verdict = (slug: string, fits: boolean, why_not: string | null = null) =>
  ({ key: `lib:${slug}`, fits, why_not }) as CatalogRecipe;

test('the diet and leave-out list in the planner\'s words, and never more broadly than asked', () => {
  assert.deepEqual(weekExcludeTags(DEFAULT_PREFS), []);
  assert.deepEqual(weekExcludeTags(prefs({ diet: 'vegetarian' })), ['meat']);
  // the catalog tags fish as meat, so a pescatarian's fish go with the meat
  assert.deepEqual(weekExcludeTags(prefs({ diet: 'pescatarian' })), ['meat']);
  assert.deepEqual(weekExcludeTags(prefs({ diet: 'vegan' })), ['meat', 'dairy', 'egg']);
  // peanuts and tree nuts are the planner's one "nuts"; fish, sesame, mustard and sulphites have
  // no word there short of all meat, so the catalog's check catches them instead
  assert.deepEqual(weekExcludeTags(prefs({ avoid: ['soy', 'peanuts', 'tree_nuts', 'fish', 'sesame', 'gluten'] })),
    ['gluten', 'nuts', 'soy']);
  assert.deepEqual(weekExcludeTags(prefs({ diet: 'vegan', avoid: ['dairy', 'nuts', 'mustard', 'sulphites'] })),
    ['meat', 'dairy', 'egg', 'nuts']);
  for (const diet of ['any', 'pescatarian', 'vegetarian', 'vegan'] as const) {
    for (const t of weekExcludeTags(prefs({ diet, avoid: ['dairy', 'egg', 'soy', 'gluten', 'nuts'] }))) {
      assert.ok((PLANNER_TAGS as readonly string[]).includes(t), t);
    }
  }
});

test('the request: a dinner a day for the plan\'s days, under its budget, diet and origin rules', () => {
  const plain = planWith(7);
  assert.deepEqual(weekRequest(plain.draft), {
    days: 7, max_total_budget: null, exclude_tags: [],
    exclude_origin: ['United States'], preference: plain.draft.settings.preference,
  });
  const s = run(planWith(14), { type: 'setPrefs', prefs: { budget: 120, diet: 'vegetarian', avoid: ['peanuts'] } },
    { type: 'setSettings', settings: { exclude_origin: [], preference: ['Canada'] } });
  assert.deepEqual(weekRequest(s.draft), {
    days: 14, max_total_budget: 120, exclude_tags: ['meat', 'nuts'], exclude_origin: [], preference: ['Canada'],
  });
  // the request is a copy: changing it changes nothing in the plan
  weekRequest(s.draft).preference.push('Japan');
  assert.deepEqual(s.draft.settings.preference, ['Canada']);
});

test('the week\'s dinners in its order, and the catalog\'s verdict on them', () => {
  const dinners = weekDinners(WEEK);
  assert.deepEqual(dinners.slice(0, 2), [{ slug: 'grilled_cheese', name: 'Grilled Cheese Sandwich' },
    { slug: 'tomato_penne', name: 'Tomato Penne' }]);
  assert.equal(dinners.length, 6);

  assert.equal(dietChecked(DEFAULT_PREFS), false, 'anything goes: no catalog call');
  assert.equal(dietChecked(prefs({ diet: 'vegan' })), true);
  assert.equal(dietChecked(prefs({ avoid: ['sesame'] })), true);

  // a vegan's week: the planner's tags missed the cheese, the catalog's words did not
  const catalog = [verdict('grilled_cheese', false, 'contains dairy'), verdict('tomato_penne', false, 'contains dairy'),
    verdict('veggie_stirfry', true), verdict('spaghetti_bolognese', false, 'contains meat and dairy')];
  const { kept, left } = fitting([...dinners.filter((x) => x.slug !== 'beef_rice_bowl'), dinners[0]], catalog);
  assert.deepEqual(kept.map((x) => x.slug), ['veggie_stirfry', 'chicken_curry'],
    'a dinner the catalog does not list is kept on the planner\'s word');
  assert.deepEqual(left, [{ name: 'Grilled Cheese Sandwich', why: 'contains dairy' },
    { name: 'Tomato Penne', why: 'contains dairy' }, { name: 'Spaghetti Bolognese', why: 'contains meat and dairy' }],
  'each named once, with the catalog\'s reason');
  assert.deepEqual(fitting(dinners, []).kept, dinners);
});

test('the words: the toast, what was left out, and nothing left at all', () => {
  assert.equal(builtText(6, 0, 0), 'Added 6 dinners');
  assert.equal(builtText(1, 0, 2), 'Added 1 dinner · 2 left out for your diet');
  assert.equal(builtText(5, 2, 0), 'Added 5 dinners · 2 wait in the tray');
  assert.equal(builtText(3, 1, 1), 'Added 3 dinners · 1 waits in the tray · 1 left out for your diet');
  assert.equal(leftText([]), null);
  assert.equal(leftText([{ name: 'Tomato Penne', why: 'contains dairy' }]),
    'Left out for your diet: Tomato Penne (contains dairy).');
  assert.equal(leftText([{ name: 'A', why: 'contains meat' }, { name: 'B', why: 'contains dairy' },
    { name: 'C', why: 'contains egg' }]), 'Left out for your diet: A (contains meat), B (contains dairy) and C (contains egg).');
  assert.equal(noneFitText([{ name: 'Grilled Cheese Sandwich', why: 'contains dairy' }]),
    'No dinner the planner found fits your diet: Grilled Cheese Sandwich contains dairy.');
});

test('the week goes into the plan on its free dinners as one step, and one undo takes it out', () => {
  const s = planWith(7);
  const out = weekEdit(s, weekDinners(WEEK), 'add', TODAY, 'unused');
  assert.ok('edit' in out);
  assert.equal(out.trayed, 0);
  let h = startHistory(s);
  h = historyStep(h, out.edit).history;
  const placed = h.present.draft.meals.map((m) => [m.recipe_key, m.date, m.slot]);
  assert.deepEqual(placed.slice(0, 2), [['lib:grilled_cheese', D(0), 'dinner'], ['lib:tomato_penne', D(1), 'dinner']]);
  assert.equal(placed.length, 6);
  assert.equal(h.present.draft.id, s.draft.id, 'the same plan, added to');
  assert.equal(h.past.length, 1, 'one step to undo');
  h = undoPlan(h);
  assert.deepEqual(h.present.draft.meals, [], 'undone: the dinners are gone');
  // built again: the one dinner still free takes the first, and the rest wait in the tray
  const built = run(s, out.edit);
  const again = weekEdit(built, weekDinners(WEEK), 'add', TODAY, 'unused');
  assert.ok('edit' in again);
  assert.equal(again.trayed, 5);
  const twice = step(built, again.edit).state;
  assert.equal(twice.draft.recipes['lib:grilled_cheese'].wanted, 2);
  assert.deepEqual(twice.draft.meals.filter((m) => m.date === D(6)).map((m) => m.recipe_key), ['lib:grilled_cheese']);
  assert.equal(builtText(weekDinners(WEEK).length, again.trayed, 0), 'Added 6 dinners · 5 wait in the tray');
});
