// What the meal-plan board draws: cells, the tray, trip chips and lines, a trip as the cart
// card, the summary line, and a Planner week opened as a meal plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  forMealsText, lineWarn, mealsByCell, packsText, priceDeltaText, shelfText, shownSlots,
  summaryLine, trayRows, tripChipText, tripLook, tripToCartSummary, weekEdit,
} from '../src/mealplan/board.ts';
import { cellKey, step } from '../src/mealplan/model.ts';
import type { MealSchedule } from '../src/types.ts';
import { D, TODAY, add, line, planWith, run, schedule, trip } from './helpers/mealplan.ts';

const real: MealSchedule = JSON.parse(readFileSync(new URL('./fixtures/mealplan-schedule.json',
  import.meta.url), 'utf8'));

const PIZZA = 'starter:pepperoni_pizza';

test('cells hold their meals, the tray holds the rest, and empty rows can be hidden', () => {
  const s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 3)),
    { type: 'place', mealId: `${PIZZA}#1`, date: D(2), slot: 'dinner' });
  assert.deepEqual(mealsByCell(s).get(cellKey(D(2), 'dinner'))?.map((m) => m.id), [`${PIZZA}#1`]);
  const [row] = trayRows(s);
  assert.equal(row.title, 'Pepperoni Pizza');
  assert.equal(row.placed, 1);
  assert.deepEqual(row.waiting.map((m) => m.id), [`${PIZZA}#2`, `${PIZZA}#3`]);
  assert.deepEqual(shownSlots(s, true), ['dinner']);
  assert.deepEqual(shownSlots(s, false), ['breakfast', 'lunch', 'dinner', 'snack']);
  assert.deepEqual(shownSlots(planWith(7), true), ['breakfast', 'lunch', 'dinner', 'snack']);
});

test('a trip chip says its state in words, not colour alone, and "at least" for a floor', () => {
  const t = real.strategies[0].trips[0];
  assert.equal(tripChipText(t), 'Suggested · 2 stores · $118.83 · 3 items');
  const floor = trip(D(1), [line(10, 'Chicken', { price: null })], { total_cost: 4, total_is_floor: true });
  assert.equal(tripChipText(floor), 'Suggested · 1 store · at least $4.00 · 1 item');
  assert.deepEqual(tripLook(trip(D(1), [], { status: 'approved' })),
    { kind: 'approved', mark: '✓', word: 'Approved' });
  const review = trip(D(1), [], { status: 'needs_review',
    diff: { added: [{ product_id: 1, name: 'Milk', storage: 'fridge' }], removed: [], changed: [], text: ['+1 Milk'] } });
  assert.match(tripChipText(review), /^⚠ Changed since approved \(1 change\)/);
  assert.equal(priceDeltaText(1.2), '+$1.20 since you approved (demo prices)');
  assert.equal(priceDeltaText(-0.5), '−$0.50 since you approved (demo prices)');
  assert.equal(priceDeltaText(0), null);
  assert.equal(priceDeltaText(null), null);
});

test('a trip line names its meals, its amount and its storage time on whose word', () => {
  const ln = line(10, 'Chicken Breast', {
    for_meals: [
      { meal_id: 'a#1', recipe_key: 'a', title: 'Fried Rice', date: D(1), slot: 'dinner' },
      { meal_id: 'a#2', recipe_key: 'a', title: 'Fried Rice', date: D(2), slot: 'dinner' },
    ],
  });
  assert.equal(forMealsText(ln), 'for 2 meals: Fried Rice (Sat 10 Oct, Sun 11 Oct)');
  assert.equal(packsText(ln), '1 pack');
  assert.equal(packsText({ ...ln, packs: 3, packs_basis: 'your_setting' }), '3 packs (set by you)');
  assert.equal(packsText({ ...ln, packs: null, packs_basis: 'amount_unknown' }), 'amount unknown');
  assert.match(packsText({ ...ln, packs: null, packs_basis: 'needs_servings' }), /how many the recipe serves/);
  assert.deepEqual(shelfText(ln), { level: 'cited',
    text: 'keeps 1 to 2 days in the fridge (FoodSafety.gov)' });
  assert.deepEqual(shelfText({ ...ln, shelf_life: { ...ln.shelf_life, status: 'your_setting',
    verbatim: [], days_planned: 7 } }), { level: 'yours',
    text: 'storage time not cited: bought at most 7 days ahead (your setting)' });
  assert.equal(shelfText({ ...ln, shelf_life: { ...ln.shelf_life, status: 'unknown', verbatim: [],
    days_planned: null } }).text, 'storage time unknown');
  assert.equal(lineWarn(ln), undefined);
  assert.equal(lineWarn({ ...ln, packs: null, price: null }), 'amount unknown · price unknown');
  assert.equal(lineWarn({ ...ln, stocked: false, price: null, store: null }), 'no longer stocked in range');
});

test('a trip becomes the cart card: stores in order, unknowns kept unknown', () => {
  const t = real.strategies[0].trips[0];
  const c = tripToCartSummary(t);
  assert.equal(c.lines?.length, t.lines.length);
  assert.deepEqual(c.trip?.stores, t.stores);
  assert.equal(c.trip?.basket_cost, t.total_cost);
  assert.equal(c.total_is_floor, false);
  const unknown = tripToCartSummary(trip(D(1), [line(167, 'Sliced Pepperoni 175g', {
    price: null, packs: null, store: null, stocked: false,
    product: { id: 167, name: 'Sliced Pepperoni 175g', unit_size: '175g', category: 'meat', demo_product: true },
  })], { total_is_floor: true }));
  const [l] = unknown.lines ?? [];
  assert.equal(l.product, 'Sliced Pepperoni 175g (demo)');
  assert.equal(l.price, undefined, 'an unknown price is not 0');
  assert.equal(l.packs, undefined);
  assert.equal(l.store, 'Not stocked within range');
  assert.equal(unknown.total_is_floor, true);
});

test('the summary line counts meals, placements, trips and the known total', () => {
  const s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2)),
    { type: 'place', mealId: `${PIZZA}#1`, date: D(2), slot: 'dinner' });
  assert.equal(summaryLine(s, null), '2 meals · 1 placed');
  const sc = schedule(s.draft.rev, [], [trip(D(1), [], { status: 'approved' }), trip(D(4), [])]);
  sc.strategies[0].total_cost = 52.5;
  sc.strategies[0].total_is_floor = true;
  assert.equal(summaryLine(s, sc), '2 meals · 1 placed · 2 trips (1 approved) · at least $52.50');
});

const WEEK = [
  { slug: 'chicken_curry', name: 'Chicken Curry' },
  { slug: 'tomato_penne', name: 'Tomato Penne' },
  { slug: 'chicken_curry', name: 'Chicken Curry' },
];

test('a Planner week opens as dinners on consecutive days, in one undo step', () => {
  const s = planWith(7);
  const out = weekEdit(s, WEEK, 'replace', TODAY, 'p2');
  assert.ok('edit' in out);
  const next = step(s, out.edit).state;
  const dinners = next.draft.meals.map((m) => [m.recipe_key, m.date, m.slot]);
  assert.deepEqual(dinners, [
    ['lib:chicken_curry', D(0), 'dinner'],
    ['lib:tomato_penne', D(1), 'dinner'],
    ['lib:chicken_curry', D(2), 'dinner'],
  ]);
  assert.equal(next.draft.recipes['lib:chicken_curry'].wanted, 2);
  assert.equal(next.draft.id, 'p2');
  assert.ok(next.draft.rev > s.draft.rev, 'the rev only counts up');
  assert.match(out.said, /3 dinners from the Planner in a new plan/);
});

test('adding a week keeps the plan and fills free dinners, then the tray', () => {
  let s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 7)), { type: 'fillEmpty' });
  // every dinner taken by hand
  for (let i = 0; i < 7; i += 1) {
    s = run(s, { type: 'place', mealId: `${PIZZA}#${i + 1}`, date: D(i), slot: 'dinner' });
  }
  const out = weekEdit(s, WEEK.slice(0, 1), 'add', TODAY, 'unused');
  assert.ok('edit' in out);
  assert.equal(out.trayed, 1);
  const next = step(s, out.edit).state;
  assert.equal(next.draft.id, s.draft.id);
  assert.deepEqual(next.draft.meals.filter((m) => m.recipe_key === 'lib:chicken_curry')
    .map((m) => m.date), [null]);
  assert.match(out.said, /1 wait in the tray/);
  assert.deepEqual(weekEdit(s, [], 'add', TODAY, 'x'), { refused: 'the week has no dinners' });
});
