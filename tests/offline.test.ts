// In-store mode's offline copy: the approved trips of the plan as it is, kept beside it so the
// list opens where pantry-api cannot be reached, and never used for another plan or rev.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFLINE_KEY, OFFLINE_MAX_CHARS, copiedAt, copyKey, copyOf, offlineTrip, parseOffline, readOffline, writeOffline,
} from '../src/mealplan/offline.ts';
import { instoreView } from '../src/mealplan/shoplist.ts';
import type { StorageLike } from '../src/mealplan/persist.ts';
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
