// Whether a plan's events have gone to a calendar: kept beside the plan in this browser
// (pantry.exported.v1), never in it, and matched to the events by what they are, not by the plan's
// revision. The schedule fixture is pantry-api's own approved_schedule (fixtures/calendar-schedule.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { DEFAULT_TIMING, timingFrom } from '../src/calendar.ts';
import {
  EXPORTED_KEY, EXPORTED_PLANS, changedSinceText, emptyExported, eventsSignature, exportState, exportedFor, exportedText,
  markExported, parseExported, readExported, timingSignature, writeExported,
} from '../src/mealplan/exported.ts';
import type { ExportMark } from '../src/mealplan/exported.ts';
import type { StorageLike } from '../src/mealplan/persist.ts';
import type { ApprovedSchedule } from '../src/types.ts';

const schedule: ApprovedSchedule = JSON.parse(readFileSync(new URL('./fixtures/calendar-schedule.json', import.meta.url), 'utf8'));
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

// the times and reminders the events went with: the Calendar stage's defaults, in Vancouver
const timing = timingFrom(DEFAULT_TIMING, 'America/Vancouver', ['dinner']);
const mark = (over: Partial<ExportMark> = {}): ExportMark => ({
  id: 'plan-1', sig: eventsSignature(schedule), events: 6, kinds: ['trips', 'cooks', 'reminders'],
  timing: timingSignature(timing), how: 'file', at: '2026-11-11T18:00:00.000Z', ...over,
});

test('the events are named by what they are: not by their order, nor by the plan\'s revision', () => {
  const sig = eventsSignature(schedule);
  assert.match(sig, /^[0-9a-f]{8}$/);
  const shuffled = copy(schedule);
  shuffled.cooks = [...(shuffled.cooks ?? [])].reverse();
  shuffled.rev = 99;
  shuffled.plan_id = 'another';
  assert.equal(eventsSignature(shuffled), sig, 'the same events');
  const moved = copy(schedule);
  moved.cooks![0].date = '2026-11-05';
  assert.notEqual(eventsSignature(moved), sig, 'a meal on another day');
  const rebought = copy(schedule);
  rebought.trips[0].fingerprint = 'f'.repeat(64);
  assert.notEqual(eventsSignature(rebought), sig, 'a trip that buys something else');
  const fewer = copy(schedule);
  fewer.reminders = [];
  assert.notEqual(eventsSignature(fewer), sig, 'a reminder gone');
});

test('current while the events are the ones handed over, changed after, none before', () => {
  assert.equal(exportState(mark(), schedule), 'current');
  const later = copy(schedule);
  later.rev = 12;
  assert.equal(exportState(mark(), later), 'current', 'an edit that left the events alone');
  const moved = copy(schedule);
  moved.cooks![1].slot = 'lunch';
  assert.equal(exportState(mark(), moved), 'changed');
  assert.equal(exportState(null, schedule), 'none');
  assert.equal(exportState(mark(), null), 'none', 'no events to compare with yet');
  assert.equal(exportState(mark(), { ...schedule, v: undefined }), 'none', 'an older API exports nothing');
});

test('every kind of event must have gone, at the times set now, for the step to be done', () => {
  // the fixture has a trip, three cook days and two reminders
  assert.equal(exportState(mark(), schedule, timing), 'current');
  assert.equal(exportState(mark({ kinds: ['trips'], events: 1 }), schedule, timing), 'partial',
    'only the trip went: the cook days and reminders are not in a calendar');
  const noReminders = copy(schedule);
  noReminders.reminders = [];
  assert.equal(exportState(mark({ sig: eventsSignature(noReminders), kinds: ['trips', 'cooks'] }), noReminders, timing),
    'current', 'a kind with no events in the plan need not go');
  const later = timingFrom({ ...DEFAULT_TIMING, trips: { ...DEFAULT_TIMING.trips, start: '17:00' } }, 'America/Vancouver',
    ['dinner']);
  assert.equal(exportState(mark(), schedule, later), 'changed', 'the trips moved to another time since');
  assert.equal(exportState(mark({ kinds: ['trips'] }), schedule, later), 'changed');
  assert.equal(exportState(mark(), schedule), 'current', 'no times to compare with: the events alone decide');
});

test('kept in this browser beside the plan, latest last, a few plans at most', () => {
  const store = memory();
  assert.deepEqual(readExported(store), emptyExported());
  let s = markExported(emptyExported(), mark());
  s = markExported(s, mark({ id: 'plan-2', how: 'google' }));
  s = markExported(s, mark({ events: 4 }));
  assert.deepEqual(s.plans.map((p) => [p.id, p.events]), [['plan-2', 6], ['plan-1', 4]], 'marked again: moved last');
  assert.equal(writeExported(store, s), true);
  assert.ok(store.data.has(EXPORTED_KEY));
  assert.deepEqual(readExported(store), s);
  assert.equal(exportedFor(s, 'plan-2')?.how, 'google');
  assert.equal(exportedFor(s, 'plan-9'), null);
  let many = emptyExported();
  for (let i = 0; i < EXPORTED_PLANS + 3; i += 1) many = markExported(many, mark({ id: `p${i}` }));
  assert.equal(many.plans.length, EXPORTED_PLANS);
  assert.equal(many.plans[0].id, 'p3', 'the plans marked longest ago go first');
});

test('a value that is not ours, or damaged, reads as no marks; a refusing browser is said', () => {
  assert.deepEqual(parseExported('{oops'), emptyExported());
  assert.deepEqual(parseExported(JSON.stringify({ v: 2, plans: [] })), emptyExported());
  const mixed = JSON.stringify({ v: 1, plans: [mark(), { ...mark({ id: 'b' }), sig: 'not-hex' }, { ...mark({ id: 'c' }), how: 'fax' },
    { ...mark({ id: 'd' }), events: -1 }, 'nonsense', mark()] });
  assert.deepEqual(parseExported(mixed).plans.map((p) => p.id), ['plan-1'], 'only whole marks, once each');
  const { kinds: _kinds, timing: _timing, ...older } = mark({ id: 'older' });
  const odd = JSON.stringify({ v: 1, plans: [older, { ...mark({ id: 'e' }), kinds: ['trips', 'fax'] },
    { ...mark({ id: 'f' }), timing: 'soon' }, mark({ id: 'g', kinds: ['cooks', 'cooks'] })] });
  assert.deepEqual(parseExported(odd).plans.map((p) => [p.id, p.kinds]), [['g', ['cooks']]],
    'a mark that does not say which kinds went, or at what times, says too little to count');
  const refusing: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(readExported(refusing), emptyExported());
  assert.equal(writeExported(refusing, emptyExported()), false);
  assert.equal(writeExported(null, emptyExported()), false);
});

test('Home\'s words for it: how many went, and how', () => {
  assert.equal(exportedText(mark()), '6 events downloaded');
  assert.equal(exportedText(mark({ how: 'google', events: 1 })), '1 event in Google Calendar');
  assert.equal(exportedText(mark({ events: 4 }), 19), '4 of 19 events downloaded', 'only some kinds went');
  assert.equal(exportedText(mark({ how: 'google', events: 4 }), 19), '4 of 19 events in Google Calendar');
  assert.equal(exportedText(mark(), 6), '6 events downloaded');
  assert.equal(changedSinceText('file'), 'changed since you downloaded them');
  assert.equal(changedSinceText('google'), 'changed since you synced them');
});
