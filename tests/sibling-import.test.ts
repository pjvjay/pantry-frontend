// model.ts imports its sibling as './dates.ts'. node resolves an import only by its exact file
// name (no extension guessing, unlike Vite), so this file passing in CI is the proof that the
// pure modules load under node --test as they are written; an extensionless sibling import
// would fail here before any assertion ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_MEALS, SLOTS, cellKey, inWindow, newWindow, parseCellKey, weeksOf, windowDates,
  windowProblem,
} from '../src/mealplan/model.ts';

test('a window counts its days through dates.ts, across a month end', () => {
  const w = { start_date: '2026-10-30', days: 4 };
  assert.deepEqual(windowDates(w), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('a new plan starts tomorrow', () => {
  assert.deepEqual(newWindow('2026-12-31'), { start_date: '2027-01-01', days: 7 });
  assert.deepEqual(newWindow('2026-10-15', 14), { start_date: '2026-10-16', days: 14 });
});

test('a window holds its own days and no others', () => {
  const w = { start_date: '2026-10-16', days: 7 };
  assert.equal(inWindow(w, '2026-10-16'), true);
  assert.equal(inWindow(w, '2026-10-22'), true);
  assert.equal(inWindow(w, '2026-10-23'), false);
  assert.equal(inWindow(w, '2026-10-15'), false);
});

test('a window is 1 to 14 days from a real date', () => {
  assert.equal(windowProblem({ start_date: '2026-10-16', days: 14 }), null);
  assert.match(windowProblem({ start_date: '2026-10-16', days: 15 }) ?? '', /1 to 14 days/);
  assert.match(windowProblem({ start_date: '2026-10-16', days: 0 }) ?? '', /1 to 14 days/);
  assert.match(windowProblem({ start_date: '2026-02-30', days: 7 }) ?? '', /not a date/);
  assert.equal(MAX_MEALS, 56);
});

test('two weeks are drawn as two rows of seven, counted from the start date', () => {
  const weeks = weeksOf({ start_date: '2026-10-16', days: 14 });
  assert.equal(weeks.length, 2);
  assert.deepEqual(weeks.map((w) => [w[0], w.length]), [['2026-10-16', 7], ['2026-10-23', 7]]);
  assert.deepEqual(weeksOf({ start_date: '2026-10-16', days: 9 }).map((w) => w.length), [7, 2]);
});

test('a slot cell key round-trips, and anything else is refused', () => {
  for (const slot of SLOTS) {
    assert.deepEqual(parseCellKey(cellKey('2026-10-15', slot)), { date: '2026-10-15', slot });
  }
  assert.equal(cellKey('2026-10-15', 'dinner'), 'slot|2026-10-15|dinner');
  for (const bad of ['slot|2026-10-15|brunch', 'shop|2026-10-15|dinner', 'slot|2026-13-01|dinner',
    'slot|2026-10-15|dinner|x', 'slot|2026-10-15', '']) {
    assert.equal(parseCellKey(bad), null, bad);
  }
});
