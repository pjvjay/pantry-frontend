// What a move would mean for freshness, read from the last schedule. The fixture is a real
// /mealplan/schedule answer from pantry-api (feat/meal-plan, DEMO_MODE, the four demo starters
// from Fri 9 Oct 2026, prices and stock synthetic), cut down to a few lines: chicken thighs with
// a cited fridge time, whole milk on the shopper's buy-ahead setting, flour with no time at all,
// and chicken breast frozen on arrival under fewest_trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buyBy, moveChoices, moveConsequence, productNames, productsText, remedyLabel, remedyStep, tripMoveConsequence,
  warningRows, warningsFor,
} from '../src/mealplan/consequences.ts';
import type { MealSchedule, PlanWarning, RemedyOp } from '../src/types.ts';
import { D, add, planWith, run } from './helpers/mealplan.ts';

const real: MealSchedule = JSON.parse(readFileSync(new URL('./fixtures/mealplan-schedule.json',
  import.meta.url), 'utf8'));
const approvedFirstTrip = (): MealSchedule => {
  const sc = structuredClone(real);
  sc.strategies[0].trips[0].status = 'approved';
  return sc;
};

test('a meal moved past a cited fridge time says so, quoting the source', () => {
  // Chicken Biryani #1 is on Sun 11 Oct; its thighs are bought Sat 10 Oct and keep "1 to 2 days".
  const c = moveConsequence(real, 'fresh', 'starter:chicken_biryani#1', '2026-10-13', 'dinner');
  assert.equal(c.level, 'note', 'a suggested trip can still change, so it is not a warning');
  assert.deepEqual(c.lines, ['Chicken Thighs Bone-In would be held 3 days after Sat 10 Oct; it keeps '
    + '1 to 2 days in the fridge (FoodSafety.gov, Cold Food Storage Chart), so another trip may be suggested.']);
  const ok = moveConsequence(real, 'fresh', 'starter:chicken_biryani#1', '2026-10-10', 'dinner');
  assert.equal(ok.level, 'ok');
});

test('against an approved trip the same move is a warning', () => {
  const c = moveConsequence(approvedFirstTrip(), 'fresh', 'starter:chicken_biryani#1', '2026-10-13', 'dinner');
  assert.equal(c.level, 'warn');
  assert.match(c.lines[0], /from your approved trip on Sat 10 Oct would be held 3 days/);
  const early = moveConsequence(approvedFirstTrip(), 'fresh', 'starter:chicken_biryani#1', '2026-10-09', 'dinner');
  assert.deepEqual(early.lines, ['Chicken Thighs Bone-In is on your approved trip on Sat 10 Oct, after this meal.']);
});

test("the shopper's own setting is named as theirs, never as a cited time", () => {
  const c = moveConsequence(real, 'fresh', 'starter:mango_milkshake#1', '2026-10-20', 'snack');
  assert.deepEqual(c.lines, ['Whole Milk 1L would be held 10 days after Sat 10 Oct; your setting buys '
    + 'it at most 7 days ahead, so another trip may be suggested.']);
  assert.doesNotMatch(c.lines[0], /FoodSafety|keeps/);
});

test('a product with no stated time says nothing about it', () => {
  // Pepperoni Pizza's only line here is flour, which has no time in either source.
  const c = moveConsequence(real, 'fresh', 'starter:pepperoni_pizza#1', '2026-10-22', 'dinner');
  assert.equal(c.level, 'ok');
  assert.deepEqual(c.lines, ['Everything for it is still bought in time and within its stated times.']);
});

test('food frozen on arrival is not held to its fridge time', () => {
  const c = moveConsequence(real, 'fewest_trips', 'starter:chicken_fried_rice#1', '2026-10-21', 'dinner');
  assert.equal(c.level, 'ok');
});

test('with no schedule yet, or nothing bought for the meal, the preview says so', () => {
  assert.match(moveConsequence(null, 'fresh', 'x', D(1), 'dinner').lines[0], /once the trips are worked out/);
  assert.match(moveConsequence(real, 'fresh', 'nope#1', D(1), 'dinner').lines[0], /No products/);
});

test('breakfast is bought the day before, as the engine plans it', () => {
  assert.equal(buyBy('2026-10-11', 'breakfast'), '2026-10-10');
  assert.equal(buyBy('2026-10-11', 'dinner'), '2026-10-11');
  const c = moveConsequence(approvedFirstTrip(), 'fresh', 'starter:chicken_biryani#1', '2026-10-10', 'breakfast');
  assert.match(c.lines[0], /after this meal/);
});

test('moving a trip later says which meals it would miss', () => {
  const c = tripMoveConsequence(real, 'fresh', 'fresh-2026-10-10', '2026-10-12');
  assert.equal(c.level, 'warn');
  assert.ok(c.lines.includes('Chicken Thighs Bone-In for Chicken Biryani on Sun 11 Oct (dinner) would be '
    + 'bought after it is needed.'), c.lines.join('\n'));
  assert.ok(c.lines.some((l) => l.startsWith('Whole Milk 1L for Mango Milkshake on Sat 10 Oct (snack)')));
  const earlier = tripMoveConsequence(real, 'fresh', 'fresh-2026-10-10', '2026-10-09');
  assert.equal(earlier.level, 'warn');
  assert.match(earlier.lines.join('\n'), /Chicken Thighs Bone-In would be held 2 days before Chicken Biryani/);
  assert.equal(tripMoveConsequence(real, 'fresh', 'fresh-2026-10-13', '2026-10-13').level, 'ok');
  assert.match(tripMoveConsequence(real, 'fresh', 'nope', D(1)).lines[0], /not in the last answer/);
});

test('the Move menu lists every other cell, with swaps and pinned meals marked', () => {
  const s = run(planWith(2, add('pepperoni_pizza', 'Pepperoni Pizza', 2)),
    { type: 'place', mealId: 'starter:pepperoni_pizza#1', date: D(0), slot: 'dinner' },
    { type: 'place', mealId: 'starter:pepperoni_pizza#2', date: D(1), slot: 'dinner' },
    { type: 'setPinned', mealId: 'starter:pepperoni_pizza#2', pinned: true });
  const choices = moveChoices(s, null, 'starter:pepperoni_pizza#1');
  assert.equal(choices.length, 2 * 4 - 1);
  const pinned = choices.find((c) => c.date === D(1) && c.slot === 'dinner');
  assert.equal(pinned?.swapWith, 'starter:pepperoni_pizza#2');
  assert.equal(pinned?.blocked, 'Pepperoni Pizza is pinned there');
  assert.equal(choices[0].label, 'Fri 9 Oct, Breakfast');
  assert.equal(choices.find((c) => c.slot === 'snack')?.swapWith, null);
});

const warning = (level: PlanWarning['level'], code: string, strategy: PlanWarning['strategy']): PlanWarning =>
  ({ level, code, message: code, strategy, remedies: [], meal_ids: [], product_id: null, trip_date: null,
    recipe_key: null });

test('warnings for a strategy include the plan-wide ones, most urgent first', () => {
  const sc = { ...real, warnings: [warning('note', 'shelf_life_unknown', null),
    warning('must_fix', 'fridge_window_exceeded', 'fewest_trips'), warning('decide', 'not_stocked', 'fresh'),
    warning('should_fix', 'over_budget', 'fresh'), warning('must_fix', 'needs_servings', null)] };
  assert.deepEqual(warningsFor(sc, 'fresh').map((w) => w.code),
    ['needs_servings', 'over_budget', 'not_stocked', 'shelf_life_unknown']);
  assert.deepEqual(warningsFor(sc, 'fewest_trips').map((w) => w.code),
    ['fridge_window_exceeded', 'needs_servings', 'shelf_life_unknown']);
});

test('remedies become edits, or ask the shopper first', () => {
  const s = planWith(7);
  assert.deepEqual(remedyStep({ op: 'move_meal', meal_id: 'm#1', date: D(2), slot: 'lunch' }, s),
    { edit: { type: 'place', mealId: 'm#1', date: D(2), slot: 'lunch' } });
  assert.deepEqual(remedyStep({ op: 'set_storage', product_id: 10, storage: 'freezer' }, s),
    { edit: { type: 'setStorage', productId: 10, storage: 'freezer' } });
  assert.deepEqual(remedyStep({ op: 'set_packs', date: D(1), product_id: 10, packs: 0 }, s),
    { edit: { type: 'setPacks', date: D(1), productId: 10, packs: 0 } });
  assert.deepEqual(remedyStep({ op: 'set_pref', field: 'buy_ahead_days', value: 3 }, s),
    { edit: { type: 'setPrefs', prefs: { buy_ahead_days: 3 } } });
  for (const op of [{ op: 'set_servings', recipe_key: 'k' }, { op: 'set_packs', date: D(1), product_id: 10 },
    { op: 'open_options', date: D(1), product_id: 10 }, { op: 'resolve', recipe_key: 'k' },
    { op: 'approve_trip', date: D(1), strategy: 'fresh' }, { op: 'set_pref', field: 'lat', value: 1 }] as const) {
    assert.ok('ask' in remedyStep(op, s), op.op);
  }
});

// Every remedy pantry-api builds (pantry_planner/mealplan/warnings.py, with the values
// schedule.py passes), so a new op or field shows up here before it shows as a dead button.
const ENGINE_OPS: RemedyOp[] = [
  { op: 'move_meal', meal_id: 'starter:pepperoni_pizza#1', date: D(2), slot: 'dinner' },
  { op: 'set_storage', product_id: 10, storage: 'freezer' },
  { op: 'add_trip', date: D(1) },
  { op: 'set_servings', recipe_key: 'starter:pepperoni_pizza' },
  { op: 'set_packs', date: D(1), product_id: 10 },
  { op: 'set_packs', date: D(1), product_id: 10, packs: 0 },
  { op: 'open_options', date: D(1), product_id: 10 },
  { op: 'resolve', recipe_key: 'starter:pepperoni_pizza' },
  { op: 'set_strategy', strategy: 'fewest_trips' },
  { op: 'set_pref', field: 'days', value: 14 },
  { op: 'set_pref', field: 'max_trips', value: 3 },
  { op: 'approve_trip', date: D(1), strategy: 'fresh' },
  { op: 'remove_meal', meal_id: 'starter:pepperoni_pizza#1' },
];

test('every remedy the engine sends is an edit or a question the view answers', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2));
  for (const op of ENGINE_OPS) {
    const r = remedyStep(op, s);
    assert.ok('edit' in r || r.ask !== 'unknown', JSON.stringify(op));
  }
});

test('"Make the plan two weeks" lengthens the plan from the same start', () => {
  // The unplaced must-fix's remedy, for more dinners than a seven-day plan has.
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2));
  const op: RemedyOp = { op: 'set_pref', field: 'days', value: 14 };
  assert.equal(remedyLabel(op, s, new Map()), 'Make the plan two weeks');
  const r = remedyStep(op, s);
  assert.ok('edit' in r);
  const next = run(s, r.edit);
  assert.equal(next.draft.start_date, s.draft.start_date);
  assert.equal(next.draft.days, 14);
  assert.equal(remedyLabel({ op: 'set_pref', field: 'max_trips', value: 3 }, s, new Map()), 'Allow 3 trips');
});

test('over the budget: the remedies switch strategy, or make the budget cover the total', () => {
  const s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2)), { type: 'setPrefs', prefs: { budget: 150 } });
  const raise: RemedyOp = { op: 'set_pref', field: 'budget', value: 220 };
  assert.equal(remedyLabel(raise, s, new Map()), 'Make the budget $220.00');
  const r = remedyStep(raise, s);
  assert.ok('edit' in r);
  assert.equal(run(s, r.edit).draft.prefs.budget, 220);
  assert.equal(remedyLabel({ op: 'set_strategy', strategy: 'fewest_trips' }, s, new Map()), 'Shop in fewest trips');
});

test('remedies read as buttons, with product and recipe names from the plan', () => {
  const s = planWith(7, add('chicken_biryani', 'Chicken Biryani', 1));
  const names = productNames(real);
  assert.equal(names.get(11), 'Chicken Thighs Bone-In');
  assert.equal(remedyLabel({ op: 'set_storage', product_id: 11, storage: 'freezer' }, s, names),
    'Freeze Chicken Thighs Bone-In on arrival');
  assert.equal(remedyLabel({ op: 'move_meal', meal_id: 'starter:chicken_biryani#1', date: D(2), slot: 'dinner' },
    s, names), 'Move Chicken Biryani to Sun 11 Oct, dinner');
  assert.equal(remedyLabel({ op: 'set_servings', recipe_key: 'starter:chicken_biryani' }, s, names),
    'Say how many Chicken Biryani serves');
  assert.equal(remedyLabel({ op: 'set_packs', date: D(1), product_id: 999, packs: 0 }, s, names),
    'Leave product 999 off this trip');
});

test('warnings that say the same thing one product at a time are one row listing the products', () => {
  const names = new Map([[1, 'Fresh Ginger'], [2, 'Soy Sauce'], [3, 'Rice'], [4, 'Scallions'], [5, 'Eggs'],
    [6, 'Sesame Oil']]);
  const move: RemedyOp = { op: 'move_meal', meal_id: 'starter:congee#1', date: D(3), slot: 'breakfast' };
  const before = (pid: number): PlanWarning => ({ level: 'must_fix', code: 'meal_before_trip',
    message: `Ginger Congee on Mon 12 Oct needs ${names.get(pid)}, and no shopping day comes before it.`,
    strategy: 'fresh', remedies: [move], meal_ids: ['starter:congee#1'], product_id: pid, trip_date: null,
    recipe_key: null });
  const other = { ...before(1), meal_ids: ['starter:pizza#1'], message: 'Pizza on Tue needs Fresh Ginger, and no shopping day comes before it.' };
  const rows = warningRows([1, 2, 3, 4, 5, 6].map(before).concat([other]), names);
  assert.equal(rows.length, 2, 'another meal is its own row');
  assert.equal(rows[0].count, 6);
  assert.deepEqual(rows[0].products, ['Fresh Ginger', 'Soy Sauce', 'Rice', 'Scallions', 'Eggs', 'Sesame Oil']);
  assert.equal(rows[0].text,
    'Ginger Congee on Mon 12 Oct needs Fresh Ginger, Soy Sauce and 4 more, and no shopping day comes before it.');
  assert.deepEqual(rows[0].warning.remedies, [move], 'one set of buttons');
  assert.equal(rows[1].text, other.message);
  // different remedies are different rows
  const twoWays = warningRows([before(1), { ...before(2), remedies: [] }], names);
  assert.equal(twoWays.length, 2);
  // sentences that differ in more than the product keep the first, and name the rest
  const fridge = (pid: number, days: string): PlanWarning => ({ ...before(pid), code: 'fridge_window_exceeded',
    message: `Ginger Congee on Mon 12 Oct: ${names.get(pid)} bought Fri is past its cited fridge time, ${days}.` });
  assert.equal(warningRows([fridge(1, '1 to 2 days'), fridge(2, '3 to 5 days')], names)[0].text,
    'Ginger Congee on Mon 12 Oct: Fresh Ginger bought Fri is past its cited fridge time, 1 to 2 days. The same for Soy Sauce.');
  // plan-wide warnings, with no meal or product, are never merged
  const wide = { ...before(1), meal_ids: [], product_id: null, message: 'x' };
  assert.equal(warningRows([wide, wide], names).length, 2);
  assert.equal(productsText(['A', 'B', 'C']), 'A, B and C');
  assert.equal(productsText(['A']), 'A');
});
