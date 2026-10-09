// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The calendar export as the console uses it. pantry-api builds every event, the .ics file and
// each Google add-event link (calendar_export.py, one builder for all of them); this module only
// shapes the request, reads the preview, and checks what it is handed. No ICS is written here
// and no date is converted: events are all-day, and their dates are shown as the server sent
// them, so the browser's time zone can never move one.
import { dayLabel } from './mealplan/dates.ts';
import type {
  ApprovedSchedule, CalendarEvent, CalendarEventKind, CalendarExportRequest, CalendarInclude,
  CalendarPreview,
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
// sent it, and the kinds of event wanted, in a fixed order with no repeats.
export function exportRequest(schedule: ApprovedSchedule,
  include: Iterable<CalendarInclude> = INCLUDE_ALL): CalendarExportRequest {
  const wanted = new Set(include);
  return { schedule, include: INCLUDE_ALL.filter((k) => wanted.has(k)) };
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
