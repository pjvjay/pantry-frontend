// Room for meals: a recipe's + stops once every place for its meal is taken, counting every
// recipe's meals of that meal, and says why; the engine's limits stay behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_MEALS, MAX_WANTED } from '../src/mealplan/model.ts';
import { addStop, fullText, periodWords, roomOf, slotRoom } from '../src/mealplan/room.ts';
import { D, add, planWith, run } from './helpers/mealplan.ts';

test('a week holds 7 of each meal and 14 snacks; two weeks twice that', () => {
  const week = planWith(7);
  assert.deepEqual(roomOf(week.draft).map((r) => [r.slot, r.capacity]),
    [['breakfast', 7], ['lunch', 7], ['dinner', 7], ['snack', 14]]);
  const fortnight = planWith(14);
  assert.deepEqual(roomOf(fortnight.draft).map((r) => [r.slot, r.capacity]),
    [['breakfast', 14], ['lunch', 14], ['dinner', 14], ['snack', 28]]);
});

test('the dinners stop at 7 in a week, with the reason in words', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 6));
  assert.equal(addStop(s.draft, 'dinner', 6), null, 'one place left');
  s = run(s, { type: 'setWanted', key: 'starter:pepperoni_pizza', wanted: 7 });
  assert.equal(addStop(s.draft, 'dinner', 7), 'All 7 dinners this week are planned');
  assert.deepEqual(slotRoom(s.draft, 'dinner'), { slot: 'dinner', label: 'Dinner', on: true, capacity: 7, meals: 7,
    filled: 7, free: 0 });
  assert.equal(addStop(s.draft, 'lunch', 0), null, 'another meal has its own places');
});

test('every recipe of a meal shares its places, placed or in the tray', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 3), add('chicken_fried_rice', 'Chicken Fried Rice', 2),
    add('tomato_penne', 'Tomato Penne', 1));
  s = run(s, { type: 'place', mealId: 'starter:pepperoni_pizza#1', date: D(0), slot: 'dinner' });
  assert.equal(slotRoom(s.draft, 'dinner').meals, 6);
  assert.equal(addStop(s.draft, 'dinner', 1), null);
  s = run(s, { type: 'setWanted', key: 'starter:tomato_penne', wanted: 2 });
  for (const [, wanted] of [['pizza', 3], ['rice', 2], ['penne', 2]] as const) {
    assert.equal(addStop(s.draft, 'dinner', wanted), 'All 7 dinners this week are planned');
  }
  // a dinner recipe's meal put in a lunch slot takes a lunch, not a dinner
  s = run(s, { type: 'place', mealId: 'starter:tomato_penne#1', date: D(1), slot: 'lunch' });
  assert.equal(slotRoom(s.draft, 'dinner').meals, 6);
  assert.equal(slotRoom(s.draft, 'lunch').meals, 1);
  assert.equal(addStop(s.draft, 'dinner', 2), null);
});

test('snacks: two a day, so 28 in two weeks', () => {
  let s = planWith(14, add('mango_milkshake', 'Mango Milkshake', 27, 'snack'));
  assert.equal(addStop(s.draft, 'snack', 27), null);
  s = run(s, add('fruit_cup', 'Fruit Cup', 1, 'snack'));
  assert.equal(addStop(s.draft, 'snack', 27), 'All 28 snacks in these 2 weeks are planned');
  assert.equal(addStop(s.draft, 'snack', 1), 'All 28 snacks in these 2 weeks are planned');
  assert.equal(fullText(slotRoom(planWith(7).draft, 'snack'), 7), 'All 14 snacks this week are planned');
});

test('a meal switched off in Basics has no places, and says how to get them', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2));
  s = run(s, { type: 'setPrefs', prefs: { slots_on: ['breakfast', 'lunch', 'dinner'] } });
  assert.deepEqual(roomOf(s.draft).map((r) => r.slot), ['breakfast', 'lunch', 'dinner']);
  assert.equal(slotRoom(s.draft, 'snack').capacity, 0);
  assert.equal(addStop(s.draft, 'snack', 0), 'You plan no snacks: turn Snack on in Basics');
  s = run(s, { type: 'setPrefs', prefs: { slots_on: ['breakfast', 'lunch'] } });
  assert.equal(slotRoom(s.draft, 'dinner').meals, 2, 'the meals stay, waiting');
  assert.equal(addStop(s.draft, 'dinner', 2), 'You plan no dinners: turn Dinner on in Basics');
});

test('the engine’s own limits stay behind the room', () => {
  const s = planWith(14, add('mango_milkshake', 'Mango Milkshake', MAX_WANTED - 1, 'snack'));
  assert.equal(addStop(s.draft, 'snack', MAX_WANTED), `A recipe has at most ${MAX_WANTED} meals`);
  // two weeks hold 70 meals, the engine takes 56
  const full = planWith(14, add('oat_porridge', 'Oat Porridge', 14, 'breakfast'), add('tuna_melt', 'Tuna Melt', 14, 'lunch'),
    add('pepperoni_pizza', 'Pepperoni Pizza', 14), add('fruit_cup', 'Fruit Cup', 14, 'snack'));
  assert.equal(slotRoom(full.draft, 'snack').free, 14);
  assert.equal(addStop(full.draft, 'snack', 0), `A plan holds at most ${MAX_MEALS} meals`);
});

test('the plan’s days in words', () => {
  assert.equal(periodWords(7), 'this week');
  assert.equal(periodWords(14), 'in these 2 weeks');
  assert.equal(periodWords(10), 'in these 10 days');
  assert.equal(periodWords(1), 'on this day');
  assert.equal(fullText(slotRoom(planWith(1).draft, 'dinner'), 1), 'The one dinner on this day is planned');
});
