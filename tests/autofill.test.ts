// Place on days fills itself once per plan: when, how it is remembered in this browser, and the
// toast's words.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTOFILL_KEY, AUTOFILL_LIMIT, autofillCount, readAutofilled, rememberAutofilled, spreadText, withAutofilled,
} from '../src/mealplan/autofill.ts';
import { historyStep, undoPlan } from '../src/mealplan/model.ts';
import { startHistory } from '../src/mealplan/undo.ts';
import type { StorageLike } from '../src/mealplan/persist.ts';
import { D, add, planWith, run } from './helpers/mealplan.ts';

const PIZZA = 'starter:pepperoni_pizza';

function memory(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

const refusing: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

test('a plan whose meals all wait in the tray is filled, once', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 3), add('mango_milkshake', 'Mango Milkshake', 2, 'snack'));
  assert.equal(autofillCount(s, []), 5);
  assert.equal(autofillCount(s, ['plan-1']), 0, 'filled before: never again, so an Undo stays undone');
  assert.equal(autofillCount(s, ['another-plan']), 5);
  assert.equal(autofillCount(planWith(7), []), 0, 'nothing to place');
  // the shopper has started placing by hand: their plan is left to them
  const placed = run(s, { type: 'place', mealId: `${PIZZA}#1`, date: D(2), slot: 'dinner' });
  assert.equal(autofillCount(placed, []), 0);
  // filled already (the meals unpinned, waiting for the schedule to spread them): nothing held
  assert.equal(autofillCount(run(s, { type: 'fillEmpty' }), []), 0);
});

test('the fill is one step: Undo puts every meal back in the tray, held, and the plan stays remembered', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 3));
  const storage = memory();
  assert.ok(rememberAutofilled(storage, s.draft.id));
  let h = historyStep(startHistory(s), { type: 'fillEmpty' }).history;
  assert.ok(h.present.draft.meals.every((m) => !m.pinned && m.date === null));
  h = undoPlan(h);
  assert.ok(h.present.draft.meals.every((m) => m.pinned && m.date === null), 'back in the tray, held');
  assert.equal(autofillCount(h.present, readAutofilled(storage)), 0, 'coming back does not fill it again');
});

test('the plans filled are kept in this browser, each once, the newest last, and never too many', () => {
  const storage = memory();
  assert.deepEqual(readAutofilled(storage), []);
  rememberAutofilled(storage, 'a');
  rememberAutofilled(storage, 'b');
  rememberAutofilled(storage, 'a');
  assert.deepEqual(JSON.parse(storage.data[AUTOFILL_KEY]), ['b', 'a']);
  assert.deepEqual(readAutofilled(storage), ['b', 'a']);
  let list: string[] = [];
  for (let i = 0; i < AUTOFILL_LIMIT + 5; i += 1) list = withAutofilled(list, `p${i}`);
  assert.equal(list.length, AUTOFILL_LIMIT);
  assert.equal(list[0], 'p5', 'the oldest go first');
  assert.equal(list[list.length - 1], `p${AUTOFILL_LIMIT + 4}`);
});

test('a browser that refuses or holds something else is read as no plans filled, and never throws', () => {
  assert.deepEqual(readAutofilled(null), []);
  assert.deepEqual(readAutofilled(refusing), []);
  assert.equal(rememberAutofilled(refusing, 'a'), false);
  assert.equal(rememberAutofilled(null, 'a'), false);
  assert.deepEqual(readAutofilled(memory({ [AUTOFILL_KEY]: 'not json' })), []);
  assert.deepEqual(readAutofilled(memory({ [AUTOFILL_KEY]: '{"a":1}' })), []);
  assert.deepEqual(readAutofilled(memory({ [AUTOFILL_KEY]: '["a",2,null,"b"]' })), ['a', 'b']);
});

test('the toast says how many meals went where', () => {
  assert.equal(spreadText(3, 7), 'Spread 3 meals across the week');
  assert.equal(spreadText(15, 14), 'Spread 15 meals across the two weeks');
  assert.equal(spreadText(1, 7), 'Spread 1 meal across the week');
  assert.equal(spreadText(2, 3), 'Spread 2 meals across the 3 days');
  assert.equal(spreadText(1, 1), 'Spread 1 meal across the day');
});
