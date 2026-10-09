// The meal plan's reducer: every way the shopper edits the draft, and the two answers from the
// server it takes in (resolved recipes and the schedule's spread dates).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RECIPES, approvedElsewhere, approvedFrom, historyStep, libraryRef, newPlan, recorded, redoPlan, step,
  undoPlan,
} from '../src/mealplan/model.ts';
import type { MealPlanState, PlanEdit } from '../src/mealplan/model.ts';
import { canRedo, canUndo, startHistory } from '../src/mealplan/undo.ts';
import { D, TODAY, add, line, planWith, placed, run, schedule, trip } from './helpers/mealplan.ts';

const PIZZA = 'starter:pepperoni_pizza';
const RICE = 'starter:chicken_fried_rice';
const SHAKE = 'starter:mango_milkshake';

const meal = (s: MealPlanState, id: string) => {
  const m = s.draft.meals.find((x) => x.id === id);
  assert.ok(m, `no meal ${id}`);
  return m;
};
const refusal = (s: MealPlanState, e: PlanEdit) => {
  const out = step(s, e);
  assert.equal(out.state, s, 'a refused edit hands back the same plan');
  assert.ok(out.refused, `${e.type} should be refused`);
  return out.refused;
};

test('a new plan starts tomorrow, empty, with the household defaults', () => {
  const s = newPlan(TODAY, 'p', 14);
  assert.equal(s.draft.start_date, '2026-10-09');
  assert.equal(s.draft.days, 14);
  assert.equal(s.draft.rev, 0);
  assert.equal(s.draft.prefs.household_servings, 2);
  assert.equal(s.draft.prefs.buy_ahead_days, 7);
  assert.deepEqual(s.draft.prefs.slots_on, ['breakfast', 'lunch', 'dinner', 'snack']);
  assert.deepEqual(s.draft.meals, []);
});

test('a recipe brings its meals into the tray, numbered as the engine numbers them', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 3));
  assert.deepEqual(s.draft.meals.map((m) => [m.id, m.date, m.slot, m.pinned]), [
    [`${PIZZA}#1`, null, 'dinner', true],
    [`${PIZZA}#2`, null, 'dinner', true],
    [`${PIZZA}#3`, null, 'dinner', true],
  ]);
  assert.equal(s.draft.recipes[PIZZA].wanted, 3);
  assert.deepEqual(s.draft.recipes[PIZZA].ref, { key: PIZZA, starter: 'pepperoni_pizza' });
  assert.equal(s.titles[PIZZA], 'Pepperoni Pizza');
  assert.equal(s.draft.rev, 1);
});

test('a recipe is refused twice, with a key that does not match its source, or past 12', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  assert.match(refusal(s, add('pepperoni_pizza', 'Pepperoni Pizza', 1)), /already in the plan/);
  assert.match(refusal(s, { type: 'addRecipe', title: 'x', ref: { key: 'lib:x', slug: 'y' } }),
    /should be "lib:y"/);
  assert.match(refusal(s, { type: 'addRecipe', title: 'x', ref: { key: 'lib:x' } }), /exactly one/);
  let full = newPlan(TODAY, 'p');
  for (let i = 0; i < MAX_RECIPES; i += 1) {
    full = run(full, { type: 'addRecipe', ref: libraryRef(`r${i}`), title: `R${i}`, wanted: 0 });
  }
  assert.match(refusal(full, { type: 'addRecipe', ref: libraryRef('one-more'), title: 'x' }),
    /12 recipes/);
});

test('placing from the tray puts the meal on the day and lets the server leave it there', () => {
  const s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2)),
    { type: 'place', mealId: `${PIZZA}#1`, date: D(2), slot: 'dinner' });
  assert.deepEqual(meal(s, `${PIZZA}#1`), { id: `${PIZZA}#1`, recipe_key: PIZZA, date: D(2),
    slot: 'dinner', pinned: false });
  const out = step(s, { type: 'place', mealId: `${PIZZA}#2`, date: D(3), slot: 'dinner' });
  assert.equal(out.said, 'Pepperoni Pizza placed on Mon 12 Oct, dinner. 2 of 2 placed.');
});

test('a full cell swaps: a tray meal sends its occupant to the tray, a board meal trades places', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2), add('chicken_fried_rice', 'Chicken Fried Rice', 1));
  s = run(s, { type: 'place', mealId: `${PIZZA}#1`, date: D(1), slot: 'dinner' },
    { type: 'place', mealId: `${PIZZA}#2`, date: D(2), slot: 'dinner' });
  const fromTray = step(s, { type: 'place', mealId: `${RICE}#1`, date: D(1), slot: 'dinner' });
  assert.equal(meal(fromTray.state, `${RICE}#1`).date, D(1));
  assert.deepEqual([meal(fromTray.state, `${PIZZA}#1`).date, meal(fromTray.state, `${PIZZA}#1`).pinned],
    [null, true]);
  assert.match(fromTray.said, /Pepperoni Pizza went back to the tray/);

  const swap = step(s, { type: 'place', mealId: `${PIZZA}#1`, date: D(2), slot: 'dinner' });
  assert.equal(meal(swap.state, `${PIZZA}#1`).date, D(2));
  assert.equal(meal(swap.state, `${PIZZA}#2`).date, D(1));
  assert.match(swap.said, /swapped/);
});

test('two snacks share a day; a third swaps with the one named', () => {
  let s = planWith(7, add('mango_milkshake', 'Mango Milkshake', 3, 'snack'));
  s = run(s, { type: 'place', mealId: `${SHAKE}#1`, date: D(0), slot: 'snack' },
    { type: 'place', mealId: `${SHAKE}#2`, date: D(0), slot: 'snack' });
  assert.equal(s.draft.meals.filter((m) => m.date === D(0)).length, 2);
  s = run(s, { type: 'place', mealId: `${SHAKE}#3`, date: D(0), slot: 'snack', swapWith: `${SHAKE}#2` });
  assert.equal(meal(s, `${SHAKE}#2`).date, null);
  assert.equal(meal(s, `${SHAKE}#3`).date, D(0));
});

test('a meal is not placed outside the plan, in a switched-off slot, or over a pinned meal', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2));
  assert.match(refusal(s, { type: 'place', mealId: `${PIZZA}#1`, date: D(7), slot: 'dinner' }),
    /not one of the plan's days/);
  assert.match(refusal(s, { type: 'place', mealId: `${PIZZA}#1`, date: '2026-10-08', slot: 'dinner' }),
    /not one of the plan's days/);
  assert.match(refusal(s, { type: 'place', mealId: 'nope', date: D(1), slot: 'dinner' }), /not in the plan/);
  const noLunch = run(s, { type: 'setPrefs', prefs: { slots_on: ['breakfast', 'dinner', 'snack'] } });
  assert.match(refusal(noLunch, { type: 'place', mealId: `${PIZZA}#1`, date: D(1), slot: 'lunch' }),
    /Lunch is switched off/);
  s = run(s, { type: 'place', mealId: `${PIZZA}#1`, date: D(1), slot: 'dinner' },
    { type: 'setPinned', mealId: `${PIZZA}#1`, pinned: true });
  assert.match(refusal(s, { type: 'place', mealId: `${PIZZA}#2`, date: D(1), slot: 'dinner' }),
    /pinned to Sat 10 Oct, dinner; unpin it first/);
});

test('back to the tray holds a meal there; Fill empty slots lets the server spread the tray', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2));
  s = run(s, { type: 'place', mealId: `${PIZZA}#1`, date: D(1), slot: 'dinner' },
    { type: 'unplace', mealId: `${PIZZA}#1` });
  assert.deepEqual([meal(s, `${PIZZA}#1`).date, meal(s, `${PIZZA}#1`).pinned], [null, true]);
  assert.match(refusal(s, { type: 'setPinned', mealId: `${PIZZA}#1`, pinned: false }), /in the tray/);
  const filled = step(s, { type: 'fillEmpty' });
  assert.ok(filled.state.draft.meals.every((m) => m.date === null && !m.pinned));
  assert.equal(filled.said, '2 meals will be spread over empty slots.');
  assert.equal(step(filled.state, { type: 'fillEmpty' }).state, filled.state, 'nothing left to fill');
});

test('the schedule\'s spread dates are stored on the meals, for that rev only, with no new rev', () => {
  let s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2), add('chicken_fried_rice', 'Chicken Fried Rice', 1)),
    { type: 'place', mealId: `${RICE}#1`, date: D(0), slot: 'dinner' }, { type: 'fillEmpty' });
  const rev = s.draft.rev;
  const answer = schedule(rev, [
    placed(`${RICE}#1`, RICE, 'Chicken Fried Rice', D(0), 'dinner', 'you'),
    placed(`${PIZZA}#1`, PIZZA, 'Pepperoni Pizza', D(2)),
    placed(`${PIZZA}#2`, PIZZA, 'Pepperoni Pizza', D(5)),
  ]);
  const stale = step(s, { type: 'mergeSchedule', schedule: { ...answer, rev: rev - 1 } });
  assert.equal(stale.state, s, 'an answer for an older rev changes nothing');
  s = step(s, { type: 'mergeSchedule', schedule: answer }).state;
  assert.equal(s.draft.rev, rev);
  assert.deepEqual(s.draft.meals.map((m) => [m.id, m.date]),
    [[`${PIZZA}#1`, D(2)], [`${PIZZA}#2`, D(5)], [`${RICE}#1`, D(0)]]);
  assert.deepEqual(s.spread.sort(), [`${PIZZA}#1`, `${PIZZA}#2`]);
  assert.equal(step(s, { type: 'mergeSchedule', schedule: answer }).state, s, 'merging twice is a no-op');
  assert.equal(recorded({ type: 'mergeSchedule', schedule: answer }), false);
});

test('a meal the server added for a count joins the plan; held and placed meals are left alone', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  s = run(s, { type: 'setWanted', key: PIZZA, wanted: 1 });
  const answer = schedule(s.draft.rev, [
    placed(`${PIZZA}#1`, PIZZA, 'Pepperoni Pizza', D(3)),   // still held in the tray here
    placed(`${PIZZA}#2`, PIZZA, 'Pepperoni Pizza', D(4)),   // made by the server
  ]);
  s = step(s, { type: 'mergeSchedule', schedule: answer }).state;
  assert.equal(meal(s, `${PIZZA}#1`).date, null);
  assert.deepEqual(meal(s, `${PIZZA}#2`), { id: `${PIZZA}#2`, recipe_key: PIZZA, date: D(4),
    slot: 'dinner', pinned: false });
});

test('a lower count takes tray meals first, then spread ones, and never one the shopper placed', () => {
  let s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 4)),
    { type: 'place', mealId: `${PIZZA}#1`, date: D(0), slot: 'dinner' },
    { type: 'unplace', mealId: `${PIZZA}#2` }, { type: 'fillEmpty' });
  // #2 and #3 and #4 are spread by the server; then #4 goes back to the tray
  s = step(s, { type: 'mergeSchedule', schedule: schedule(s.draft.rev, [
    placed(`${PIZZA}#2`, PIZZA, 'Pepperoni Pizza', D(2)),
    placed(`${PIZZA}#3`, PIZZA, 'Pepperoni Pizza', D(5)),
    placed(`${PIZZA}#4`, PIZZA, 'Pepperoni Pizza', D(6)),
  ]) }).state;
  s = run(s, { type: 'unplace', mealId: `${PIZZA}#4` });

  s = run(s, { type: 'setWanted', key: PIZZA, wanted: 3 });
  assert.deepEqual(s.draft.meals.map((m) => m.id).sort(), [`${PIZZA}#1`, `${PIZZA}#2`, `${PIZZA}#3`]);
  s = run(s, { type: 'setWanted', key: PIZZA, wanted: 2 });
  assert.deepEqual(s.draft.meals.map((m) => m.id).sort(), [`${PIZZA}#1`, `${PIZZA}#2`],
    'the latest spread meal goes first');
  s = run(s, { type: 'setWanted', key: PIZZA, wanted: 1 });
  assert.match(refusal(s, { type: 'setWanted', key: PIZZA, wanted: 0 }),
    /1 Pepperoni Pizza meal is on the calendar where you put them/);
  s = run(s, { type: 'setWanted', key: PIZZA, wanted: 3 });
  assert.deepEqual(s.draft.meals.map((m) => m.id).sort(), [`${PIZZA}#1`, `${PIZZA}#2`, `${PIZZA}#3`],
    'new meals take the first free numbers');
});

test('removing a meal lowers its count; removing a recipe takes its meals, pins and products', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2), add('chicken_fried_rice', 'Chicken Fried Rice', 1));
  s = run(s, { type: 'remove', mealId: `${PIZZA}#2` });
  assert.equal(s.draft.recipes[PIZZA].wanted, 1);
  s = run(s, { type: 'pinProduct', recipeKey: PIZZA, lineNo: 3, productId: 166 },
    { type: 'removeRecipe', key: PIZZA });
  assert.deepEqual(Object.keys(s.draft.recipes), [RICE]);
  assert.deepEqual(s.draft.pins, {});
  assert.ok(s.draft.meals.every((m) => m.recipe_key === RICE));
});

test('a recipe\'s slot moves its tray meals only', () => {
  let s = run(planWith(7, add('mango_milkshake', 'Mango Milkshake', 2)),
    { type: 'place', mealId: `${SHAKE}#1`, date: D(0), slot: 'dinner' },
    { type: 'setRecipeSlot', key: SHAKE, slot: 'snack' });
  assert.equal(meal(s, `${SHAKE}#1`).slot, 'dinner');
  assert.equal(meal(s, `${SHAKE}#2`).slot, 'snack');
  s = run(s, { type: 'setRecipeServings', key: SHAKE, servings: 4 });
  assert.equal(s.draft.recipes[SHAKE].servings, 4);
});

test('new dates refuse to strand meals or approved trips unless they go back to the tray', () => {
  let s = run(planWith(14, add('pepperoni_pizza', 'Pepperoni Pizza', 2)),
    { type: 'place', mealId: `${PIZZA}#1`, date: D(10), slot: 'dinner' },
    { type: 'addTrip', date: D(9) }, { type: 'setPacks', date: D(9), productId: 61, packs: 2 },
    { type: 'setPacks', date: D(1), productId: 61, packs: 1 });
  assert.match(refusal(s, { type: 'setWindow', start_date: s.draft.start_date, days: 7 }),
    /1 meal would fall outside/);
  const out = step(s, { type: 'setWindow', start_date: s.draft.start_date, days: 7, unplaceOutside: true });
  s = out.state;
  assert.equal(s.draft.days, 7);
  assert.deepEqual([meal(s, `${PIZZA}#1`).date, meal(s, `${PIZZA}#1`).pinned], [null, true]);
  assert.deepEqual(s.draft.fixed_dates, []);
  assert.deepEqual(s.draft.packs_override, { [`${D(1)}:61`]: 1 });
  assert.equal(out.said, 'The plan now runs Fri 9 Oct to Thu 15 Oct. 1 meal went back to the tray.');
  assert.match(refusal(s, { type: 'setWindow', start_date: s.draft.start_date, days: 15 }), /1 to 14 days/);
});

test('settings are checked, and a slot with meals in it cannot be switched off', () => {
  let s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1)),
    { type: 'place', mealId: `${PIZZA}#1`, date: D(0), slot: 'dinner' });
  assert.match(refusal(s, { type: 'setPrefs', prefs: { household_servings: 0 } }), /household servings/);
  assert.match(refusal(s, { type: 'setPrefs', prefs: { shop_weekdays: [7] } }), /shop weekdays/);
  assert.match(refusal(s, { type: 'setPrefs', prefs: { shop_weekdays: [] } }), /shop weekdays/);
  assert.match(refusal(s, { type: 'setPrefs', prefs: { slots_on: ['breakfast', 'lunch', 'snack'] } }),
    /1 meal is in Dinner; move it first/);
  s = run(s, { type: 'setPrefs', prefs: { shop_weekdays: [5, 2], buy_ahead_days: 3, strategy: 'fewest_trips' } });
  assert.deepEqual(s.draft.prefs.shop_weekdays, [2, 5]);
  assert.equal(s.draft.prefs.buy_ahead_days, 3);
  assert.equal(step(s, { type: 'setPrefs', prefs: { buy_ahead_days: 3 } }).state, s, 'no change, no rev');
});

test('a new shopping area clears the resolved products so they are checked again', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  s = step(s, { type: 'setResolved', resolved: [{ key: PIZZA, title: 'Pepperoni Pizza', status: 'ok' } as never] }).state;
  assert.ok(s.draft.resolved[PIZZA]);
  assert.equal(step(s, { type: 'setSettings', settings: {} }).state, s);
  s = run(s, { type: 'setSettings', settings: { lat: 49.28, lon: -123.12, max_km: 5 } });
  assert.deepEqual(s.draft.resolved, {});
  assert.match(refusal(s, { type: 'setSettings', settings: { max_km: 0 } }), /out of range/);
});

test('resolved recipes are stored only for recipes still in the plan', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  const r = { key: PIZZA, title: 'Pepperoni Pizza', status: 'needs_servings' } as never;
  const gone = { key: 'starter:gone', title: 'Gone', status: 'ok' } as never;
  const next = step(s, { type: 'setResolved', resolved: [r, gone] }).state;
  assert.deepEqual(Object.keys(next.draft.resolved), [PIZZA]);
  assert.equal(next.draft.rev, s.draft.rev + 1, 'new products change the schedule');
  assert.equal(step(s, { type: 'setResolved', resolved: [gone] }).state, s);
});

test('a recipe whose products could not be checked can be made pending again, without an undo step', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1), add('chicken_fried_rice', 'Chicken Fried Rice', 1));
  s = step(s, { type: 'setResolved', resolved: [
    { key: PIZZA, title: 'Pepperoni Pizza', status: 'llm_error', message: 'the model did not answer' } as never,
    { key: RICE, title: 'Chicken Fried Rice', status: 'ok' } as never,
  ] }).state;
  const out = step(s, { type: 'forgetResolved', key: PIZZA });
  assert.deepEqual(Object.keys(out.state.draft.resolved), [RICE]);
  assert.equal(out.state.draft.rev, s.draft.rev + 1, 'the schedule is checked again');
  assert.equal(recorded({ type: 'forgetResolved', key: PIZZA }), false);
  // A recipe that resolved, or one never resolved, is left alone: redoing it costs a model call.
  assert.equal(step(s, { type: 'forgetResolved', key: RICE }).state, s);
  assert.equal(step(out.state, { type: 'forgetResolved', key: PIZZA }).state, out.state);
});

test('approving copies the trip the shopper saw, and only from the current answer', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  const t = trip(D(1), [line(10, 'Chicken Breast', { packs: 2, price: 18.72 }),
    line(61, 'Flour', { packs: null, price: null, storage: 'pantry' })]);
  assert.match(refusal(s, { type: 'approveTrip', trip: t, strategy: 'fresh', rev: s.draft.rev - 1 }),
    /checked again/);
  let next = run(s, { type: 'approveTrip', trip: t, strategy: 'fresh', rev: s.draft.rev });
  assert.deepEqual(next.draft.trips, [{ date: D(1), fingerprint: 'a'.repeat(64), strategy: 'fresh',
    snapshot: [{ product_id: 10, packs: 2, storage: 'fridge', price_at_approval: 18.72 },
      { product_id: 61, packs: null, storage: 'pantry', price_at_approval: null }] }]);
  // Accepting changes is approving the trip again: the old approval is replaced, not doubled.
  const changed = trip(D(1), [line(10, 'Chicken Breast', { packs: 3 })], { fingerprint: 'b'.repeat(64),
    status: 'needs_review' });
  const again = step(next, { type: 'approveTrip', trip: changed, strategy: 'fresh', rev: next.draft.rev });
  assert.equal(again.state.draft.trips.length, 1);
  assert.equal(again.state.draft.trips[0].fingerprint, 'b'.repeat(64));
  assert.match(again.said, /approved again/);
  next = run(again.state, { type: 'unapproveTrip', date: D(1) });
  assert.deepEqual(next.draft.trips, []);
  assert.deepEqual(approvedFrom(t, 'fewest_trips').strategy, 'fewest_trips');
});

test('an approval belongs to its strategy, and the other strategy\'s list replaces it only when asked', () => {
  // The engine reads draft.trips per strategy: after a switch, the day approved under Shop fresh
  // comes back as a suggested Fewest trips trip (schedule.py).
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  s = run(s, { type: 'approveTrip', trip: trip(D(1), [line(10, 'Chicken Breast')]), strategy: 'fresh',
    rev: s.draft.rev }, { type: 'setPrefs', prefs: { strategy: 'fewest_trips' } });
  assert.equal(approvedElsewhere(s.draft, D(1), 'fewest_trips'), 'fresh');
  assert.equal(approvedElsewhere(s.draft, D(1), 'fresh'), null);
  assert.equal(approvedElsewhere(s.draft, D(2), 'fewest_trips'), null);
  assert.equal(refusal(s, { type: 'dismissTrip', date: D(1) }),
    'that trip is approved under Shop fresh; take the approval back first');
  assert.match(refusal(s, { type: 'moveTrip', from: D(1), to: D(3) }), /under Shop fresh/);
  const fewest = trip(D(1), [line(10, 'Chicken Breast', { storage: 'freezer' })],
    { id: `fewest_trips-${D(1)}`, fingerprint: 'c'.repeat(64) });
  assert.equal(refusal(s, { type: 'approveTrip', trip: fewest, strategy: 'fewest_trips', rev: s.draft.rev }),
    'the trip on Sat 10 Oct is approved under Shop fresh; take that approval back, or approve this list in its place');
  const replaced = step(s, { type: 'approveTrip', trip: fewest, strategy: 'fewest_trips', rev: s.draft.rev,
    replace: true });
  assert.deepEqual(replaced.state.draft.trips.map((t) => [t.date, t.strategy, t.fingerprint]),
    [[D(1), 'fewest_trips', 'c'.repeat(64)]], 'one approval a day, never two');
  assert.equal(replaced.said, 'Trip on Sat 10 Oct approved under Fewest trips, in place of its Shop fresh approval.');
  // Taking it back works whichever strategy is shown.
  assert.deepEqual(run(s, { type: 'unapproveTrip', date: D(1) }).draft.trips, []);
});

test('trips are dismissed, restored, added and moved; an approved one stays put', () => {
  let s = run(planWith(7), { type: 'setPacks', date: D(2), productId: 10, packs: 3 },
    { type: 'moveTrip', from: D(2), to: D(4) });
  assert.deepEqual(s.draft.dismissed_dates, [D(2)]);
  assert.deepEqual(s.draft.fixed_dates, [D(4)]);
  assert.deepEqual(s.draft.packs_override, { [`${D(4)}:10`]: 3 }, 'pack counts move with the trip');
  s = run(s, { type: 'restoreTrip', date: D(2) }, { type: 'dismissTrip', date: D(4) });
  assert.deepEqual(s.draft.dismissed_dates, [D(4)]);
  assert.deepEqual(s.draft.fixed_dates, []);
  s = run(s, { type: 'approveTrip', trip: trip(D(5), []), strategy: 'fresh', rev: s.draft.rev });
  assert.match(refusal(s, { type: 'moveTrip', from: D(5), to: D(6) }), /approved trips stay/);
  assert.match(refusal(s, { type: 'dismissTrip', date: D(5) }), /approved/);
  assert.match(refusal(s, { type: 'moveTrip', from: D(3), to: D(5) }), /approved trip on Wed 14 Oct/);
  assert.match(refusal(s, { type: 'addTrip', date: D(9) }), /outside the plan/);
});

test('packs, storage and product pins are the shopper\'s, and can be taken back', () => {
  let s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1)),
    { type: 'setPacks', date: D(1), productId: 10, packs: 0 },
    { type: 'setStorage', productId: 10, storage: 'freezer' },
    { type: 'pinProduct', recipeKey: PIZZA, lineNo: 2, productId: 167 });
  assert.deepEqual(s.draft.packs_override, { [`${D(1)}:10`]: 0 });
  assert.deepEqual(s.draft.storage_overrides, { 10: 'freezer' });
  assert.deepEqual(s.draft.pins, { [PIZZA]: { 2: 167 } });
  s = run(s, { type: 'setPacks', date: D(1), productId: 10, packs: null },
    { type: 'setStorage', productId: 10, storage: null },
    { type: 'pinProduct', recipeKey: PIZZA, lineNo: 2, productId: null });
  assert.deepEqual([s.draft.packs_override, s.draft.storage_overrides, s.draft.pins], [{}, {}, {}]);
  assert.match(refusal(s, { type: 'setPacks', date: D(1), productId: 10, packs: -1 }), /0 to 99/);
});

test('Suggest cook days applies whole on its own rev, and move by move once the plan changed', () => {
  let s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2)),
    { type: 'place', mealId: `${PIZZA}#1`, date: D(0), slot: 'dinner' },
    { type: 'place', mealId: `${PIZZA}#2`, date: D(1), slot: 'dinner' });
  const ops = [
    { op: 'move_meal' as const, meal_id: `${PIZZA}#1`, from: { date: D(0), slot: 'dinner' as const },
      to: { date: D(3), slot: 'dinner' as const }, reason: 'r1' },
    { op: 'move_meal' as const, meal_id: `${PIZZA}#2`, from: { date: D(1), slot: 'dinner' as const },
      to: { date: D(4), slot: 'dinner' as const }, reason: 'r2' },
  ];
  const meals = s.draft.meals.map((m) => ({ ...m, date: m.id.endsWith('#1') ? D(3) : D(4) }));
  const proposal = { rev: s.draft.rev, ops, meals, warnings_before: { must_fix: 2, decide: 0, note: 0 },
    warnings_after: { must_fix: 0, decide: 0, note: 0 } };
  const whole = step(s, { type: 'applyCookDays', proposal });
  assert.deepEqual(whole.state.draft.meals.map((m) => m.date), [D(3), D(4)]);
  assert.equal(whole.said, '2 meals moved to fresher days.');

  s = run(s, { type: 'place', mealId: `${PIZZA}#2`, date: D(2), slot: 'dinner' });
  const partial = step(s, { type: 'applyCookDays', proposal });
  assert.deepEqual(partial.state.draft.meals.map((m) => m.date), [D(3), D(2)]);
  assert.match(partial.said, /1 of 2 moves applied; 1 skipped because the plan changed since/);
});

test('every edit that changes the plan gets the next rev; a refused one keeps it', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  const r = s.draft.rev;
  assert.equal(step(s, { type: 'setWanted', key: PIZZA, wanted: 2 }).state.draft.rev, r + 1);
  assert.equal(step(s, { type: 'setWanted', key: PIZZA, wanted: 99 }).state.draft.rev, r);
  const cleared = step(s, { type: 'clear', today: TODAY, id: 'p2' }).state;
  assert.equal(cleared.draft.rev, r + 1, 'a cleared plan keeps counting');
  assert.deepEqual(cleared.draft.meals, []);
});

test('a batch is one step: what fits is applied and what does not is said', () => {
  const s = planWith(7);
  const out = step(s, { type: 'batch', edits: [add('pepperoni_pizza', 'Pepperoni Pizza', 3),
    add('pepperoni_pizza', 'Pepperoni Pizza', 1), { type: 'setWindow', start_date: s.draft.start_date, days: 14 }] });
  assert.equal(out.state.draft.rev, s.draft.rev + 1);
  assert.equal(out.state.draft.meals.length, 3);
  assert.equal(out.state.draft.days, 14);
  assert.match(out.said, /Not done: Pepperoni Pizza is already in the plan/);
  const none = step(s, { type: 'batch', edits: [{ type: 'remove', mealId: 'x' }] });
  assert.equal(none.state, s);
  assert.match(none.refused ?? '', /not in the plan/);
});

test('undo and redo round-trip, the rev only counts up, and server answers are not steps', () => {
  let h = startHistory(planWith(7));
  const edit = (e: PlanEdit) => { h = historyStep(h, e).history; };
  edit(add('pepperoni_pizza', 'Pepperoni Pizza', 2));
  const afterAdd = h.present;
  edit({ type: 'setResolved', resolved: [{ key: PIZZA, title: 'Pepperoni Pizza', status: 'ok' } as never] });
  assert.equal(h.past.length, 1, 'resolving is not a step of its own');
  edit({ type: 'place', mealId: `${PIZZA}#1`, date: D(1), slot: 'dinner' });
  edit({ type: 'place', mealId: 'missing', date: D(1), slot: 'dinner' });
  assert.equal(h.past.length, 2, 'a refused edit is not a step');
  const placedRev = h.present.draft.rev;

  h = undoPlan(h);
  assert.equal(meal(h.present, `${PIZZA}#1`).date, null);
  assert.ok(h.present.draft.resolved[PIZZA], 'undo keeps products already resolved');
  assert.equal(h.present.draft.rev, placedRev + 1);
  h = undoPlan(h);
  assert.deepEqual(h.present.draft.meals, [], 'back to the empty plan');
  assert.equal(canUndo(h), false);
  h = redoPlan(redoPlan(h));
  assert.equal(meal(h.present, `${PIZZA}#1`).date, D(1));
  assert.equal(h.present.draft.rev, placedRev + 4, 'two undos and two redos, each a new rev');
  assert.equal(canRedo(h), false);
  assert.deepEqual(afterAdd.draft.meals.length, 2);
});
