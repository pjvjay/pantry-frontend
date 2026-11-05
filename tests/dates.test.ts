import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays, dayLabel, daysBetween, isCivilDate, range, todayIn, weekday,
} from '../src/mealplan/dates.ts';

// October instants only: Vancouver is UTC-7 then under both the old DST rule and a permanent
// UTC-7, so these hold whichever time zone data the machine has.
test('today in Vancouver is still yesterday just after UTC midnight', () => {
  assert.equal(todayIn('America/Vancouver', new Date('2026-10-16T03:30:00Z')), '2026-10-15');
  assert.equal(todayIn('America/Vancouver', new Date('2026-10-16T06:59:59Z')), '2026-10-15');
  assert.equal(todayIn('America/Vancouver', new Date('2026-10-16T07:00:00Z')), '2026-10-16');
  assert.equal(todayIn('UTC', new Date('2026-10-16T03:30:00Z')), '2026-10-16');
});

test('adding days crosses month and year ends and leap days', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(addDays('2026-10-15', 14), '2026-10-29');
});

test('days stay whole across the clock changes', () => {
  // 2026-11-01 and 2027-03-14 are the North American changes; a local-midnight Date would
  // skip or repeat a day on one of them.
  assert.deepEqual(range('2026-10-31', 3), ['2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(range('2027-03-13', 3), ['2027-03-13', '2027-03-14', '2027-03-15']);
  assert.equal(daysBetween('2026-10-25', '2026-11-08'), 14);
  assert.equal(daysBetween('2026-11-08', '2026-10-25'), -14);
});

test('a range of no days is empty', () => {
  assert.deepEqual(range('2026-10-15', 0), []);
});

test('labels read "Thu 15 Oct"', () => {
  assert.equal(dayLabel('2026-10-15'), 'Thu 15 Oct');
  assert.equal(dayLabel('2027-01-03'), 'Sun 3 Jan');
  assert.equal(weekday('2026-10-15'), 4);
});

test('only real dates in YYYY-MM-DD are dates', () => {
  assert.equal(isCivilDate('2026-10-15'), true);
  assert.equal(isCivilDate('2028-02-29'), true);
  for (const bad of ['2026-02-30', '2027-02-29', '2026-10-5', '2026/10/15', '2026-10-15T00:00', '']) {
    assert.equal(isCivilDate(bad), false, bad);
  }
  assert.throws(() => addDays('2026-02-30', 1), RangeError);
});
