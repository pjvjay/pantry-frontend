// The calendar export's console side: the request body, what blocks an export, the preview read
// by day, Google links accepted only for Google's add-event page, and the downloaded file's
// name. The fixtures are pantry-api's own answers (/mealplan/schedule's approved_schedule and
// /calendar/preview) for a fewest-trips plan from Thu 29 Oct 2026, across BC's 1 Nov change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COOK_TIMES, DEFAULT_TIMING, INCLUDE_ALL, TIMING_KEY, cookProblem, countsText, eventSubject, eventWhen, eventsByDay,
  eventsHead, exportErrorText, exportProblem, exportRequest, googleLabel, googleLink, icsFileName, includeCounts,
  includeProblem, kindProblem, lengthText, readTimingForm,
  reminderChoices, reminderLabel, reminderMinutes, remindersText, timingFrom, timingSummary,
} from '../src/calendar.ts';
import type { ReminderChoice } from '../src/calendar.ts';
import type { ApprovedSchedule, CalendarPreview } from '../src/types.ts';

const read = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;
const schedule = read<ApprovedSchedule>('calendar-schedule.json');
const preview = read<CalendarPreview>('calendar-preview.json');
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test('the request posts the schedule back unchanged, with the kinds in a fixed order', () => {
  const body = exportRequest(schedule, ['reminders', 'trips', 'reminders']);
  assert.equal(body.schedule, schedule);
  assert.deepEqual(body.include, ['trips', 'reminders']);
  assert.deepEqual(exportRequest(schedule).include, ['trips', 'cooks', 'reminders']);
  assert.deepEqual(INCLUDE_ALL, ['trips', 'cooks', 'reminders']);
  assert.equal(includeProblem([]), 'Choose at least one kind of event.');
  assert.equal(includeProblem(['cooks']), null);
  assert.deepEqual(includeCounts(schedule), { trips: 1, cooks: 3, reminders: 2 });
});

test('an export is blocked while a trip needs review, and says why', () => {
  assert.equal(exportProblem(schedule), null);
  assert.match(exportProblem(null) ?? '', /place a meal or approve a trip/);

  const review = copy(schedule);
  review.exportable = false;
  review.blocked = [{ item_id: 'trip-x', code: 'needs_review', date: '2026-10-31',
    message: 'The trip on Sat 31 Oct changed since you approved it: review it and approve it again.' }];
  assert.equal(exportProblem(review), review.blocked[0].message);
  const two = copy(review);
  two.blocked = [...review.blocked, { ...review.blocked[0], item_id: 'trip-y', message: 'Second.' }];
  assert.equal(exportProblem(two), `${review.blocked[0].message}\nSecond.`);

  const gone = copy(review);
  gone.blocked = [];
  assert.match(exportProblem(gone) ?? '', /needs your review/);

  // an API from before the calendar export sends the old shape, with no cook days
  const older = { trips: [], actions: [], exportable: true } as ApprovedSchedule;
  assert.equal(exportProblem(older), 'This server does not export calendars yet.');

  const empty = { ...copy(schedule), trips: [], cooks: [], reminders: [] };
  assert.match(exportProblem(empty) ?? '', /Nothing to add yet/);
});

test('Google links are taken only when they open Google Calendar\'s add-event page', () => {
  for (const e of preview.events) {
    assert.equal(googleLink(e), e.google_url);
    assert.ok(e.google_url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE'));
  }
  for (const bad of ['javascript:alert(1)', 'http://calendar.google.com/calendar/render?x',
    'https://calendar.google.com.evil.example/calendar/render?x', 'https://evil.example/?https://calendar.google.com/calendar/render?',
    '', 'data:text/html,hi']) {
    assert.equal(googleLink({ google_url: bad }), null, bad);
  }
  const e = preview.events.find((x) => x.kind === 'trip')!;
  assert.equal(googleLabel(e), `Add "${e.title}" on Sat 31 Oct to Google Calendar (opens a new tab)`);
});

test('the preview reads by day, in date order, events in the server\'s order', () => {
  const days = eventsByDay(preview);
  assert.deepEqual(days.map((d) => d.date), [...new Set(preview.events.map((e) => e.date))].sort());
  assert.deepEqual(days.flatMap((d) => d.events), preview.events);
  const sat = days.find((d) => d.date === '2026-10-31')!;
  assert.equal(sat.label, 'Sat 31 Oct');
  assert.deepEqual(sat.events.map((e) => e.kind), ['trip', 'freeze']);
  assert.equal(countsText(preview), '1 shopping trip, 3 cook days and 2 reminders');
  assert.equal(countsText({ ...preview, counts: { trip: 0, cook: 2, freeze: 0, thaw: 0 } }), '2 cook days');
  assert.equal(countsText({ ...preview, counts: { trip: 0, cook: 0, freeze: 0, thaw: 0 } }), 'no events');
});

test('the events are all-day, with what the server put in them', () => {
  for (const e of preview.events) {
    assert.equal(e.all_day, true);
    assert.equal(new Date(`${e.end}T00:00:00Z`).getTime() - new Date(`${e.date}T00:00:00Z`).getTime(), 86_400_000);
  }
  const trip = preview.events.find((e) => e.kind === 'trip')!;
  assert.match(trip.description, /^Shopping trip Sat 31 Oct 2026/);
  assert.match(trip.description, /Store hours: unknown/);
  assert.ok(trip.location?.endsWith('(demo store)'));
  assert.ok(trip.labels.includes('store hours unknown'));
  const cook = preview.events.find((e) => e.kind === 'cook')!;
  assert.match(cook.description, /Nutrition per serving \(demo amounts\)/);
  const thaw = preview.events.find((e) => e.kind === 'thaw')!;
  assert.deepEqual(thaw.labels, ['cited']);
});

test('dates and labels do not move with the time zone, either side of 1 Nov 2026', () => {
  const before = process.env.TZ;
  const seen: string[] = [];
  const offsets = new Set<number>();
  try {
    for (const zone of ['America/Vancouver', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
      process.env.TZ = zone;
      offsets.add(new Date(Date.UTC(2026, 10, 1, 8)).getTimezoneOffset());
      seen.push(JSON.stringify([eventsByDay(preview).map((d) => [d.date, d.label]),
        preview.events.map(googleLabel)]));
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
  assert.equal(offsets.size, 4);                  // the zones really did change
  assert.equal(new Set(seen).size, 1);
  const labels = eventsByDay(preview).map((d) => d.label);
  assert.ok(labels.includes('Sat 31 Oct') && labels.includes('Sun 1 Nov') && labels.includes('Mon 2 Nov'));
});

test('the downloaded file keeps the server\'s name when it is a safe .ics name', () => {
  assert.equal(icsFileName('attachment; filename="pantry-plan-2026-10-30.ics"'), 'pantry-plan-2026-10-30.ics');
  assert.equal(icsFileName('attachment; filename=pantry-plan.ics'), 'pantry-plan.ics');
  assert.equal(icsFileName('attachment; filename="../../etc/passwd"'), 'pantry-plan.ics');
  assert.equal(icsFileName('attachment; filename="plan.exe"'), 'pantry-plan.ics');
  assert.equal(icsFileName(null), 'pantry-plan.ics');
});

test('refusals read as the shopper needs them', () => {
  const msg = 'Chicken Thighs Bone-In on your approved trip Sat 31 Oct has no offer in range any more.';
  assert.equal(exportErrorText(409, 'no_longer_stocked', msg), msg);
  assert.match(exportErrorText(422, 'nothing_to_export', 'x'), /Nothing to export/);
  assert.match(exportErrorText(429, 'rate_limited', 'x'), /try again/);
  assert.match(exportErrorText(413, 'too_large', 'x'), /too large/);
});

// ─── Times and reminders (the wizard's Calendar stage) ───────

test('times and reminders go with the request only when there are any', () => {
  const timing = timingFrom(DEFAULT_TIMING, 'America/Vancouver');
  assert.equal('timing' in exportRequest(schedule, ['trips']), false, 'all-day, exactly as before');
  assert.equal(exportRequest(schedule, ['trips'], timing).timing, timing);
});

test('the defaults: trips at 10:00 for an hour, reminded an hour and the evening before; cooks by meal', () => {
  assert.deepEqual(timingFrom(DEFAULT_TIMING, 'America/Vancouver'), {
    timezone: 'America/Vancouver',
    trips: { start: '10:00', minutes: 60 },
    // start stays the dinner's; each meal planned has its own
    cooks: { start: '17:30', minutes: 60,
      by_slot: { breakfast: '07:30', lunch: '12:00', dinner: '17:30', snack: '15:00' } },
    // 19:00 the evening before a 10:00 trip is 15 hours before it
    reminders: { trips: [60, 900], cooks: [30], reminders: [] },
  });
});

test('reminders in words become minutes: before a timed event, or before an all-day one\'s midnight', () => {
  assert.equal(reminderMinutes(15, '10:00'), 15);
  assert.equal(reminderMinutes('evening', '10:00'), 900);
  assert.equal(reminderMinutes('evening', '21:00'), 1560);
  assert.equal(reminderMinutes('day_before', '17:30'), 1950);
  assert.equal(reminderMinutes('evening', null), 300, '19:00 the day before an all-day event');
  assert.equal(reminderMinutes('day_before', null), 900);
  assert.deepEqual(reminderChoices(false), ['evening', 'day_before']);
  assert.deepEqual(reminderChoices(true), [15, 30, 60, 120, 'evening', 'day_before']);
  assert.deepEqual([15, 60, 120, 'evening', 'day_before'].map((c) => reminderLabel(c as never)),
    ['15 minutes before', '1 hour before', '2 hours before', 'the evening before (19:00)', 'the morning before (09:00)']);
});

test('an all-day kind keeps only the reminders a day can have; repeats go, at most three, soonest first', () => {
  const form = { ...DEFAULT_TIMING,
    trips: { timed: false, start: '10:00', minutes: 60, remind: [60, 'evening'] as ReminderChoice[] },
    cooks: { ...DEFAULT_TIMING.cooks, remind: [120, 15, 30, 'evening'] as ReminderChoice[] },
    reminders: { remind: ['day_before', 'evening', 'evening'] as ReminderChoice[] } };
  const t = timingFrom(form, 'Europe/Paris');
  assert.equal(t.trips, null);
  // timed cooking starts at a different time a meal, so "the evening before" cannot be one number
  assert.deepEqual(t.reminders, { trips: [300], cooks: [15, 30, 120], reminders: [300, 900] });
  assert.deepEqual(reminderChoices(true, true), [15, 30, 60, 120]);
  assert.deepEqual(reminderChoices(false, true), ['evening', 'day_before']);
  // all-day cooking can have them
  const allDay = timingFrom({ ...form, cooks: { ...form.cooks, timed: false } }, 'UTC');
  assert.equal(allDay.cooks, null);
  assert.deepEqual(allDay.reminders.cooks, [300]);
});

test('cooking has a time for each meal slot the plan has, breakfast 07:30 to dinner 17:30', () => {
  assert.deepEqual(COOK_TIMES, { breakfast: '07:30', lunch: '12:00', dinner: '17:30', snack: '15:00' });
  const form = { ...DEFAULT_TIMING, cooks: { ...DEFAULT_TIMING.cooks,
    bySlot: { ...COOK_TIMES, breakfast: '08:00', dinner: '18:15' }, start: '18:15' } };
  assert.deepEqual(timingFrom(form, 'UTC', ['breakfast', 'dinner']).cooks,
    { start: '18:15', minutes: 60, by_slot: { breakfast: '08:00', dinner: '18:15' } });
  // a slot switched off may hold anything; one planned must be a time
  const lunchBad = { ...form.cooks, bySlot: { ...form.cooks.bySlot, lunch: '' } };
  assert.equal(cookProblem(lunchBad, ['breakfast', 'dinner']), null);
  assert.equal(cookProblem(lunchBad, ['lunch', 'dinner']), 'a time for lunch as hours and minutes, such as 07:30');
  assert.equal(timingFrom({ ...form, cooks: lunchBad }, 'UTC', ['lunch', 'dinner']).cooks, null);
  assert.equal(cookProblem({ ...form.cooks, minutes: 50 }), 'a length from the list');
});

test('a time that cannot be used is sent as all-day, never guessed', () => {
  assert.equal(kindProblem({ timed: true, start: '25:00', minutes: 60, remind: [] }),
    'a start time as hours and minutes, such as 10:00');
  assert.equal(kindProblem({ timed: true, start: '09:00', minutes: 50, remind: [] }), 'a length from the list');
  assert.equal(kindProblem({ timed: false, start: '', minutes: 0, remind: [] }), null);
  const t = timingFrom({ ...DEFAULT_TIMING, trips: { timed: true, start: '7pm', minutes: 60, remind: [30, 'evening'] } }, 'UTC');
  assert.equal(t.trips, null);
  assert.deepEqual(t.reminders.trips, [300]);
});

test('the saved choices are read field by field; anything unreadable is the default', () => {
  assert.deepEqual(readTimingForm(null), DEFAULT_TIMING);
  assert.deepEqual(readTimingForm('{not json'), DEFAULT_TIMING);
  assert.deepEqual(readTimingForm(JSON.stringify({ v: 2 })), DEFAULT_TIMING);
  const saved = { v: 1, trips: { timed: true, start: '08:15', minutes: 45, remind: [15, 15, 'never'] },
    cooks: { timed: 'yes', start: '99:00', minutes: 7, remind: 'x' }, reminders: { remind: ['evening', 60] } };
  assert.deepEqual(readTimingForm(JSON.stringify(saved)), {
    v: 1,
    trips: { timed: true, start: '08:15', minutes: 45, remind: [15] },
    cooks: DEFAULT_TIMING.cooks,
    reminders: { remind: ['evening'] },
  });
  assert.equal(TIMING_KEY, 'pantry.mealplan.calendar.v1');
  // saved before cook times by slot: the defaults; a saved one is kept, a bad one replaced
  const bySlot = { v: 1, cooks: { timed: true, minutes: 30, remind: [15], bySlot: { breakfast: '06:45', lunch: 'noon' } } };
  assert.deepEqual(readTimingForm(JSON.stringify(bySlot)).cooks,
    { timed: true, start: '17:30', minutes: 30, remind: [15],
      bySlot: { breakfast: '06:45', lunch: '12:00', dinner: '17:30', snack: '15:00' } });
});

test('the preview says when an event is and its reminders, from what the server wrote', () => {
  assert.equal(eventWhen({ all_day: true }), 'all day');
  assert.equal(eventWhen({ all_day: false, start_time: '10:00', end_time: '11:00' }), '10:00–11:00');
  assert.equal(remindersText({ all_day: false, start_time: '10:00', reminders_min: [60, 900] }),
    'Reminders: 1 hour before, 19:00 the day before');
  assert.equal(remindersText({ all_day: false, start_time: '17:30', reminders_min: [30, 90] }),
    'Reminders: 30 minutes before, 1 h 30 min before');
  assert.equal(remindersText({ all_day: true, reminders_min: [300, 0] }),
    'Reminders: 19:00 the day before, at the start of the day');
  assert.equal(remindersText({ all_day: true, reminders_min: [4320] }), 'Reminders: about 3 days before');
  assert.equal(remindersText({ all_day: true }), '', 'an API before the wizard sends none');
  // the fixture is an older API's all-day preview: it still reads
  assert.ok(preview.events.every((e) => eventWhen(e) === 'all day' && remindersText(e) === ''));
});

test('the stage leads with how many events, and of which kinds', () => {
  assert.equal(eventsHead(preview), '6 events: 1 shopping trip, 3 cook days and 2 reminders');
  assert.equal(eventsHead({ ...preview, events: [] }), 'No events of the kinds chosen');
});

test('each event\'s picture is its recipe\'s, its product\'s, or none for a trip', () => {
  const subjects = preview.events.map((e) => eventSubject(e, schedule));
  assert.deepEqual(subjects.slice(0, 5), [
    { kind: 'recipe', key: 'starter:chicken_biryani', slot: 'dinner' },
    { kind: 'trip' },
    { kind: 'product', name: 'Chicken Thighs Bone-In' },
    { kind: 'recipe', key: 'starter:mango_milkshake', slot: 'snack' },
    { kind: 'product', name: 'Chicken Thighs Bone-In' },
  ]);
  assert.equal(eventSubject({ kind: 'cook', item_id: 'cook-nothing#1' }, schedule), null, 'not in the schedule');
  assert.equal(eventSubject({ kind: 'thaw', item_id: 'x' }, null), null);
});

test('the Timing card says what it holds in its heading, so it can stay closed', () => {
  const all = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
  assert.equal(timingSummary(DEFAULT_TIMING, all), 'Trips at 10:00 for 1 h, cooking at meal times for 1 h, with reminders');
  assert.equal(timingSummary(DEFAULT_TIMING, ['dinner']), 'Trips at 10:00 for 1 h, cooking at 17:30 for 1 h, with reminders');
  const quiet = { ...DEFAULT_TIMING, trips: { ...DEFAULT_TIMING.trips, timed: false, remind: [] },
    cooks: { ...DEFAULT_TIMING.cooks, timed: false, remind: [] }, reminders: { remind: [] } };
  assert.equal(timingSummary(quiet, all), 'Trips all day, cooking all day, no reminders');
  // a time that cannot be used is sent all day, and said so
  const bad = { ...DEFAULT_TIMING, trips: { ...DEFAULT_TIMING.trips, start: '25:00' } };
  assert.equal(timingSummary(bad, ['dinner']).split(',')[0], 'Trips all day');
  assert.deepEqual([15, 45, 60, 90, 180].map(lengthText), ['15 min', '45 min', '1 h', '1.5 h', '3 h']);
});
