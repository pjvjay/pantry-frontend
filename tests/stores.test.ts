// The Ingredients stage's "Your stores": the distance, the stores near the shopper from
// /mealplan/stores, and turning one off, which skips it without checking the products again.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { basketKey, unavailableHeading } from '../src/mealplan/basket.ts';
import { sameArea, step } from '../src/mealplan/model.ts';
import {
  DISTANCES, distanceChoices, distanceLabel, kmText, sellsText, storesLine, storesView, widerDistance,
} from '../src/mealplan/stores.ts';
import type { MealStores, StoreChoice } from '../src/types.ts';
import { add, planWith, run } from './helpers/mealplan.ts';

const store = (id: number, name: string, km: number | null, over: Partial<StoreChoice> = {}): StoreChoice =>
  ({ id, name, address: '', distance_km: km, in_range: km !== null && km <= 5, off: false, sells: 10, ...over });

const ANSWER: MealStores = { v: 1, products_total: 15, stores: [
  store(3, 'ValuFresh East Van', 4.1), store(1, 'Pantry Mart Downtown', 0.4, { sells: 15 }),
  store(9, 'Richmond Superstore', 13.2, { sells: 0 }), store(2, 'GreenLeaf Grocers Kitsilano', 3.7, { off: true }),
] };

test('the distance is one of 2, 5, 10, 25 km or any, and a plan\'s own distance is kept among them', () => {
  assert.deepEqual(DISTANCES, [2, 5, 10, 25, null]);
  assert.deepEqual(DISTANCES.map(distanceLabel), ['2 km', '5 km', '10 km', '25 km', 'Any']);
  assert.deepEqual(distanceChoices(5), [2, 5, 10, 25, null]);
  assert.deepEqual(distanceChoices(undefined), [2, 5, 10, 25, null]);
  assert.deepEqual(distanceChoices(3.5), [2, 3.5, 5, 10, 25, null]);
  assert.equal(kmText(0.43), '0.4 km');
  assert.equal(kmText(12.6), '13 km');
  assert.equal(kmText(null), 'distance unknown');
});

test('the stores nearest first, those in range apart, and how many are in use', () => {
  const st = { max_km: 5 };
  const v = storesView(ANSWER, st);
  assert.deepEqual(v.inRange.map((s) => s.id), [1, 2, 3]);
  assert.deepEqual(v.farther.map((s) => s.name), ['Richmond Superstore']);
  assert.equal(v.on, 2);
  assert.equal(v.warning, null);
  assert.equal(storesLine(v, st), '2 of 3 stores within 5 km in use');
  assert.equal(storesLine(storesView({ ...ANSWER, stores: ANSWER.stores.map((s) => ({ ...s, off: false })) }, st), st),
    '3 stores within 5 km, all in use');
  assert.equal(sellsText(15, 15), 'sells 15 of your 15 products');
  assert.equal(sellsText(0, 15), 'sells none of your 15 products');
  assert.equal(sellsText(1, 1), 'sells 1 of your 1 product');
  assert.equal(sellsText(null, 15), 'not checked yet');
  assert.equal(sellsText(0, 0), 'no products chosen yet');
});

test('a clear warning when no store is in range, or every one there is off', () => {
  const far = { lat: 43.65, lon: -79.38, address: 'Toronto', max_km: 2 };
  const none = storesView({ v: 1, products_total: 3, stores: [store(1, 'Pantry Mart Downtown', 3350, { in_range: false })] }, far);
  assert.equal(none.warning, 'No store within 2 km of Toronto. The demo\'s stores are all in Vancouver: choose a longer '
    + 'distance, or a Vancouver area in Set up. The nearest is Pantry Mart Downtown, 3350 km away.');
  assert.equal(storesLine(none, far), 'No stores within 2 km');
  const allOff = storesView({ ...ANSWER, stores: ANSWER.stores.map((s) => ({ ...s, off: true })) }, { max_km: 5 });
  assert.match(allOff.warning ?? '', /^Every store in range is turned off/);
});

test('turning a store off is an undoable edit that keeps the products and asks for the basket again', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  s = run(s, { type: 'setResolved', resolved: [{ key: 'starter:pepperoni_pizza', title: 'Pepperoni Pizza', status: 'ok',
    lines: [] } as never] });
  const off = step(s, { type: 'setStoreOff', storeId: 2, name: 'GreenLeaf Grocers', off: true });
  assert.equal(off.said, 'GreenLeaf Grocers turned off: the plan buys nothing there.');
  assert.deepEqual(off.state.draft.settings.stores_off, [2]);
  assert.ok(off.state.draft.resolved['starter:pepperoni_pizza'], 'products kept');
  assert.ok(sameArea(off.state.draft.settings, s.draft.settings));
  assert.notEqual(basketKey(off.state.draft), basketKey(s.draft), 'the basket is asked again');
  assert.equal(off.state.draft.rev, s.draft.rev + 1);
  let t = run(off.state, { type: 'setStoreOff', storeId: 1, name: 'Pantry Mart', off: true });
  assert.deepEqual(t.draft.settings.stores_off, [1, 2]);
  assert.equal(step(t, { type: 'setStoreOff', storeId: 1, name: 'Pantry Mart', off: true }).state, t, 'no change');
  t = run(t, { type: 'setStoreOff', storeId: 2, name: 'GreenLeaf Grocers', off: false });
  assert.deepEqual(t.draft.settings.stores_off, [1]);
  assert.equal(step(t, { type: 'setStoreOff', storeId: 0, name: 'x', off: true }).refused, 'that is not a store');
  // the same through setSettings, kept in order; a list the server would refuse is refused here
  assert.deepEqual(run(s, { type: 'setSettings', settings: { stores_off: [5, 3, 5] } }).draft.settings.stores_off, [3, 5]);
  assert.match(step(s, { type: 'setSettings', settings: { stores_off: [-1] } }).refused ?? '', /not readable/);
  // a new distance checks the products again, as before
  assert.deepEqual(run(s, { type: 'setSettings', settings: { max_km: 10 } }).draft.resolved, {});
});

test('an ingredient sold only at stores turned off says so', () => {
  assert.equal(unavailableHeading('stores_off', []), 'Sold only at stores you turned off');
});

test('a wider distance takes in a store that far, or the next one up, or any distance', () => {
  assert.equal(widerDistance(5, 13.9), 25);
  assert.equal(widerDistance(5, 7), 10);
  assert.equal(widerDistance(5, null), 10, 'how far unknown: one step');
  assert.equal(widerDistance(25, 40), null, 'past the last choice: any distance');
  assert.equal(widerDistance(3, 4), 5, 'a plan’s own distance between the usual ones');
  assert.equal(widerDistance(null, 50), undefined, 'already any distance');
});
