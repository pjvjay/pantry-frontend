// The calendar export's console side: the request body, what blocks an export, the preview read
// by day, Google links accepted only for Google's add-event page, and the downloaded file's
// name. The fixtures are pantry-api's own answers (/mealplan/schedule's approved_schedule and
// /calendar/preview) for a fewest-trips plan from Thu 29 Oct 2026, across BC's 1 Nov change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  INCLUDE_ALL, countsText, eventsByDay, exportErrorText, exportProblem, exportRequest,
  googleLabel, googleLink, icsFileName, includeCounts, includeProblem,
} from '../src/calendar.ts';
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
