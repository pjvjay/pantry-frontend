// The wizard's Basics: where the shopper is (an address, the device's location, a demo area),
// the words around the search, the budget's figures and the "Your plan" summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AREAS, BUDGET_PICKS, CURRENT_LOCATION, PRIVACY_NOTE, areaOf, areaSettings, geocodeErrorText, locationErrorText,
  locationSettings, perDayText, placeText, planSummary, refusalCode, searchProblem, weekdaysText,
} from '../src/mealplan/basics.ts';
import { sameArea, step } from '../src/mealplan/model.ts';
import { add, planWith, run } from './helpers/mealplan.ts';

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

test('the hub\'s refusal code is read from {code, message} or from the code alone', () => {
  assert.equal(refusalCode({ code: 'rate_limited', message: 'slow down' }), 'rate_limited');
  assert.equal(refusalCode('geocoder_off'), 'geocoder_off');
  assert.equal(refusalCode('Something went wrong.'), null);
  assert.equal(refusalCode(null), null);
});

test('"Your plan" sums Basics up in a few words', () => {
  let s = planWith(7);
  let rows = Object.fromEntries(planSummary(s.draft).map((r) => [r.key, r]));
  assert.deepEqual(rows.when, { key: 'when', label: 'When', value: 'Fri 9 Oct – Thu 15 Oct', note: '1 week' });
  assert.deepEqual(rows.budget, { key: 'budget', label: 'Budget', value: 'No budget' });
  assert.equal(rows.diet.value, 'Anything');
  assert.equal(rows.avoid.value, 'Nothing');
  assert.equal(rows.origin.value, 'No US products · Canada first · then 15 more');
  assert.deepEqual(rows.where, { key: 'where', label: 'Where you are', value: 'Downtown Vancouver' });
  assert.equal(rows.days.value, 'Every day');
  assert.equal(rows.meals.value, 'Breakfast, Lunch, Dinner, Snack');
  s = run(s, { type: 'setPrefs', prefs: { budget: 75, diet: 'vegan', avoid: ['soy', 'nuts'], shop_weekdays: [5, 6],
    slots_on: ['dinner'] } }, { type: 'setSettings', settings: { ...areaSettings(AREAS[1]), max_km: null,
    exclude_origin: [], preference: [] } }, { type: 'setWindow', start_date: s.draft.start_date, days: 14 });
  rows = Object.fromEntries(planSummary(s.draft).map((r) => [r.key, r]));
  assert.deepEqual([rows.budget.value, rows.budget.note], ['$75.00', 'about $5.36 a day']);
  assert.equal(rows.when.note, '2 weeks');
  assert.equal(rows.diet.value, 'Vegan');
  assert.equal(rows.avoid.value, 'nuts, soy');
  assert.equal(rows.origin.value, 'US products allowed');
  assert.equal(rows.where.value, 'Kitsilano', 'the location only: stores are chosen in Ingredients');
  assert.equal(rows.days.value, 'Weekends');
  assert.equal(rows.meals.value, 'Dinner');
});

test('the budget\'s quick picks and its figure a day; shop days in words', () => {
  assert.deepEqual(BUDGET_PICKS, [50, 75, 100, 150]);
  assert.equal(perDayText(75, 7), 'about $10.71 a day');
  assert.equal(weekdaysText([0, 1, 2, 3, 4]), 'Weekdays');
  assert.equal(weekdaysText([5, 0, 2]), 'Mon, Wed and Sat');
  assert.equal(weekdaysText([3]), 'Thu');
});
