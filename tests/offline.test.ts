// In-store mode's offline copy: the approved trips of the plan as it is, kept beside it so the
// list opens where pantry-api cannot be reached, and never used for another plan or rev.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFLINE_KEY, OFFLINE_MAX_CHARS, copiedAt, copyKey, copyOf, offlineTrip, parseOffline, readOffline, writeOffline,
} from '../src/mealplan/offline.ts';
import { heldProducts, instoreView, tripChangeText } from '../src/mealplan/shoplist.ts';
import type { StorageLike } from '../src/mealplan/persist.ts';
import type { MealSchedule, PlanWarning, TripDiff } from '../src/types.ts';
import { D, add, line, planWith, run, schedule, trip } from './helpers/mealplan.ts';

function memory(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

const refusing: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

const AT = '2026-10-08T21:41:00';
const plan = () => planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2));
const meal = { meal_id: 'starter:pepperoni_pizza#1', recipe_key: 'starter:pepperoni_pizza', title: 'Pepperoni Pizza',
  date: D(1), slot: 'dinner' as const };

function answerFor(rev: number) {
  return schedule(rev, [], [
    trip(D(1), [line(10, 'Chicken Thighs', { for_meals: [meal], price: 9.36 }), line(11, 'Whole Milk', { price: 2.5 })],
      { status: 'approved', total_cost: 11.86 }),
    trip(D(4), [line(12, 'Butter')], { status: 'suggested' }),
    trip(D(5), [line(13, 'Flour')], { status: 'needs_review', total_cost: 3 }),
  ]);
}

test('the copy keeps the approved trips of the plan as it is, trimmed to what the store list reads', () => {
  const s = plan();
  const c = copyOf(answerFor(s.draft.rev), s.draft, AT);
  assert.ok(c);
  assert.deepEqual([c.id, c.rev, c.strategy, c.at], [s.draft.id, s.draft.rev, 'fresh', AT]);
  assert.deepEqual(c.trips.map((t) => [t.date, t.status]), [[D(1), 'approved'], [D(5), 'needs_review']],
    'a suggestion is not kept: only an approved list is the one to shop from');
  const ln = c.trips[0].lines[0];
  assert.equal(ln.shelf_life.note, '', 'storage times and their sources stay with the trip sheet');
  assert.deepEqual(ln.for_meals.map((m) => m.title), ['Pepperoni Pizza']);
  // the store list reads the copy as it reads the answer
  const fresh = instoreView(answerFor(s.draft.rev).strategies[0].trips[0], [10]);
  const copied = instoreView(c.trips[0], [10]);
  assert.deepEqual([copied.count, copied.spent, copied.cost], [fresh.count, fresh.spent, fresh.cost]);
  assert.deepEqual(copied.basket.map((r) => [r.name, r.forText]), fresh.basket.map((r) => [r.name, r.forText]));
});

test('a day approved under the other way to shop is kept from its approved list', () => {
  let s = plan();
  const approved = trip(D(1), [line(10, 'Chicken Thighs', { for_meals: [meal], price: 9.36 })]);
  s = run(s, { type: 'approveTrip', trip: approved, strategy: 'fresh', rev: s.draft.rev },
    { type: 'setPrefs', prefs: { strategy: 'fewest_trips' } });
  const answer = schedule(s.draft.rev, [], [{ ...approved, status: 'approved' }]);
  answer.strategies[1].trips = [approved, trip(D(4), [line(12, 'Butter')])];
  const c = copyOf(answer, s.draft, AT);
  assert.ok(c);
  assert.deepEqual([c.strategy, c.trips.map((t) => [t.date, t.status])], ['fewest_trips', [[D(1), 'approved']]]);
  assert.equal(offlineTrip(c, s.draft, D(1))?.status, 'approved', 'in-store mode opens the approved list');
});

test('no copy from an answer for another rev, or with nothing approved', () => {
  const s = plan();
  assert.equal(copyOf(answerFor(s.draft.rev - 1), s.draft, AT), null);
  const none = schedule(s.draft.rev, [], [trip(D(1), [line(10, 'Chicken Thighs')])]);
  assert.equal(copyOf(none, s.draft, AT), null);
});

test('the copy is used only for the plan and rev it was made from', () => {
  const s = plan();
  const c = copyOf(answerFor(s.draft.rev), s.draft, AT);
  assert.equal(offlineTrip(c, s.draft, D(1))?.date, D(1));
  assert.equal(offlineTrip(c, s.draft, D(4)), null, 'the suggested trip is not in it');
  const edited = run(s, { type: 'setWanted', key: 'starter:pepperoni_pizza', wanted: 1 });
  assert.equal(offlineTrip(c, edited.draft, D(1)), null, 'edited since: the copy may not be its list');
  assert.equal(offlineTrip(c, { ...s.draft, id: 'another' }, D(1)), null);
  assert.equal(offlineTrip(null, s.draft, D(1)), null);
});

test('kept in this browser under its own key, read back, and refused quietly', () => {
  const s = plan();
  const c = copyOf(answerFor(s.draft.rev), s.draft, AT);
  const store = memory({ 'pantry.mealplan.v1': '{"keep":"me"}' });
  assert.equal(writeOffline(store, c), true);
  assert.equal(store.data['pantry.mealplan.v1'], '{"keep":"me"}', 'the plan itself is never touched');
  assert.deepEqual(readOffline(store), c);
  assert.equal(copyKey(readOffline(store)), copyKey(c));
  assert.equal(writeOffline(store, null), true);
  assert.equal(readOffline(store), null, 'none kept once nothing is approved');
  assert.equal(writeOffline(refusing, c), false);
  assert.equal(readOffline(refusing), null);
  assert.equal(writeOffline(null, c), false);
  assert.equal(readOffline(null), null);
});

test('the copy keeps where each product comes from, so the store list still asks for the label', () => {
  const s = plan();
  const unclear = { country: null, claim: 'Origin unclear: sources disagree', status: 'conflicting' as const, preferred_rank: null };
  const answer = schedule(s.draft.rev, [], [trip(D(1), [line(10, 'Chicken Thighs', { origin: unclear }),
    line(11, 'Whole Milk', { origin: null }), line(12, 'Butter')], { status: 'approved' })]);
  const store = memory();
  assert.equal(writeOffline(store, copyOf(answer, s.draft, AT)), true);
  const [thighs, milk, butter] = readOffline(store)!.trips[0].lines;
  assert.deepEqual(thighs.origin, unclear);
  assert.equal(milk.origin, undefined, 'none said: none kept');
  assert.equal(butter.origin, undefined, 'an older API: none kept');
  assert.deepEqual(instoreView(readOffline(store)!.trips[0], []).toGet[0].sections[0].rows.map((r) => r.origin?.status ?? null),
    ['conflicting', null, null]);
  // a copy kept before its lines said where they come from is not the same list: the next answer
  // replaces it (the trip's fingerprint leaves the origin out)
  const before = copyOf(schedule(s.draft.rev, [], [trip(D(1), [line(10, 'Chicken Thighs'), line(11, 'Whole Milk'),
    line(12, 'Butter')], { status: 'approved' })]), s.draft, AT);
  const now = copyOf(answer, s.draft, AT);
  assert.notEqual(copyKey(before), copyKey(now));
  const evidenced = copyOf(schedule(s.draft.rev, [], [trip(D(1), [line(10, 'Chicken Thighs', { origin: { ...unclear,
    status: 'evidenced', country: 'Canada', claim: 'From Canada' } }), line(11, 'Whole Milk', { origin: null }), line(12, 'Butter')],
  { status: 'approved' })]), s.draft, AT);
  assert.notEqual(copyKey(evidenced), copyKey(now), 'evidence that came in since');
  assert.equal(copyKey(copyOf(answer, s.draft, '2026-10-09T08:00:00')), copyKey(now), 'the same list, later');
  // an origin this console could not have written makes the copy unreadable, as any damage does
  const broken = JSON.parse(store.data[OFFLINE_KEY]);
  broken.copy.trips[0].lines[0].origin.status = 'probably';
  assert.equal(parseOffline(JSON.stringify(broken)), null);
});

// A plan approved before the evidence that its chicken is from the United States came in: pantry-api
// now holds the chicken back (an origin_excluded warning) and the approved trip is changed.
const heldWarning = (product_id: number): PlanWarning => ({
  level: 'decide', code: 'origin_excluded', message: 'held back by the origin rule', strategy: null,
  remedies: [{ op: 'resolve', recipe_key: 'starter:pepperoni_pizza' }], meal_ids: [meal.meal_id], product_id,
  trip_date: null, recipe_key: 'starter:pepperoni_pizza',
});

function changedAnswer(rev: number): MealSchedule {
  const diff: TripDiff = {
    removed: [{ product_id: 10, name: 'Boneless Skinless Chicken Breast 500g', packs: 1, storage: 'fridge' }],
    added: [{ product_id: 11, name: 'Chicken Thighs Bone-In 700g', packs: 1, storage: 'fridge' }],
    changed: [{ product_id: 19, name: 'Whole Milk 1L', packs_before: 1, packs_after: 2, storage: 'fridge' }],
    text: ['-1 Boneless Skinless Chicken Breast 500g (fridge)', '+1 Chicken Thighs Bone-In 700g (fridge)'],
  };
  return {
    ...schedule(rev, [], [
      trip(D(1), [line(12, 'Butter')], { status: 'approved', diff: { ...diff, removed: [], added: [], changed: [] } }),
      trip(D(5), [line(11, 'Chicken Thighs Bone-In 700g'), line(19, 'Whole Milk 1L', { packs: 2 })],
        { status: 'needs_review', diff }),
    ]),
    // 10 is the chicken the changed trip no longer buys; 99 is held back but on no trip of this copy
    warnings: [heldWarning(10), heldWarning(99)],
  };
}

test('a changed trip keeps what changed, and the products the rule held back, so offline its notice reads the same', () => {
  const s = plan();
  const answer = changedAnswer(s.draft.rev);
  const c = copyOf(answer, s.draft, AT);
  assert.ok(c);
  assert.deepEqual(c.held, [10], 'only a held product a kept trip no longer buys');
  assert.equal(c.trips[0].diff, null, 'an approved trip says nothing changed');
  assert.deepEqual(c.trips[1].diff?.text, [], "the API's own sentences are not kept");
  const store = memory();
  assert.equal(writeOffline(store, c), true);
  const kept = readOffline(store);
  assert.ok(kept);
  const online = tripChangeText(answer.strategies[0].trips[1], heldProducts(answer));
  assert.equal(online, 'Boneless Skinless Chicken Breast 500g is no longer on it: your country rule now leaves it out. '
    + 'Chicken Thighs Bone-In 700g is new on it. Whole Milk 1L: 2 packs instead of 1.');
  assert.equal(tripChangeText(offlineTrip(kept, s.draft, D(5))!, new Set(kept.held)), online);
  // a copy kept before it kept what changed is not the same list: the next answer replaces it
  const before = { ...c, held: undefined, trips: c.trips.map((t) => ({ ...t, diff: null })) };
  assert.notEqual(copyKey(before), copyKey(c));
  assert.equal(copyKey(copyOf(answer, s.draft, '2026-10-09T08:00:00')), copyKey(c), 'the same list, later');
  // such an older copy is still read, and its notice names nothing it does not have
  const older = memory();
  writeOffline(older, before);
  assert.equal(readOffline(older)?.held, undefined);
  assert.equal(tripChangeText(offlineTrip(readOffline(older), s.draft, D(5))!, new Set()), '');
  // a diff or held list this console could not have written makes the copy unreadable
  const broken = JSON.parse(store.data[OFFLINE_KEY]);
  broken.copy.trips[1].diff.removed[0].product_id = 'ten';
  assert.equal(parseOffline(JSON.stringify(broken)), null);
  const badHeld = JSON.parse(store.data[OFFLINE_KEY]);
  badHeld.copy.held = ['10'];
  assert.equal(parseOffline(JSON.stringify(badHeld)), null);
});

test('a copy larger than the cap is not written, and the one before it is kept', () => {
  const s = plan();
  const store = memory();
  const small = copyOf(answerFor(s.draft.rev), s.draft, AT);
  writeOffline(store, small);
  const many = Array.from({ length: 3000 }, (_, i) => line(1000 + i, `Product ${i} with a long name`));
  const huge = copyOf(schedule(s.draft.rev, [], [trip(D(1), many, { status: 'approved' })]), s.draft, AT);
  assert.ok(JSON.stringify(huge).length > OFFLINE_MAX_CHARS);
  assert.equal(writeOffline(store, huge), false);
  assert.deepEqual(readOffline(store), small);
});

test('a stored value this console did not write, or a damaged one, reads as no copy', () => {
  assert.equal(parseOffline(null), null);
  assert.equal(parseOffline('not json'), null);
  assert.equal(parseOffline('{"v":2,"copy":{}}'), null);
  assert.equal(parseOffline(JSON.stringify({ v: 1, copy: { id: 'p', rev: 1, strategy: 'fresh', at: AT, trips: [{ date: 'soon' }] } })), null);
  assert.equal(parseOffline(JSON.stringify({ v: 1, copy: { id: 'p', rev: 1, strategy: 'nearest', at: AT, trips: [] } })), null);
  const s = plan();
  const c = copyOf(answerFor(s.draft.rev), s.draft, AT);
  const broken = JSON.parse(JSON.stringify({ v: 1, copy: c }));
  broken.copy.trips[0].lines[0].product = null;
  assert.equal(parseOffline(JSON.stringify(broken)), null);
  assert.equal(OFFLINE_KEY, 'pantry.offline.v1');
});

test('when the copy was made, by the shopper\'s clock', () => {
  assert.equal(copiedAt('2026-10-08T21:41:00', new Date('2026-10-08T23:00:00')), '9:41 PM');
  assert.equal(copiedAt('2026-10-08T00:05:00', new Date('2026-10-08T23:00:00')), '12:05 AM');
  assert.equal(copiedAt('2026-10-08T12:30:00', new Date('2026-10-09T08:00:00')), 'Thu 8 Oct, 12:30 PM');
});
