// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The calendar export as the console uses it. pantry-api builds every event, the .ics file and
// each Google add-event link (calendar_export.py, one builder for all of them); this module only
// shapes the request, reads the preview, and checks what it is handed. No ICS is written here
// and no date is converted: dates and times are shown as the server sent them, so the browser's
// time zone can never move one.
//
// Times and reminders (the wizard's Calendar stage) go with the request as `timing`: when trips
// and cooks happen, in the browser's time zone, and the reminders on each kind of event, in
// minutes before it. The shopper picks them in words ("1 hour before", "the evening before");
// timingFrom turns those into minutes. They are kept in this browser under
// 'pantry.mealplan.calendar.v1', so a later sync writes the same times again.
import { dayLabel } from './mealplan/dates.ts';
import type {
  ApprovedSchedule, CalendarEvent, CalendarEventKind, CalendarExportRequest, CalendarInclude,
  CalendarPreview, CalendarTiming,
} from './types.ts';

export const INCLUDE_ALL: readonly CalendarInclude[] = ['trips', 'cooks', 'reminders'];

export const INCLUDE_LABELS: Record<CalendarInclude, string> = {
  trips: 'Shopping trips, with their lists',
  cooks: 'Cook days, with ingredients and nutrition',
  reminders: 'Freeze and thaw reminders',
};

export const KIND_LABELS: Record<CalendarEventKind, string> = {
  trip: 'Shopping trip', cook: 'Cook', freeze: 'Freeze', thaw: 'Thaw',
};

// The only page a Google add-event link may open: anything else in a preview is not ours.
export const GOOGLE_TEMPLATE = 'https://calendar.google.com/calendar/render?';

// The body for /calendar/preview and /calendar/ics: the schedule exactly as /mealplan/schedule
// sent it, the kinds of event wanted, in a fixed order with no repeats, and the times and
// reminders when there are any (without them the events are all-day, as before).
export function exportRequest(schedule: ApprovedSchedule,
  include: Iterable<CalendarInclude> = INCLUDE_ALL, timing?: CalendarTiming): CalendarExportRequest {
  const wanted = new Set(include);
  return { schedule, include: INCLUDE_ALL.filter((k) => wanted.has(k)), ...(timing ? { timing } : {}) };
}

// How many events of each kind the schedule would give, before any preview is asked for.
export function includeCounts(schedule: ApprovedSchedule): Record<CalendarInclude, number> {
  return {
    trips: schedule.trips.length,
    cooks: schedule.cooks?.length ?? 0,
    reminders: schedule.reminders?.length ?? 0,
  };
}

// Why this schedule cannot be exported yet, in the shopper's words (one line per trip), or null
// when it can. The server checks again and answers 409 for the same reasons; this only saves a
// round trip.
export function exportProblem(schedule: ApprovedSchedule | null | undefined): string | null {
  if (!schedule) return 'Nothing to add yet: place a meal or approve a trip first.';
  if (schedule.v !== 1 || !Array.isArray(schedule.cooks)) {
    return 'This server does not export calendars yet.';
  }
  if (schedule.blocked?.length) return schedule.blocked.map((b) => b.message).join('\n');
  if (!schedule.exportable) return 'A trip needs your review before the plan can be exported.';
  const n = includeCounts(schedule);
  if (n.trips + n.cooks + n.reminders === 0) {
    return 'Nothing to add yet: place a meal or approve a trip first.';
  }
  return null;
}

export function includeProblem(include: Iterable<CalendarInclude>): string | null {
  return [...include].length ? null : 'Choose at least one kind of event.';
}

// A link from the preview, only when it is Google Calendar's add-event page over https.
export function googleLink(e: Pick<CalendarEvent, 'google_url'>): string | null {
  const url = e.google_url;
  return typeof url === 'string' && url.startsWith(GOOGLE_TEMPLATE) ? url : null;
}

// The link's accessible name: which event, on which day, and that it opens a new tab.
export function googleLabel(e: Pick<CalendarEvent, 'title' | 'date'>): string {
  return `Add "${e.title}" on ${dayLabel(e.date)} to Google Calendar (opens a new tab)`;
}

export interface PreviewDay {
  date: string;
  label: string;                   // "Sun 1 Nov"
  events: CalendarEvent[];
}

// The preview grouped by day, days in date order and events in the server's order.
export function eventsByDay(preview: CalendarPreview): PreviewDay[] {
  const days = new Map<string, CalendarEvent[]>();
  for (const e of preview.events) days.set(e.date, [...(days.get(e.date) ?? []), e]);
  return [...days.keys()].sort().map((date) => ({ date, label: dayLabel(date), events: days.get(date)! }));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "2 shopping trips, 15 cook days and 8 reminders"
export function countsText(preview: CalendarPreview): string {
  const c = preview.counts;
  const parts = [
    c.trip ? plural(c.trip, 'shopping trip', 'shopping trips') : '',
    c.cook ? plural(c.cook, 'cook day', 'cook days') : '',
    c.freeze + c.thaw ? plural(c.freeze + c.thaw, 'reminder', 'reminders') : '',
  ].filter(Boolean);
  if (!parts.length) return 'no events';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// The download's name from Content-Disposition, kept to safe characters and ending .ics.
export function icsFileName(contentDisposition: string | null, fallback = 'pantry-plan.ics'): string {
  const m = /filename="?([^";]+)"?/i.exec(contentDisposition ?? '');
  const name = (m?.[1] ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '');
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.ics$/.test(name) ? name : fallback;
}

// A refusal from /calendar/*, as the shopper reads it. 409s carry the server's own sentence,
// which already says what to do.
export function exportErrorText(status: number, code: string | null, message: string): string {
  if (status === 409 && message) return message;
  if (code === 'nothing_to_export') return 'Nothing to export: choose at least one kind of event that the plan has.';
  if (status === 413) return 'The plan is too large to export in one file.';
  if (status === 429) return 'Too many exports in a minute; try again shortly.';
  if (status === 422) return `The server could not read this plan for export: ${message}`;
  return message || 'The export failed.';
}

// ─── Times and reminders ─────────────────────────────────────

export const TIMING_KEY = 'pantry.mealplan.calendar.v1';
export const MAX_REMINDERS = 3;
export const MAX_REMINDER_MIN = 40320;          // four weeks, pantry-api's limit
export const EVENING = '19:00';                 // "the evening before"
export const DAY_BEFORE = '09:00';              // "the morning before"

// A reminder as the shopper chooses it: minutes before a timed event, or a time the day before.
export type ReminderChoice = 15 | 30 | 60 | 120 | 'evening' | 'day_before';

const MINUTE_CHOICES: readonly ReminderChoice[] = [15, 30, 60, 120];
const DAY_CHOICES: readonly ReminderChoice[] = ['evening', 'day_before'];

// What can be chosen: a time the day before for any event; minutes before only for a timed one.
export const reminderChoices = (timed: boolean): readonly ReminderChoice[] =>
  (timed ? [...MINUTE_CHOICES, ...DAY_CHOICES] : DAY_CHOICES);

export function reminderLabel(c: ReminderChoice): string {
  if (c === 'evening') return `the evening before (${EVENING})`;
  if (c === 'day_before') return `the morning before (${DAY_BEFORE})`;
  return c < 60 ? `${c} minutes before` : c === 60 ? '1 hour before' : `${c / 60} hours before`;
}

// One kind of event: at a time (start, for `minutes`) or all day, and its reminders.
export interface KindTiming {
  timed: boolean;
  start: string;                   // 'HH:MM'
  minutes: number;
  remind: ReminderChoice[];
}

// Freeze and thaw reminders are all-day events: only their reminders are chosen.
export interface TimingForm {
  v: 1;
  trips: KindTiming;
  cooks: KindTiming;
  reminders: { remind: ReminderChoice[] };
}

export const DEFAULT_TIMING: TimingForm = {
  v: 1,
  trips: { timed: true, start: '10:00', minutes: 60, remind: [60, 'evening'] },
  cooks: { timed: true, start: '17:30', minutes: 60, remind: [30] },
  reminders: { remind: [] },
};

export const LENGTHS: readonly number[] = [15, 30, 45, 60, 90, 120, 180];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (hhmm: string) => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// A reminder in minutes before the event: before its start for a timed one, before its
// midnight for an all-day one (as Google counts them).
export function reminderMinutes(c: ReminderChoice, start: string | null): number {
  const at = start ? toMinutes(start) : 0;
  if (c === 'evening') return at + 24 * 60 - toMinutes(EVENING);
  if (c === 'day_before') return at + 24 * 60 - toMinutes(DAY_BEFORE);
  return c;
}

// The reminders to send for one kind: only those that can be chosen for it, in minutes, without
// repeats, soonest first, at most three.
function minutesFor(remind: readonly ReminderChoice[], start: string | null): number[] {
  const allowed = reminderChoices(start !== null);
  const mins = remind.filter((c) => allowed.includes(c)).map((c) => reminderMinutes(c, start))
    .filter((n) => n >= 0 && n <= MAX_REMINDER_MIN);
  return [...new Set(mins)].sort((a, b) => a - b).slice(0, MAX_REMINDERS);
}

// Why a kind's time cannot be used, or null.
export function kindProblem(k: KindTiming): string | null {
  if (!k.timed) return null;
  if (!HHMM.test(k.start)) return 'a start time as hours and minutes, such as 10:00';
  if (!LENGTHS.includes(k.minutes)) return 'a length from the list';
  return null;
}

// The request's timing, in the browser's time zone. A kind with a time that cannot be used is
// sent as all-day rather than guessed.
export function timingFrom(form: TimingForm, timezone: string): CalendarTiming {
  const time = (k: KindTiming) => (k.timed && !kindProblem(k) ? { start: k.start, minutes: k.minutes } : null);
  const trips = time(form.trips);
  const cooks = time(form.cooks);
  return {
    timezone,
    trips,
    cooks,
    reminders: {
      trips: minutesFor(form.trips.remind, trips?.start ?? null),
      cooks: minutesFor(form.cooks.remind, cooks?.start ?? null),
      reminders: minutesFor(form.reminders.remind, null),
    },
  };
}

const isChoice = (x: unknown): x is ReminderChoice =>
  MINUTE_CHOICES.includes(x as ReminderChoice) || DAY_CHOICES.includes(x as ReminderChoice);

function readKind(x: unknown, fallback: KindTiming): KindTiming {
  if (typeof x !== 'object' || x === null) return fallback;
  const k = x as Record<string, unknown>;
  const remind = Array.isArray(k.remind) ? [...new Set(k.remind.filter(isChoice))].slice(0, MAX_REMINDERS) : fallback.remind;
  const out = {
    timed: typeof k.timed === 'boolean' ? k.timed : fallback.timed,
    start: typeof k.start === 'string' && HHMM.test(k.start) ? k.start : fallback.start,
    minutes: typeof k.minutes === 'number' && LENGTHS.includes(k.minutes) ? k.minutes : fallback.minutes,
    remind,
  };
  return out;
}

// The saved choices, field by field; anything unreadable is the default.
export function readTimingForm(raw: string | null): TimingForm {
  let x: unknown;
  try {
    x = raw === null ? null : JSON.parse(raw);
  } catch {
    x = null;
  }
  if (typeof x !== 'object' || x === null || (x as { v?: unknown }).v !== 1) return DEFAULT_TIMING;
  const f = x as Record<string, unknown>;
  const rem = f.reminders as { remind?: unknown } | undefined;
  return {
    v: 1,
    trips: readKind(f.trips, DEFAULT_TIMING.trips),
    cooks: readKind(f.cooks, DEFAULT_TIMING.cooks),
    reminders: { remind: Array.isArray(rem?.remind)
      ? [...new Set(rem.remind.filter((c): c is ReminderChoice => DAY_CHOICES.includes(c as ReminderChoice)))]
      : DEFAULT_TIMING.reminders.remind },
  };
}

// When an event happens, as the preview shows it: "10:00–11:00" or "all day".
export function eventWhen(e: Pick<CalendarEvent, 'all_day' | 'start_time' | 'end_time'>): string {
  if (e.all_day || !e.start_time) return 'all day';
  return e.end_time ? `${e.start_time}–${e.end_time}` : e.start_time;
}

// A reminder in words, from the minutes the server wrote: "1 hour before", "19:00 the day before".
export function reminderWhen(min: number, start: string | null): string {
  if (!start && min === 0) return 'at the start of the day';
  const at = (start && HHMM.test(start) ? toMinutes(start) : 0) - min;
  if (start && at >= 0) {
    return min < 60 ? `${min} minutes before` : min % 60 === 0
      ? `${min / 60} ${min === 60 ? 'hour' : 'hours'} before` : `${Math.floor(min / 60)} h ${min % 60} min before`;
  }
  if (at >= -24 * 60) return `${hhmm(at + 24 * 60)} the day before`;
  const days = Math.round(min / (24 * 60));
  return `about ${days} ${days === 1 ? 'day' : 'days'} before`;
}

export function remindersText(e: Pick<CalendarEvent, 'all_day' | 'start_time' | 'reminders_min'>): string {
  const mins = e.reminders_min ?? [];
  if (!mins.length) return '';
  const start = e.all_day ? null : e.start_time ?? null;
  return `Reminders: ${mins.map((m) => reminderWhen(m, start)).join(', ')}`;
}
