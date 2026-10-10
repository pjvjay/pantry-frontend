// The wizard's Basics: where the household shops (an address, the device's location, a demo
// area), how far it goes, the demo stores that reaches, and the words around the search.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AREAS, CURRENT_LOCATION, DEFAULT_POINT, DISTANCES, PRIVACY_NOTE, areaOf, areaSettings, distanceChoices,
  distanceLabel, geocodeErrorText, haversineKm, kmText, locationErrorText, locationSettings, placeText, pointOf,
  rangeText, searchProblem, storesNear,
} from '../src/mealplan/basics.ts';
import { sameArea, step } from '../src/mealplan/model.ts';
import type { Store } from '../src/types.ts';
import { add, planWith, run } from './helpers/mealplan.ts';

const STORES: Store[] = [
  { id: 1, name: 'Pantry Mart Downtown', lat: 49.2827, lon: -123.1207, address: '800 Robson St' },
  { id: 2, name: 'GreenLeaf Grocers Kitsilano', lat: 49.2681, lon: -123.1686, address: '2200 W 4th Ave' },
  { id: 3, name: 'ValuFresh East Van', lat: 49.2766, lon: -123.0700, address: '1800 Commercial Dr' },
];

test('distances are great-circle km, measured from the default point when the plan has none', () => {
  assert.equal(haversineKm(DEFAULT_POINT, DEFAULT_POINT), 0);
  // downtown to Kitsilano is about 3.7 km
  const d = haversineKm(DEFAULT_POINT, { lat: 49.2684, lon: -123.1683 });
  assert.ok(d > 3.5 && d < 3.9, String(d));
  assert.deepEqual(pointOf({}), { lat: 49.28, lon: -123.12 });
  assert.deepEqual(pointOf({ lat: 1, lon: 2 }), { lat: 1, lon: 2 });
  assert.equal(kmText(0.43), '0.4 km');
  assert.equal(kmText(12.6), '13 km');
});

test('the stores in range, nearest first, and a clear warning when none is', () => {
  const kits = { ...areaSettings(AREAS[1]), max_km: 2 };
  const near = storesNear(STORES, kits);
  assert.deepEqual(near.inRange.map((s) => s.name), ['GreenLeaf Grocers Kitsilano']);
  assert.equal(near.nearest?.name, 'GreenLeaf Grocers Kitsilano');
  assert.deepEqual(rangeText(near, kits), { text: '1 demo store within 2 km', warn: false });
  assert.equal(storesNear(STORES, { max_km: null }).inRange.length, 3, 'any distance: every store');
  assert.equal(rangeText(storesNear(STORES, {}), {}).text, '3 demo stores at any distance');
  // Toronto, 5 km: nothing, and why
  const far = { lat: 43.6532, lon: -79.3832, address: 'Toronto', max_km: 5 };
  const none = rangeText(storesNear(STORES, far), far);
  assert.equal(none.warn, true);
  assert.match(none.text, /^No store within 5 km of Toronto\. The demo's stores are all in Vancouver: pick a Vancouver area or a longer distance\. The nearest is .*, \d+ km away\.$/);
  assert.equal(rangeText(storesNear([], far), far).text.endsWith('a longer distance.'), true);
});

test('the areas: downtown is the server default, the others their point and name', () => {
  assert.deepEqual(AREAS.map((a) => a.label), ['Downtown Vancouver', 'Kitsilano', 'East Vancouver', 'Richmond']);
  assert.deepEqual(areaSettings(AREAS[0]), { lat: null, lon: null, address: null });
  assert.deepEqual(areaSettings(AREAS[2]), { lat: 49.2765, lon: -123.07, address: 'East Vancouver' });
  assert.equal(areaOf({})?.id, 'downtown');
  assert.equal(areaOf({ lat: 49.1666, lon: -123.1336 })?.id, 'richmond');
  assert.equal(areaOf({ lat: 49.3, lon: -123.1 }), null);
  assert.equal(placeText({}), 'Downtown Vancouver');
  assert.equal(placeText({ lat: 49.3, lon: -123.1, address: '1055 Canada Pl, Vancouver' }), '1055 Canada Pl, Vancouver');
  assert.equal(placeText({ lat: 49.31234, lon: -123.1 }), '49.3123, -123.1000');
});

test('the distance is one of 2, 5, 10, 25 km or any, and a plan\'s own distance is kept among them', () => {
  assert.deepEqual(DISTANCES, [2, 5, 10, 25, null]);
  assert.deepEqual(DISTANCES.map(distanceLabel), ['2 km', '5 km', '10 km', '25 km', 'Any']);
  assert.deepEqual(distanceChoices(5), [2, 5, 10, 25, null]);
  assert.deepEqual(distanceChoices(undefined), [2, 5, 10, 25, null]);
  assert.deepEqual(distanceChoices(3.5), [2, 3.5, 5, 10, 25, null]);
});

test('the device\'s location is kept to four decimals, and named as such', () => {
  assert.deepEqual(locationSettings(49.282731234, -123.120738999),
    { lat: 49.2827, lon: -123.1207, address: CURRENT_LOCATION });
  assert.equal(locationSettings(NaN, 0), null);
  assert.equal(locationSettings(91, 0), null);
  assert.match(locationErrorText(1), /not allowed your location/);
  assert.match(locationErrorText(2), /could not tell where it is/);
  assert.match(locationErrorText(3), /took too long/);
  assert.match(locationErrorText('unsupported'), /cannot share your location/);
});

test('a search is sent only when it can be read, and a refusal is said in words', () => {
  assert.equal(searchProblem('  ab '), 'Type at least three letters of a street, place or postcode.');
  assert.equal(searchProblem('V6B'), null);
  assert.match(searchProblem('x'.repeat(201)) ?? '', /200 characters/);
  assert.match(geocodeErrorText(429, 'rate_limited'), /one a second/);
  assert.match(geocodeErrorText(503, 'geocoder_off'), /off on this hub/);
  assert.match(geocodeErrorText(502, 'geocoder_unavailable'), /did not answer/);
  assert.match(geocodeErrorText(400, 'bad_query'), /could not be read/);
  assert.match(geocodeErrorText(500, null), /\(500\)/);
  assert.match(PRIVACY_NOTE, /OpenStreetMap only when you search/);
});

test('the address names the place: a new name alone keeps the products, a new point checks them again', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  s = run(s, { type: 'setResolved', resolved: [{ key: 'starter:pepperoni_pizza', title: 'Pepperoni Pizza', status: 'ok',
    lines: [] } as never] });
  const kits = run(s, { type: 'setSettings', settings: areaSettings(AREAS[1]) });
  assert.equal(kits.draft.settings.address, 'Kitsilano');
  assert.deepEqual(kits.draft.resolved, {}, 'a new point');
  const named = run(s, { type: 'setSettings', settings: { address: 'Home' } });
  assert.equal(named.draft.settings.address, 'Home');
  assert.ok(named.draft.resolved['starter:pepperoni_pizza'], 'the same point: products kept');
  assert.ok(sameArea(named.draft.settings, s.draft.settings));
  assert.equal(step(s, { type: 'setSettings', settings: { address: 'Home' } }).said, 'Shopping from Home.');
  assert.equal(run(named, { type: 'setSettings', settings: { address: '  ' } }).draft.settings.address, null);
  assert.match(step(s, { type: 'setSettings', settings: { address: 'x'.repeat(201) } }).refused ?? '', /200 characters/);
});
