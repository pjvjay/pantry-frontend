// In-store mode's basket: what the shopper has ticked off, per plan and trip, kept in this
// browser beside the plan (never in it), and what is dropped when the plan's days change.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SHOPPING_KEY, SHOPPING_PLANS, emptyShopping, parseShopping, pruneShopping, readShopping, setTicked, tickedOn,
  writeShopping,
} from '../src/mealplan/shopping.ts';
import { historyStep } from '../src/mealplan/model.ts';
import type { StorageLike } from '../src/mealplan/persist.ts';
import { startHistory } from '../src/mealplan/undo.ts';
import { D, add, planWith } from './helpers/mealplan.ts';

function memory(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

const refusing: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

test('a tick puts a product in the basket of one trip of one plan, and takes it out again', () => {
  let s = emptyShopping();
  s = setTicked(s, 'plan-1', D(1), 19, true);
  s = setTicked(s, 'plan-1', D(1), 11, true);
  s = setTicked(s, 'plan-1', D(4), 10, true);
  assert.deepEqual(tickedOn(s, 'plan-1', D(1)), [11, 19], 'ascending, each once');
  assert.deepEqual(tickedOn(s, 'plan-1', D(4)), [10]);
  assert.deepEqual(tickedOn(s, 'plan-1', D(2)), [], 'another trip: nothing ticked');
  assert.deepEqual(tickedOn(s, 'plan-2', D(1)), [], 'another plan: its own basket');
  // ticking what is ticked changes nothing, and is the same state
  assert.equal(setTicked(s, 'plan-1', D(1), 19, true), s);
  assert.equal(setTicked(s, 'plan-1', D(1), 99, false), s);
  s = setTicked(s, 'plan-1', D(1), 19, false);
  assert.deepEqual(tickedOn(s, 'plan-1', D(1)), [11]);
  // the last tick out of a trip drops the trip, and the last trip the plan
  s = setTicked(setTicked(s, 'plan-1', D(1), 11, false), 'plan-1', D(4), 10, false);
  assert.deepEqual(s, emptyShopping());
  // not a product or not a date: nothing happens
  assert.equal(setTicked(s, 'plan-1', D(1), 0, true), s);
  assert.equal(setTicked(s, 'plan-1', 'tomorrow', 3, true), s);
});

test('ticks are not plan edits: ticking leaves the plan, its revision and its undo history alone', () => {
  const plan = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2));
  const h = historyStep(startHistory(plan), { type: 'fillEmpty' }).history;
  const before = JSON.stringify(h);
  const { rev } = h.present.draft;
  const s = setTicked(emptyShopping(), h.present.draft.id, D(1), 19, true);
  assert.deepEqual(tickedOn(s, 'plan-1', D(1)), [19]);
  assert.equal(JSON.stringify(h), before, 'the plan, its rev and its history are untouched');
  assert.equal(h.present.draft.rev, rev);
  assert.equal(h.past.length, 1, 'still the one undo step the fill made');
});

test('the plans used last are kept, the oldest dropped once there are more than the limit', () => {
  let s = emptyShopping();
  for (let i = 1; i <= SHOPPING_PLANS + 2; i += 1) s = setTicked(s, `p${i}`, D(1), i, true);
  assert.equal(s.plans.length, SHOPPING_PLANS);
  assert.deepEqual(tickedOn(s, 'p1', D(1)), [], 'the oldest went first');
  assert.deepEqual(tickedOn(s, 'p3', D(1)), [3]);
  // a tick moves its plan to the end: it is the latest used
  s = setTicked(s, 'p3', D(2), 8, true);
  assert.equal(s.plans[s.plans.length - 1].id, 'p3');
});

test("dates no longer among the plan's days are dropped; the other plans and days are kept", () => {
  let s = emptyShopping();
  s = setTicked(s, 'plan-1', D(1), 1, true);
  s = setTicked(s, 'plan-1', D(9), 2, true);
  s = setTicked(s, 'plan-2', D(9), 3, true);
  const days = [D(0), D(1), D(2), D(3), D(4), D(5), D(6)];
  const pruned = pruneShopping(s, 'plan-1', days);
  assert.deepEqual(tickedOn(pruned, 'plan-1', D(1)), [1]);
  assert.deepEqual(tickedOn(pruned, 'plan-1', D(9)), [], 'D(9) is no longer one of its days');
  assert.deepEqual(tickedOn(pruned, 'plan-2', D(9)), [3], 'another plan keeps its own');
  assert.equal(pruneShopping(pruned, 'plan-1', days), pruned, 'nothing more to drop: the same state');
  assert.equal(pruneShopping(s, 'plan-9', days), s, 'a plan with no basket: nothing to drop');
  // a plan left with no trip at all is dropped too
  const gone = pruneShopping(pruned, 'plan-1', [D(5)]);
  assert.deepEqual(gone.plans.map((p) => p.id), ['plan-2']);
});

test('kept in this browser, and read back exactly', () => {
  const storage = memory();
  let s = setTicked(emptyShopping(), 'plan-1', D(1), 19, true);
  s = setTicked(s, 'plan-1', D(1), 11, true);
  assert.equal(writeShopping(storage, s), true);
  assert.deepEqual(JSON.parse(storage.data[SHOPPING_KEY]), { v: 1, plans: [{ id: 'plan-1', trips: { [D(1)]: [11, 19] } }] });
  assert.deepEqual(readShopping(storage), s);
  assert.deepEqual(readShopping(memory()), emptyShopping());
});

test('a browser that refuses, or holds something else, reads as an empty basket and never throws', () => {
  assert.deepEqual(readShopping(null), emptyShopping());
  assert.deepEqual(readShopping(refusing), emptyShopping());
  assert.equal(writeShopping(refusing, emptyShopping()), false);
  assert.equal(writeShopping(null, emptyShopping()), false);
  for (const raw of ['not json', '[]', '{"v":2,"plans":[]}', '{"v":1}', '{"v":1,"plans":{}}', 'null']) {
    assert.deepEqual(parseShopping(raw), emptyShopping(), raw);
  }
  // only what this console writes survives: dates, whole product ids, one entry per plan
  const odd = JSON.stringify({ v: 1, plans: [
    { id: 'a', trips: { '2026-10-10': [3, 1, 1, 'x', -2, 2.5], soon: [4], '2026-10-11': 'no', '2026-10-12': [] } },
    { id: 'a', trips: { '2026-10-10': [9] } },
    { id: '', trips: {} }, { trips: {} }, 'junk', null,
    { id: 'b', trips: [] },
  ] });
  assert.deepEqual(parseShopping(odd), { v: 1, plans: [{ id: 'a', trips: { '2026-10-10': [1, 3] } }] });
});
